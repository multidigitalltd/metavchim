import { createHash } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  DOCUMENT_KINDS,
  MAX_DOCUMENT_BYTES,
  documentUnlocksOffers,
  safeFileName,
  sniffDocumentType,
  type DocumentKind,
} from "@metavchim/shared";
import { assertContactAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
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

@Injectable()
export class SignedDocumentsService {
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
       */
      if (input.signedOn.getTime() > Date.now()) {
        throw new BadRequestException("תאריך החתימה לא יכול להיות עתידי");
      }
    }

    const id = ulid();
    const s3Key = `tenants/${tenantId}/documents/${id}.${sniffed.ext}`;
    const fileHash = createHash("sha256").update(file).digest("hex");
    const fileName = safeFileName(input.fileName ?? "", `מסמך.${sniffed.ext}`).slice(0, 200);

    // בדיקה מוקדמת — כישלון זול לפני כתיבה לאחסון
    await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, input.contactId);
      if (input.propertyId !== undefined) {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!property) throw new NotFoundException("נכס לא נמצא");
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

    let createdAt: Date;
    try {
      createdAt = await this.prisma.withTenant(async (tx) => {
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
          select: { createdAt: true },
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
        return row.createdAt;
      });
    } catch (error) {
      await this.deleteObjectDurably(s3Key);
      throw error;
    }

    return {
      id,
      kind: input.kind,
      fileName,
      mimeType: sniffed.mime,
      byteSize: file.length,
      ...(input.signedOn ? { signedOn: input.signedOn.toISOString() } : {}),
      ...(input.signerName ? { signerName: input.signerName.trim() } : {}),
      ...(input.note && input.note.trim() !== "" ? { note: input.note.trim() } : {}),
      createdAt: createdAt.toISOString(),
      url: documentDownloadPath(id),
    };
  }

  /**
   * המסמכים של לקוח.
   *
   * ‎**בלי סינון לפי נכס.** הלשונית מוצגת גם בכרטיס הקונה, שאין לו
   * נכס בהקשר, וגם בכרטיס הנכס — ובשניהם המתווך מחפש „מה יש לי על
   * הלקוח הזה”. סינון היה מסתיר מסמך שהועלה מהמסך השני, בלי שום סימן
   * שהוא קיים.
   */
  async listForContact(contactId: string): Promise<SignedDocumentDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant(async (tx) => {
      await assertContactAccess(tx, tenantId, contactId);
      return tx.signedDocument.findMany({
        where: { tenantId, contactId },
        orderBy: { createdAt: "desc" },
        take: MAX_DOCUMENTS_PER_CONTACT,
      });
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * שורה ⟵ מה שהמסך מקבל.
   *
   * ‎`kind` מגיע מהמסד כמחרוזת. הוא נכתב רק דרך `upload`, שמקבל
   * ערך מאומת — אבל התצוגה לא תסמוך על כך ותציג „מסמך אחר” לערך
   * שאיננו מכירים, במקום תווית ריקה.
   */
  private toDto(row: {
    id: string;
    kind: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    signedOn: Date | null;
    signerName: string | null;
    note: string | null;
    createdAt: Date;
  }): SignedDocumentDto {
    return {
      id: row.id,
      kind: (DOCUMENT_KINDS as readonly string[]).includes(row.kind)
        ? (row.kind as DocumentKind)
        : "other",
      fileName: row.fileName,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      ...(row.signedOn ? { signedOn: row.signedOn.toISOString() } : {}),
      ...(row.signerName ? { signerName: row.signerName } : {}),
      ...(row.note ? { note: row.note } : {}),
      createdAt: row.createdAt.toISOString(),
      url: documentDownloadPath(row.id),
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
    const rows = await this.prisma.withTenant((tx) =>
      tx.signedDocument.findMany({
        where: { tenantId, contactId: null },
        orderBy: { signedOn: "desc" },
        take: 500,
      }),
    );
    return rows.map((row) => this.toDto(row));
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
      await this.audit.record(tx, {
        action: "agreement.document_download",
        entityType: found.contactId === null ? "tenant" : "contact",
        entityId: found.contactId ?? tenantId,
        metadata: { documentId: id, retained: found.contactId === null },
      });
      return found;
    });

    try {
      const obj = await this.storage.getObject(row.s3Key);
      return {
        body: obj.body,
        contentType: obj.contentType ?? row.mimeType,
        ...(obj.contentLength !== undefined ? { contentLength: obj.contentLength } : {}),
        fileName: row.fileName,
      };
    } catch (error) {
      // רק „האובייקט איננו” הוא 404; כשל תשתית זמני נשאר 500
      if (StorageService.isMissingObjectError(error)) {
        throw new NotFoundException("הקובץ לא נמצא באחסון");
      }
      throw error;
    }
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
