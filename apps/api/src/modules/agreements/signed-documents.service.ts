import { createHash } from "node:crypto";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  OFFER_DOCUMENT_KINDS,
  documentUnlocksOffers,
  isAfterJerusalemToday,
  safeFileName,
  sniffDocumentType,
  type DocumentKind,
} from "@metavchim/shared";
import { lockContact, lockProperty } from "../../common/locks";
import { assertContactAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { StorageService } from "../../core/storage.service";

/**
 * ‎**קבצים שנחתמו על נייר, בלשונית של ההסכמים.**
 *
 * מתווך שהחתים לקוח על דף מחזיק את מה שחוק המתווכים דורש — הוא לא
 * מחזיק את מה שהמערכת יודעת לייצר. עד כה לא הייתה לו שום דרך להכניס
 * את הדף למערכת, והלשונית „הסכמים” הראתה „עדיין לא נשלח הסכם” על
 * לקוח שחתם.
 *
 * ## מה השירות הזה טוען, ומה לא
 *
 * ‎`fileHash` הוא SHA-256 של הבתים שהועלו. הוא מוכיח שהקובץ שנשמר
 * הוא הקובץ שהגיע — ולא שום דבר על מה שכתוב בו. זו טענה חלשה יותר
 * מ-`Agreement.bodyHash`, והיא נכונה; גיבוב שהיינו מציגים כ„הוכחת
 * תוכן ההסכם” היה חזק יותר ושגוי.
 *
 * ‎**שם החותם ותאריך החתימה נמסרים בידי המתווך.** אין דרך לאמת אותם,
 * ולכן `uploadedBy` נשמר לצדם: מי שקורא את השורה יודע מי הצהיר.
 *
 * ## מה כן פותח את שער ההצעות
 *
 * מסמך מסוג `brokerage`/`exclusivity` — ראו `documentUnlocksOffers`
 * ו-`AgreementsService.hasSigned`. חוק המתווכים מתנה את דמי התיווך
 * בהזמנה בכתב חתומה, לא בהזמנה שנחתמה במסך מסוים.
 */

export interface SignedDocumentDto {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  byteSize: number;
  /** הנכס שההסכם חל עליו — ריק ב„מסמך אחר”. */
  propertyId?: string;
  propertyLabel?: string;
  signedOn?: string;
  signerName?: string;
  note?: string;
  createdAt: string;
  /** נתיב ההורדה יחסית לבסיס ה-API */
  url: string;
}

export interface UploadDocumentInput {
  contactId: string;
  kind: DocumentKind;
  propertyId?: string;
  fileName?: string;
  signedOn?: Date;
  signerName?: string;
  note?: string;
}

/** ‎50 מסמכים ללקוח — תקרה שמונעת מילוי אחסון, ורחוקה משימוש אמיתי. */
const MAX_DOCUMENTS_PER_CONTACT = 50;

export function documentDownloadPath(id: string): string {
  return `/signed-documents/${id}/raw`;
}

/** ההורדה מארכיון המשרד — שורה שכבר נותקה מלקוח שנמחק. */
export function retainedDownloadPath(id: string): string {
  return `/signed-documents/retained/${id}/raw`;
}

/** תיאור קצר של הנכס, כדי שמסמך לא ייקרא כשייך לנכס אחר. */
function propertyLabel(p: {
  city: string | null;
  neighborhood: string | null;
  street: string | null;
}): string {
  const where = [p.street, p.neighborhood, p.city].filter(Boolean).join(", ");
  return where === "" ? "נכס ללא כתובת" : where;
}

/**
 * תוויות הנכסים לקבוצת שורות — שאילתה אחת, לא אחת לשורה.
 *
 * ‎**משותפת לשתי הרשימות בכוונה.** הארכיון בנה את שורותיו בלי
 * התוויות, ולכן מי שנמחק לו לקוח עם סריקות על כמה נכסים ראה כמה
 * הסכמים חתומים שאי אפשר להבחין ביניהם לפני ההורדה (ביקורת
 * Codex). זו אותה הבחנה שנוספה לכרטיס הלקוח סבב קודם, ושתי
 * מימושים שלה היו נפרדים ברגע שאחד מהם משתנה.
 */
async function loadPropertyLabels(
  tx: TenantTx,
  tenantId: string,
  rows: readonly { propertyId: string | null }[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.propertyId).filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();
  const properties = await tx.property.findMany({
    where: { id: { in: ids }, tenantId },
    select: { id: true, city: true, neighborhood: true, street: true },
  });
  return new Map(properties.map((p) => [p.id, propertyLabel(p)]));
}

@Injectable()
export class SignedDocumentsService {
  private readonly logger = new Logger(SignedDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * מחיקת אובייקט עם רשת ביטחון — אותה תבנית כמו בתמונות הנכס: כשל
   * זמני באחסון אינו נבלע אלא מנותב לניסיון חוזר עמיד.
   */
  private async deleteObjectDurably(s3Key: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    try {
      await this.storage.delete(s3Key);
    } catch {
      await this.prisma.withTenant(async (tx) => {
        await this.outbox.emit(tx, "storage.cleanup_object", { tenantId, s3Key });
      });
    }
  }

  async upload(file: Buffer, input: UploadDocumentInput): Promise<SignedDocumentDto> {
    const tenantId = TenantContext.current().tenantId;
    const uploadedBy = TenantContext.current().userId;

    if (file.length === 0) throw new BadRequestException("קובץ ריק");
    if (file.length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException("הקובץ גדול מדי — עד 20MB");
    }
    const sniffed = sniffDocumentType(file);
    if (!sniffed) {
      throw new BadRequestException("פורמט לא נתמך — סרקו כ-PDF או צלמו את הדף");
    }

    /*
     * ‎**הצהרה על הסכם חתום מחייבת את פרטי החתימה.**
     *
     * המסמך הזה פותח את שער ההצעות בדיוק כמו חתימה במערכת, ושם
     * הלקוח ותאריך החתימה הם מה שהופך אותו לראיה ולא לקובץ. מסמך
     * שנשמר בלעדיהם היה פותח את השער בלי להשאיר דבר שאפשר להיתלות
     * בו אחר כך.
     */
    if (documentUnlocksOffers(input.kind)) {
      /*
       * ‎**הנכס ראשון, כי בלעדיו כל השאר חסר תועלת.**
       *
       * ‎`hasSigned` מחפש חתימה על נכס מסוים, ולכן שורה עם
       * ‎`property_id = NULL` אינה פותחת שום הצעה. המסך בכרטיס
       * הקונה לא ביקש נכס והודיע „אפשר לשלוח הצעות” — הבטחה
       * שהמערכת לא קיימה (ביקורת Codex). הבדיקה כאן ולא רק
       * בסכימה, כי זו הנקודה שבה השורה נכתבת.
       */
      if (input.propertyId === undefined) {
        throw new BadRequestException("הסכם חתום נוגע לנכס מסוים — בחרו את הנכס שההסכם חל עליו");
      }
      if (input.signerName === undefined || input.signerName.trim() === "") {
        throw new BadRequestException("מי חתם? השם נדרש כדי לשמור את המסמך כהסכם חתום");
      }
      if (input.signedOn === undefined) {
        throw new BadRequestException("מתי נחתם? התאריך נדרש כדי לשמור את המסמך כהסכם חתום");
      }
      /*
       * תאריך עתידי אינו „חתם מחר” אלא טעות הקלדה. שגיאה כאן זולה;
       * הסכם שמתוארך קדימה מופיע בכרטיס כאילו נחתם, והתאריך שנשלף
       * ממנו לוויכוח עתידי שגוי.
       *
       * ‎**לפי לוח השנה בישראל ולא מול הרגע.** השוואה מול
       * ‎`Date.now()` דחתה את „היום” עצמו בין חצות לשלוש לפנות בוקר
       * מקומית, כי חצות UTC של היום המקומי עדיין לא הגיע (ביקורת
       * Codex). מתווך שהחתים לקוח בערב ורשם את התאריך של אותו יום
       * נחסם.
       */
      if (isAfterJerusalemToday(input.signedOn, new Date())) {
        throw new BadRequestException("תאריך החתימה לא יכול להיות עתידי");
      }
    }

    const id = ulid();
    const s3Key = `tenants/${tenantId}/documents/${id}.${sniffed.ext}`;
    const fileHash = createHash("sha256").update(file).digest("hex");
    const fileName = safeFileName(input.fileName ?? "", `מסמך.${sniffed.ext}`).slice(0, 200);

    // בדיקה מוקדמת — כישלון זול לפני כתיבה לאחסון
    let label: string | undefined;
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, input.contactId);
      if (input.propertyId !== undefined) {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, tenantId, deletedAt: null },
          select: { id: true, city: true, neighborhood: true, street: true },
        });
        if (!property) throw new NotFoundException("נכס לא נמצא");
        /*
         * התווית נלקחת כאן ולא בשאילתה נוספת: הנכס כבר נקרא, וזו
         * אותה שורה בדיוק שהתגובה תתאר.
         */
        label = propertyLabel(property);
      }
      const count = await tx.signedDocument.count({
        where: { tenantId, contactId: input.contactId },
      });
      if (count >= MAX_DOCUMENTS_PER_CONTACT) {
        throw new BadRequestException(`עד ${MAX_DOCUMENTS_PER_CONTACT} מסמכים ללקוח`);
      }
    });

    // האחסון לפני הרשומה — כשל אחסון ⇒ אין שורה שמצביעה לכלום
    await this.storage.put(s3Key, file, sniffed.mime);

    let dto: SignedDocumentDto;
    try {
      dto = await this.prisma.withTenant(async (tx) => {
        /*
         * ‎**הנעילה והבדיקה החוזרת בטרנזקציה שכותבת, ולא רק לפניה.**
         *
         * הבדיקה המקדימה למעלה רצה בטרנזקציה נפרדת, ובין השתיים
         * יכולה להסתיים מחיקת לקוח. ל-`signed_documents.contact_id`
         * אין מפתח זר, ולכן ה-INSERT היה מצליח על כרטיס שכבר איננו:
         * שורה וקובץ ב-S3 שמצביעים ללקוח מחוק, מחוץ לניקוי המחיקה
         * ובלתי נגישים מהממשק (ביקורת Codex). ההעלאה גם הייתה
         * מדווחת „נשמר”.
         *
         * ‎`lockContact` היא אותה נעילה בדיוק שהמחיקה לוקחת ראשונה,
         * ולכן המפסיד במרוץ ממתין וקורא מחדש — ואז
         * ‎`assertContactAccess` נכשל כראוי.
         */
        await lockContact(tx, input.contactId);
        await assertContactAccess(tx, tenantId, input.contactId);
        /*
         * ‎**והנכס נבדק מחדש, תחת אותה נעילה שהמחיקה לוקחת.**
         *
         * הבדיקה המקדימה רצה לפני העלאת הקובץ ל-S3, ובין השתיים
         * אפשר למחוק את הנכס לצמיתות. שאילתת הניתוק של המחיקה כבר
         * רצה עד אז, ולכן השורה שנוצרת אחריה נושאת מזהה שאין
         * מאחוריו כלום — בדיוק המזהה האטום שסבב קודם בא לחסל
         * (ביקורת Codex).
         *
         * ‎`lockProperty` היא **אותה נעילה** ש-`PropertiesService.purge`
         * לוקחת, ולכן זו אינה הצרה של החלון אלא סגירתו: או שהמחיקה
         * סיימה ואז הבדיקה נכשלת, או שהיא ממתינה ואז הניתוק שלה
         * רואה את השורה הזו.
         *
         * הסדר כרטיס⟵נכס הוא הסדר שמסמך הנעילות מחייב; היפוכו הוא
         * ה-deadlock שכבר תועד שם.
         */
        if (input.propertyId !== undefined) {
          await lockProperty(tx, tenantId, input.propertyId);
          const live = await tx.property.findFirst({
            where: { id: input.propertyId, tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!live) throw new NotFoundException("נכס לא נמצא");
        }
        const row = await tx.signedDocument.create({
          data: {
            id,
            tenantId,
            kind: input.kind,
            contactId: input.contactId,
            propertyId: input.propertyId ?? null,
            fileName,
            mimeType: sniffed.mime,
            byteSize: file.length,
            s3Key,
            fileHash,
            signedOn: input.signedOn ?? null,
            signerName: input.signerName?.trim() ?? null,
            note: input.note?.trim() === "" ? null : (input.note ?? null),
            uploadedBy,
          },
        });
        await this.audit.record(tx, {
          action: "agreement.document_upload",
          entityType: "contact",
          entityId: input.contactId,
          /*
           * הגיבוב ביומן ולא רק בשורה: שורה אפשר למחוק, ורישום
           * הביקורת הוא Append-Only. מי שיצטרך להוכיח אילו בתים
           * הועלו באותו רגע ימצא אותם כאן.
           */
          metadata: {
            documentId: id,
            kind: input.kind,
            fileHash,
            byteSize: file.length,
            unlocksOffers: documentUnlocksOffers(input.kind),
          },
        });
        /*
         * ‎**התגובה נבנית באותה פונקציה שבונה כל שורה אחרת.**
         *
         * היא נבנתה כאן ביד, והצהירה על עצמה כ-`SignedDocumentDto`
         * בלי `propertyId` ו-`propertyLabel` — בדיוק שני השדות שנוספו
         * כדי שלא יהיה אפשר לבלבל בין נכסי אותו בעלים. זה לא נראה
         * במסך רק משום שהפאנל טוען מחדש אחרי ההעלאה, כלומר הנכונות
         * הייתה תלויה בהתנהגות הקורא ולא בקוד. צרכן שיציג את התגובה
         * עצמה — הסוכן, לקוח אחר — היה מקבל שורה בלי זהות נכס.
         */
        return this.toDto(row, {
          ...(label === undefined || input.propertyId === undefined
            ? {}
            : { labels: new Map([[input.propertyId, label]]) }),
        });
      });
    } catch (error) {
      await this.deleteObjectDurably(s3Key);
      throw error;
    }

    return dto;
  }

  /**
   * המסמכים של לקוח.
   *
   * ## למה `propertyId` מסנן, ובכל זאת לא מסתיר
   *
   * לבעל נכס אחד יכולים להיות כמה נכסים, וכולם תלויים באותו איש
   * קשר. בלי סינון, סריקת בלעדיות של נכס א' הופיעה בלשונית של נכס
   * ב' **בלי שום סימן לאיזה נכס היא שייכת** — כלומר אפשר היה לטעות
   * בה, ואפשר היה למחוק אותה כאילו הייתה של ב' (ביקורת Codex).
   *
   * הסינון כולל גם שורות בלי נכס: הצהרה על הסכם חייבת נכס, ולכן
   * שורה חסרת-נכס היא בהכרח „מסמך אחר” — תעודה או נספח ששייכים
   * ללקוח עצמו ורלוונטיים בכל אחד מהכרטיסים שלו.
   *
   * ‎**וכל שורה נושאת את זהות הנכס שלה** גם כשאין סינון (כרטיס
   * הקונה), כי שם דווקא רוצים לראות הכול — ואז ההבחנה היא מה
   * שמונע את אותה טעות.
   */
  async listForContact(contactId: string, propertyId?: string): Promise<SignedDocumentDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const { rows, labels } = await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, contactId);
      const found = await tx.signedDocument.findMany({
        where: {
          tenantId,
          contactId,
          /*
           * ‎**השורות חסרות-הנכס מסויגות לפי הסוג, ולא נלקחות כמובן
           * מאליו.**
           *
           * הנימוק המקורי היה „הצהרה על הסכם מחייבת נכס, ולכן שורה
           * חסרת-נכס היא בהכרח מסמך אחר”. זה נכון בכתיבה — ומחיקת
           * נכס לצמיתות מנתקת את הסריקה ממנו, ומייצרת בדיוק את
           * השורה שהטענה שוללת. הסתמכות על הטענה הייתה מחזירה הסכם
           * חתום מנכס שנמחק אל הלשונית של כל נכס אחר של אותו בעלים.
           *
           * התנאי בודק עכשיו את מה שהוא באמת צריך — הסוג — במקום
           * להסיק אותו מהיעדר ערך.
           */
          ...(propertyId === undefined
            ? {}
            : {
                OR: [
                  { propertyId },
                  { propertyId: null, kind: { notIn: [...OFFER_DOCUMENT_KINDS] } },
                ],
              }),
        },
        orderBy: { createdAt: "desc" },
        take: MAX_DOCUMENTS_PER_CONTACT,
      });
      return { rows: found, labels: await loadPropertyLabels(tx, tenantId, found) };
    });
    return rows.map((row) => this.toDto(row, { labels }));
  }

  /**
   * שורה ⟵ מה שהמסך מקבל.
   *
   * ‎`kind` מגיע מהמסד כמחרוזת. הוא נכתב רק דרך `upload`, שמקבל
   * ערך מאומת — אבל התצוגה לא תסמוך על כך ותציג „מסמך אחר” לערך
   * שאיננו מכירים, במקום תווית ריקה.
   *
   * ‎`retained` קובע **לאיזה נתיב הורדה** ה-DTO מפנה. הארכיון החזיר
   * את הנתיב הרגיל, וזה דוחה שורה מנותקת — כלומר הרשימה פרסמה
   * קישורים שכל אחד מהם 404 (ביקורת Codex). זו אותה מחלה: כתובת
   * שמבטיחה מה שאין מאחוריה.
   */
  private toDto(
    row: {
      id: string;
      kind: string;
      fileName: string;
      mimeType: string;
      byteSize: number;
      propertyId: string | null;
      signedOn: Date | null;
      signerName: string | null;
      note: string | null;
      createdAt: Date;
    },
    opts: { labels?: Map<string, string>; retained?: boolean } = {},
  ): SignedDocumentDto {
    const label = row.propertyId === null ? undefined : opts.labels?.get(row.propertyId);
    return {
      id: row.id,
      kind: (DOCUMENT_KINDS as readonly string[]).includes(row.kind)
        ? (row.kind as DocumentKind)
        : "other",
      fileName: row.fileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      ...(row.propertyId === null ? {} : { propertyId: row.propertyId }),
      ...(label === undefined ? {} : { propertyLabel: label }),
      ...(row.signedOn ? { signedOn: row.signedOn.toISOString() } : {}),
      ...(row.signerName ? { signerName: row.signerName } : {}),
      ...(row.note ? { note: row.note } : {}),
      createdAt: row.createdAt.toISOString(),
      url:
        opts.retained === true
          ? retainedDownloadPath(row.id)
          : documentDownloadPath(row.id),
    };
  }

  /**
   * המסמכים ששרדו מחיקת לקוח — ארכיון המשרד.
   *
   * ‎**בלי הרשימה הזו השמירה הייתה חסרת ערך.** מחיקת לקוח מנתקת
   * סריקה של הזמנה בכתב חתומה במקום למחוק אותה, כי היא ראיה
   * ובסיס הזכאות לדמי התיווך — אבל כל שאר המסלולים אליה עוברים
   * דרך כרטיס הלקוח, ולכרטיס אין קיום. התוצאה הייתה שורה שאיש
   * אינו יכול להגיע אליה, כלומר PII שנשמר לנצח בלי שישרת דבר
   * (ביקורת Codex). אותו פתרון בדיוק כמו ב-`listRetained` של
   * ההסכמים, ותחת אותה יכולת.
   */
  async listRetained(): Promise<SignedDocumentDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const { rows, labels } = await this.prisma.withTenant(async (tx) => {
      const found = await tx.signedDocument.findMany({
        where: { tenantId, contactId: null },
        orderBy: { signedOn: "desc" },
        take: 500,
      });
      /*
       * ‎**גם כאן זהות הנכס, ולא רק בכרטיס הלקוח.**
       *
       * לבעלים שנמחק יכולות להיות סריקות על כמה נכסים, וכאן אין
       * כרטיס שמפריד ביניהן. בלי התווית הארכיון הציג כמה הסכמים
       * חתומים שנבדלים רק בשם החותם ובתאריך — כלומר אי אפשר לדעת
       * על איזה נכס כל אחד חל בלי להוריד אותו (ביקורת Codex).
       */
      return { rows: found, labels: await loadPropertyLabels(tx, tenantId, found) };
    });
    return rows.map((row) => this.toDto(row, { labels, retained: true }));
  }

  /**
   * הקובץ עצמו, להורדה.
   *
   * ההורדה נרשמת ב-Audit: המסמך עוזב את המערכת, וזו הנקודה שבה יש
   * מה לתעד — אותו כלל בדיוק כמו בייצוא דוח הפעילות לבעל הנכס.
   *
   * ‎`retained` מסמן שהקורא הגיע מארכיון המשרד ולא מכרטיס לקוח.
   * שם הבעלות אינה ניתנת לבדיקה — אין כרטיס — ולכן השער הוא
   * היכולת שבנתיב (`settings.manage`), והוא חל **רק** על שורה
   * שכבר נותקה. שורה משויכת נבדקת מול הלקוח שלה כרגיל, גם במסלול
   * הזה.
   */
  async getRaw(id: string, opts: { retained?: boolean } = {}): Promise<{
    body: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
    fileName: string;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant(async (tx) => {
      const found = await tx.signedDocument.findFirst({
        where: { id, tenantId },
        select: { s3Key: true, mimeType: true, fileName: true, contactId: true },
      });
      if (!found) throw new NotFoundException("מסמך לא נמצא");
      /*
       * ‎**שער הבעלות כאן ולא רק ברשימה.** הרשימה נשלפת לפי לקוח
       * ועוברת `assertContactAccess`, אבל ההורדה מקבלת מזהה מסמך —
       * ובלי הבדיקה סוכן שמנחש מזהה היה מוריד מסמך חתום של לקוח
       * שאינו שלו.
       */
      if (found.contactId === null) {
        /*
         * שורה מנותקת שייכת לארכיון המשרד. היא נגישה רק דרך הנתיב
         * שגדור ב-`settings.manage`; מסלול הלקוח הרגיל אינו מגיע
         * אליה, כי אין לקוח שמולו לבדוק.
         */
        if (opts.retained !== true) {
          throw new NotFoundException("המסמך אינו משויך ללקוח — הלקוח נמחק מהמערכת");
        }
      } else {
        await assertContactAccess(tx, tenantId, found.contactId);
      }
      return found;
    });

    /*
     * ‎**האחזור לפני הרישום, והרישום לפני הזרימה.**
     *
     * הרישום ישב קודם בטרנזקציית ההרשאה, כלומר **לפני** שידענו אם
     * האובייקט בכלל קיים. בקשה שנענתה ב-404 או ב-500 השאירה ביומן
     * הביקורת שורה שאומרת „המסמך הורד” — ויומן שהוא Append-Only
     * מדווח מכאן על חשיפה שלא קרתה (ביקורת Codex). על מסמך חתום
     * זהו בדיוק התיעוד שקובע מי ראה מה, ורישום עודף בו גרוע מאין
     * רישום.
     *
     * הסדר הזה גם אינו יוצר את הכשל ההפוך: אם כתיבת היומן נכשלת,
     * הפונקציה זורקת והזרם אינו מוחזר — כלומר הבתים לא יצאו, ואין
     * חשיפה שלא נרשמה.
     */
    let obj: Awaited<ReturnType<StorageService["getObject"]>>;
    try {
      obj = await this.storage.getObject(row.s3Key);
    } catch (error) {
      // רק „האובייקט איננו” הוא 404; כשל תשתית זמני נשאר 500
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("הקובץ לא נמצא באחסון");
      }
      throw error;
    }

    /*
     * ‎**הרישום תלוי במה שהזרם עשה, ולא בכך שנפתח.**
     *
     * ‎`getObject` מחזיר זרם שטרם נקרא, ולכן רישום מיד אחריו הוא
     * עדיין טענה על העתיד: ניתוק באמצע היה משאיר ביומן הורדה שלא
     * הושלמה (ביקורת Codex).
     *
     * שלושת האירועים, ולא רק שניים: זרם שנהרס בלי שגיאה פולט
     * ‎`close` בלבד — ובלעדיו הייתה **הורדה בלי שום רישום**, שהיא
     * הכשל החמור מבין השלושה. הנעילה על יישוב יחיד מונעת שורה
     * כפולה כשגם `error` וגם `close` נפלטים.
     *
     * ‎**שמות התוצאות מתארים את מה שנצפה בפועל.** מה שנצפה כאן הוא
     * זרם המקור מ-S3, לא תגובת ה-HTTP: `source_completed` אינו
     * „הלקוח קיבל”, והוא לא ייקרא כך. חשבונאות ברמת ה-HTTP דורשת
     * ‎`@Res()` ושינוי מסלול ההורדה כולו — ראו ההערה ב-PR; לא הרחבתי
     * את ה-PR בשבילה, ולא אכנה בינתיים את מה שיש בשם חזק ממנו.
     */
    let settled = false;
    const writeAudit = (outcome: "source_completed" | "aborted"): void => {
      if (settled) return;
      settled = true;
      void this.prisma
        .withTenant((tx) =>
          this.audit.record(tx, {
            action: "agreement.document_download",
            entityType: row.contactId === null ? "tenant" : "contact",
            entityId: row.contactId ?? tenantId,
            metadata: { documentId: id, retained: row.contactId === null, outcome },
          }),
        )
        .catch((error: unknown) => {
          /*
           * ‎**לא נבלע.** ההערה הקודמת טענה שכשל „נרשם ביומן השרת”,
           * ולא היה שום רישום — כלומר תיאור שגוי של הקוד שמתחתיו
           * (ביקורת Codex). מסמך שנמסר בלי שורה ביומן הוא בדיוק
           * הפער שהמסלול הזה קיים כדי למנוע, ולכן הוא חייב להיות
           * גלוי למי שקורא את יומני השרת.
           */
          this.logger.error(
            `רישום הורדת מסמך ${id} נכשל (${outcome}): ${(error as Error).message}`,
          );
        });
    };
    obj.body.once("end", () => writeAudit("source_completed"));
    obj.body.once("error", () => writeAudit("aborted"));
    obj.body.once("close", () => writeAudit("aborted"));

    return {
      body: obj.body,
      contentType: obj.contentType ?? row.mimeType,
      ...(obj.contentLength !== undefined ? { contentLength: obj.contentLength } : {}),
      fileName: row.fileName,
    };
  }

  /**
   * מחיקת מסמך.
   *
   * ‎**מותרת, ונרשמת.** קובץ שהועלה בטעות — הדף הלא נכון, הלקוח הלא
   * נכון — חייב להיות ניתן להסרה, אחרת הלשונית מצטברת לזבל שאי אפשר
   * לנקות. מה שאסור הוא שהמחיקה תהיה שקטה: אם המסמך פתח את שער
   * ההצעות, הסרתו סוגרת אותו, ולכן היא נרשמת עם הסוג והגיבוב.
   */
  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    const s3Key = await this.prisma.withTenant(async (tx) => {
      const row = await tx.signedDocument.findFirst({
        where: { id, tenantId },
        select: { s3Key: true, contactId: true, kind: true, fileHash: true },
      });
      if (!row) throw new NotFoundException("מסמך לא נמצא");
      if (row.contactId === null) {
        throw new NotFoundException("המסמך אינו משויך ללקוח — הלקוח נמחק מהמערכת");
      }
      await assertContactAccess(tx, tenantId, row.contactId);
      await tx.signedDocument.delete({ where: { id } });
      await this.audit.record(tx, {
        action: "agreement.document_delete",
        entityType: "contact",
        entityId: row.contactId,
        metadata: {
          documentId: id,
          kind: row.kind,
          fileHash: row.fileHash,
          unlocksOffers: documentUnlocksOffers(row.kind),
        },
      });
      return row.s3Key;
    });
    await this.deleteObjectDurably(s3Key);
  }
}
