import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { AGREEMENT_KIND_LABELS, AGREEMENT_KINDS_ON_PROPERTY, BuyerRequirementsSchema, agreementAllowsOpenLink, agreementDealLabel, agreementRequiresProperty, jerusalemDayStart, OPEN_SIGNER_PLACEHOLDERS, openSignerBlanks, pendingAgreementRank, pendingAgreementState, REQUIRED_PLACEHOLDERS, SIGNER_BLANK, SIGNER_PROVIDED_PLACEHOLDERS, defaultAgreementTemplate, fillSignerId, formatIsraeliNumber, formatJerusalemDate, renderAgreement, type AgreementKind, type AgreementValues, type PendingAgreementState, whatsappLink } from "@metavchim/shared";
import {
  actionablePropertyIds,
  propertyRecordInScope,
  actionablePropertyWhere,
  assertPropertyRecordScope,
  contactGateFor,
  orphanContactCondition,
  visibleContactIds,
} from "../../common/ownership";
import { actingUserId, officeContext, TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailService } from "../../core/email.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { BuyersService } from "../buyers/buyers.service";
import { ContactsService } from "../contacts/contacts.service";
import { TenantLogoService } from "../../core/tenant-logo.service";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { MessagingService } from "../messaging/messaging.service";
import { recordMentorWin } from "../../common/mentor-wins";

/**
 * הסכמים לחתימה דיגיטלית.
 *
 * מודל הראיות (בעקבות comsign): מה נחתם, בידי מי, מתי, ומאיזה
 * IP/דפדפן. הנוסח נשמר כצילום ברגע השליחה — לא כהפניה לתבנית — כדי
 * ששינוי מאוחר בנוסח המשרד לא ישנה הסכם שכבר נחתם. גיבוב הנוסח
 * מאפשר להוכיח בדיעבד שהטקסט לא הוחלף.
 */

const TOKEN_TTL_DAYS = 30;

export interface AgreementSummary {
  id: string;
  kind: AgreementKind;
  kindLabel: string;
  status: string;
  /** null = הלקוח נמחק וההסכם החתום נשמר בארכיון המשרד. */
  contactId: string | null;
  propertyId?: string;
  signedAt?: Date;
  sentAt?: Date;
  url: string;
  createdAt: Date;
  /** האם ללקוח יש כתובת אימייל — קובע אם כפתור "שלח במייל" מוצג */
  canEmail: boolean;
}

export interface PendingAgreementRow {
  id: string;
  kind: AgreementKind;
  kindLabel: string;
  contactId: string;
  contactName: string;
  propertyId: string | null;
  state: PendingAgreementState;
  /** ימים מאז השליחה. `null` = לא נשלח מעולם. */
  daysWaiting: number | null;
  /** קישור החתימה. ריק כשפג — קישור שפג אינו קישור. */
  url: string | null;
}

export interface PublicAgreementView {
  kind: AgreementKind;
  kindLabel: string;
  officeName: string;
  /** נתיב ציבורי ללוגו המשרד, או `null` כשאין. */
  logoUrl: string | null;
  body: string;
  status: string;
  signedAt?: Date;
  signerName?: string;
  bodyHash: string;
  /**
   * האם זה קישור **פתוח** — כלומר על החותם למלא גם את פרטיו ואת הנכס.
   *
   * ‏המסך אינו יכול להסיק את זה מהנוסח: שורת מילוי נראית אותו דבר
   * ‏בשני המקרים. השרת יודע, כי אצלו יושב הנוסח הקפוא.
   */
  openLink: boolean;
}

/**
 * ‎**מה שהחותם של קישור פתוח ממלא בעצמו.**
 *
 * ‏אלה השדות של `OPEN_SIGNER_PLACEHOLDERS` בלבוש של הטופס: שם
 * ‏ומספר זיהוי כבר נוסעים ב-`sign` לכל הסכם, וכאן נוספים
 * ‏הכתובת, הטלפון, סוג העסקה והנכס שבו מדובר.
 *
 * ‎`phone` הוא היחיד שאינו רק טקסט למסמך: הוא גם מה שמזהה לקוח
 * ‏קיים, ולכן „אם זה לקוח קיים ההסכם ייכנס לו לכרטיס”.
 */
export interface OpenSignerAnswers {
  address: string;
  phone: string;
  /** sale | rent — הקטלוג של הנכסים, ולא ניסוח חופשי */
  dealType: string;
  propertyText: string;
  priceText: string;
}

/**
 * מהתשובות של החותם אל שדות הנוסח.
 *
 * ‏המיפוי יושב כאן ולא בבקר, כי גם `createOpen` וגם `sign` צריכים
 * ‏להסכים על אותם שמות — והשמות עצמם מגיעים מ-
 * ‎`OPEN_SIGNER_PLACEHOLDERS`.
 */
function openSignerValues(
  signerName: string,
  signerIdNumber: string,
  open: OpenSignerAnswers | undefined,
): Partial<AgreementValues> {
  return {
    שם_הלקוח: signerName,
    תעודת_זהות_הלקוח: signerIdNumber,
    כתובת_הלקוח: open?.address ?? "",
    טלפון_הלקוח: open?.phone ?? "",
    סוג_העסקה: agreementDealLabel(open?.dealType),
    תיאור_הנכס: open?.propertyText ?? "",
    מחיר_משוער: open?.priceText ?? "",
  };
}

/**
 * ‎**פרטי חובה חסרים בהסכם — שגיאה שנושאת את **מה** חסר.**
 *
 * ‏הנוסח היה קבוע כאן ודיבר על „שליחת הסכם לחתימה”, וזה נכון רק
 * ‏למי שבאמת לחץ „שלח לחתימה”. שער ההצעות מפיק הסכם בעצמו, ולכן
 * ‏משרד חדש שלחץ „שלח הצעה” קיבל הודעה על פעולה שלא ביקש — ובלי
 * ‏שום רמז לקשר בין השתיים (נמצא בבדיקת QA מול המערכת החיה).
 *
 * ‏הכלל — **אילו** שדות חובה — נשאר כאן, במקום אחד. הניסוח עובר
 * ‏לקורא, כי רק הוא יודע על מה המשתמש לחץ.
 */
export class AgreementFieldsMissingError extends BadRequestException {
  constructor(readonly fields: readonly string[]) {
    super(
      `אי אפשר לשלוח הסכם לחתימה בלי פרטי החובה: ${fields.join(", ")}. ` +
        "השלימו אותם בהגדרות המשרד או בטופס השליחה.",
    );
  }

  /**
   * ‏אותה חסימה, בניסוח הפעולה שהמשתמש באמת לחץ עליה — לכל מי
   * ‏שמפיק הזמנה בכתב כשער בדרך למשהו אחר (הצעה, דף השוואה).
   *
   * ‏רק הפתיח משתנה; רשימת השדות ממשיכה לבוא מהשגיאה, ולכן גם
   * ‏„מה חובה” וגם „איך אומרים שחסר” נשארים כל אחד במקום אחד.
   */
  forAction(action: string): BadRequestException {
    return new BadRequestException(
      `${action} צריך שהלקוח יחתום על הזמנה בכתב, ולהפקתה חסרים פרטי חובה: ` +
        `${this.fields.join(", ")}. השלימו אותם בהגדרות המשרד ואז נסו שוב.`,
    );
  }
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    /*
     * ‎**כרטיס קונה** — לחותם של קישור פתוח שעדיין אין לו כזה.
     * ‏אין כאן מעגל: `BuyersModule` אינו מכיר את `AgreementsModule`
     * ‏לא במישרין ולא דרך מה שהוא מייבא.
     */
    private readonly buyers: BuyersService,
    private readonly audit: AuditService,
    private readonly messaging: MessagingService,
    private readonly email: EmailService,
    private readonly emailInbox: EmailInboxService,
    private readonly logo: TenantLogoService,
  ) {}

  /**
   * ‎**הלוגו של המשרד, לדף החתימה הציבורי.**
   *
   * המשרד נגזר מהשורה שהטוקן פתח — לעולם לא מקלט של הקורא. הטוקן
   * שפג אינו חוסם כאן בכוונה: הוא חוסם את המסמך, ואילו הלוגו הוא
   * נכס מותג שכבר הוצג למי שקיבל את הקישור.
   */
  async publicLogo(
    token: string,
  ): Promise<{ body: NodeJS.ReadableStream; contentType: string; contentLength?: number }> {
    const tenantId = await this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({
        where: { publicToken: token },
        select: { tenantId: true },
      });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      return row.tenantId;
    });
    return this.logo.rawFor(tenantId);
  }

  private publicUrl(token: string): string {
    return `${loadEnv().WEB_ORIGIN}/sign/${token}`;
  }

  static hashBody(body: string): string {
    return createHash("sha256").update(body, "utf8").digest("hex");
  }

  /** הנוסח של המשרד, או ברירת המחדל כשלא הותאם. */
  private async templateFor(tx: TenantTx, kind: AgreementKind): Promise<string> {
    const row = await tx.agreementTemplate.findFirst({
      where: { tenantId: TenantContext.current().tenantId, kind },
    });
    return row?.body ?? defaultAgreementTemplate(kind);
  }

  /**
   * האם ללקוח יש הסכם חתום מסוג נתון. זו הבדיקה ששולטת בשער
   * ההצעות — הצעה לא נחשפת ללקוח שטרם חתם על הזמנה בכתב.
   */
  /**
   * ה-tenantId מפורש ולא מ-TenantContext: הבדיקה נקראת גם מהדף
   * הציבורי של ההצעה, שרץ בלי הקשר בקשה מאומת — שם הקריאה ל-context
   * הייתה זורקת.
   */
  async hasSigned(
    tx: TenantTx,
    tenantId: string,
    contactId: string,
    kind: AgreementKind,
    propertyId?: string,
  ): Promise<boolean> {
    // ההזמנה בכתב נוקבת בנכס מסוים, ולכן חתימה עליו אינה מכסה נכס
    // אחר. בלי הסינון הזה חתימה אחת הייתה פותחת את השער לכל הנכסים
    // שיוצעו ללקוח מכאן והלאה (ביקורת Codex).
    const scope = { tenantId, contactId, kind, propertyId: propertyId ?? null };

    const signed = await tx.agreement.findFirst({
      where: { ...scope, status: "signed" },
      select: { id: true },
    });
    if (signed !== null) return true;

    /*
     * ‎**וגם מסמך שנחתם על נייר.**
     *
     * חוק המתווכים מתנה את דמי התיווך בהזמנה בכתב חתומה — לא בהזמנה
     * שנחתמה דווקא במסך שלנו. מתווך שהחתים לקוח על דף וסרק אותו
     * מחזיק בדיוק את מה שהשער הזה בודק, ובלי השורה הזו המערכת הייתה
     * מסרבת להראות לו הצעה על לקוח שחתם — בלי שום מסלול לתקן זאת.
     *
     * ‎`kind` נשמר באותם ערכים בשתי הטבלאות (shared —
     * `documentUnlocksOffers`), ולכן אותו `scope` בדיוק: אותו לקוח,
     * אותו סוג, ואותו נכס. מסמך מסוג `other` אינו נושא ערך כזה
     * ולעולם אינו מתאים כאן.
     *
     * ‎`signedOn: { not: null }` — לא ייתור: `upload` דורש תאריך
     * חתימה בדיוק לסוגים האלה, וזו העמודה שאומרת „הוצהר עליו
     * כחתום”. שורה בלעדיה היא נתון שלא היה אמור להיכתב, ואינה
     * פותחת שער.
     */
    const onPaper = await tx.signedDocument.findFirst({
      where: { ...scope, signedOn: { not: null } },
      select: { id: true },
    });
    return onPaper !== null;
  }

  /**
   * ‎**אותה הכרעה כמו `hasSigned`, לקבוצה — בשתי שאילתות במקום פי שתיים
   * ממספר הנבדקים.**
   *
   * ‎`hasSigned` מריצה שתי שאילתות לכל בדיקה, וזה בסדר גמור לשער של
   * פעולה בודדת. הסבב האוטומטי קורא לה **בלולאה בתוך טרנזקציה אחת**,
   * ומספר המועמדים אינו חסום: ייבוא או חישוב-מחדש המוני מייצרים אלפי
   * התאמות חזקות, וכל אחת מהן שתי שאילתות נוספות. משרד אחד היה מחזיק
   * טרנזקציה פתוחה לאלפי שאילתות כל עשר דקות ומעכב את כל השאר
   * (ביקורת Codex).
   *
   * מחזיר את הצמדים שנחתמו, כ-`contactId:propertyId`. **אותם שני
   * מקורות בדיוק** כמו `hasSigned` — חתימה דיגיטלית ומסמך שנסרק — כי
   * שתיהן חייבות להסכים: שער שמחמיר בקבוצה יותר מאשר ביחיד חוסם
   * לקוחות שחתמו על נייר.
   */
  async signedPairs(
    tx: TenantTx,
    tenantId: string,
    kind: AgreementKind,
    contactIds: readonly string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(contactIds)];
    if (ids.length === 0) return new Set();
    const scope = { tenantId, contactId: { in: ids }, kind, propertyId: { not: null } };
    const [agreements, documents] = await Promise.all([
      tx.agreement.findMany({
        where: { ...scope, status: "signed" },
        select: { contactId: true, propertyId: true },
      }),
      tx.signedDocument.findMany({
        // אותה עמודה שמעידה „הוצהר כחתום” — ראו הנימוק ב-`hasSigned`
        where: { ...scope, signedOn: { not: null } },
        select: { contactId: true, propertyId: true },
      }),
    ]);
    return new Set(
      [...agreements, ...documents].map((row) => `${row.contactId!}:${row.propertyId!}`),
    );
  }

  /** הסכם ממתין קיים — כדי לא להציף את הלקוח בקישורים כפולים. */
  async pendingFor(
    tx: TenantTx,
    contactId: string,
    kind: AgreementKind,
    propertyId?: string,
  ): Promise<{ id: string; publicToken: string } | null> {
    return tx.agreement.findFirst({
      where: {
        tenantId: TenantContext.current().tenantId,
        contactId,
        kind,
        // אותו היקף בדיוק כמו ב-hasSigned: מסמך ממתין על נכס אחד לא
        // נחשב "כבר נשלח" עבור נכס אחר
        propertyId: propertyId ?? null,
        status: { in: ["pending", "viewed"] },
        tokenExpires: { gt: new Date() },
      },
      select: { id: true, publicToken: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * יצירת הסכם ושליחתו. מחזיר הסכם ממתין קיים אם יש — שליחה חוזרת
   * לא מייצרת שני מסמכים שונים לאותו לקוח.
   */
  async create(
    tx: TenantTx,
    input: { kind: AgreementKind; contactId: string; propertyId?: string; values?: Partial<AgreementValues> },
  ): Promise<{ id: string; url: string; unfilled: string[]; reused: boolean }> {
    const { tenantId, userId } = TenantContext.current();

    /*
     * בדיקת הבעלות רצה **ראשונה**, לפני כל דבר אחר.
     *
     * הכניסה לכאן היא מכמה נתיבים (POST /agreements, שער ההצעות),
     * וכשהיא ישבה רק באחד מהם — סוכן עם offers.send ו-buyers.view_own
     * יכול היה להעביר מזהה איש קשר של סוכן אחר ולקבל בחזרה קישור
     * חתימה נושא־טוקן ללקוח שאינו שלו. הענף של "הסכם ממתין קיים"
     * החזיר את הקישור מיד, בלי שום בדיקה (ביקורת Codex).
     */
    /*
     * ‎**והנכס, כשההסכם נושא נכס.** שער הלקוח הוא איחוד, ולכן לקוח
     * ‏שקונה דרכי ומוכר דרך עמית פתח דרכי הסכם בלעדיות על הנכס של
     * ‏העמית (ביקורת Codex, P1).
     */
    /*
     * ‎**וסוג שהוא „על נכס” חייב נכס — אחרת השער נסוג מעצמו**
     * ‏(ביקורת Codex, P1, סבב שני).
     *
     * ‏`assertPropertyRecordScope` בודק את הנכס **כשיש** נכס, ובלי
     * ‏`propertyId` הוא חוזר מיד אחרי שער הלקוח. להזמנה בכתב זה
     * ‏נכון — היא התקשרות עם אדם. לבלעדיות זה לא: היא נִתנת על חלקה
     * ‏מסוימת, ולכן השמטת המזהה אינה שדה חסר אלא **עקיפה**.
     *
     * ‏מה שהיה אפשרי: סוכן שרואה לקוח דרך כרטיס קונה משלו הפיק
     * ‏עליו הסכם בלעדיות בלי `propertyId`, ותיאר את הנכס של העמית
     * ‏בטקסט חופשי — `תיאור_הנכס`, `מחיר_משוער` ו-`תקופת_בלעדיות`
     * ‏נפרסים מ-`input.values` לתוך המסמך, והתוצאה היא מסמך
     * ‏בלעדיות לחתימה על נכס שאינו שלו.
     *
     * ‏כאן ולא בסכמת הבקר: לשירות שני קוראים (הבקר, ושער ההצעות),
     * ‏ורק אחד מהם עובר בסכמה.
     */
    if (agreementRequiresProperty(input.kind) && (input.propertyId ?? null) === null) {
      throw new BadRequestException(
        `${AGREEMENT_KIND_LABELS[input.kind]} נִתן על נכס מסוים — בחרו את הנכס`,
      );
    }

    await assertPropertyRecordScope(
      tx,
      tenantId,
      {
        requiresProperty: agreementRequiresProperty(input.kind),
        contactId: input.contactId,
        propertyId: input.propertyId ?? null,
      },
      "הפקת הסכם על נכס",
    );

    /*
     * שחרור הסכמים שפג תוקפם, לפני הכל.
     *
     * `pendingFor` מפסיק במכוון למחזר קישור שפג — הלקוח כבר לא יכול
     * לחתום עליו. אבל האינדקס הייחודי מסתכל על הסטטוס בלבד (תנאי
     * אינדקס ב-Postgres חייב להיות אימוטבילי, ולכן `now()` לא יכול
     * להשתתף בו), כך שהשורה שפגה הייתה חוסמת לנצח כל הסכם חדש לאותו
     * לקוח, סוג ונכס — היקף שנתקע בלי דרך לצאת ממנו (ביקורת Codex).
     *
     * המעבר ל-expired הוא גם התיעוד: רואים שההסכם נשלח ולא נחתם.
     */
    await tx.agreement.updateMany({
      where: {
        tenantId,
        contactId: input.contactId,
        kind: input.kind,
        propertyId: input.propertyId ?? null,
        status: { in: ["pending", "viewed"] },
        tokenExpires: { lte: new Date() },
      },
      data: { status: "expired" },
    });

    const existing = await this.pendingFor(tx, input.contactId, input.kind, input.propertyId);
    if (existing) {
      return { id: existing.id, url: this.publicUrl(existing.publicToken), unfilled: [], reused: true };
    }

    const contact = await this.contacts.getById(tx, input.contactId);
    if (!contact) throw new NotFoundException("איש הקשר לא נמצא");

    const values = await this.collectValues(tx, contact, input);
    const template = await this.templateFor(tx, input.kind);
    const { text, unfilled } = renderAgreement(template, values);

    /*
     * מסמך לא שלם לא נקפא ולא נשלח.
     *
     * קודם הוא כן: פרטי חובה שלא הוזנו הודפסו בגוף ההסכם כ-[חסר: …],
     * הלקוח חתם, ו-hasSigned פתח את שער ההצעות — כלומר בדיוק ההגנה
     * המשפטית שהפיצ'ר קיים בשבילה נשחקה בשקט. עדיף להיעצר כאן עם
     * הודעה שאומרת מה למלא ואיפה (ביקורת Codex).
     *
     * תעודת הזהות יוצאת מן הכלל: היא נכנסת לנוסח ברגע החתימה, מהחותם
     * עצמו — ולכן מוצגת עד אז כשורה למילוי ולא כשדה חסר.
     */
    const blocking = unfilled.filter(
      (name) =>
        REQUIRED_PLACEHOLDERS[input.kind].includes(name as keyof AgreementValues) &&
        !SIGNER_PROVIDED_PLACEHOLDERS.includes(name as keyof AgreementValues),
    );
    if (blocking.length > 0) {
      throw new AgreementFieldsMissingError(blocking.map((name) => name.replace(/_/gu, " ")));
    }

    const token = randomBytes(32).toString("base64url");
    /*
     * המחזור של "הסכם ממתין קיים" למעלה הוא בדיקה ואז יצירה — ושתי
     * בקשות במקביל ראו שתיהן "אין שורה" וייצרו שני מסמכים עם שני
     * טוקנים. כיוון שנעילת החתימה מותנית בשורה, כל אחד מהם היה ניתן
     * לחתימה בנפרד: שתי חתימות על אותה הזמנה (ביקורת Codex).
     *
     * האכיפה עברה למסד — אינדקס ייחודי חלקי על הסכם פעיל. המפסיד
     * במרוץ מקבל הודעה ברורה במקום מסמך כפול; אי אפשר לקרוא כאן את
     * השורה המנצחת, כי הפרת האילוץ כבר ביטלה את הטרנזקציה.
     */
    const row = await tx.agreement
      .create({
        data: {
          id: ulid(),
          tenantId,
          kind: input.kind,
          contactId: input.contactId,
          propertyId: input.propertyId ?? null,
          renderedBody: text,
          bodyHash: AgreementsService.hashBody(text),
          presentedHash: AgreementsService.hashBody(text),
          publicToken: token,
          tokenExpires: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
          createdBy: userId,
        },
      })
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new BadRequestException("הסכם לחתימה כבר נשלח ללקוח — רעננו את המסך");
        }
        throw error;
      });

    await this.audit.record(tx, {
      action: "agreement.send",
      entityType: "agreement",
      entityId: row.id,
      metadata: { kind: input.kind, contactId: input.contactId },
    });

    return { id: row.id, url: this.publicUrl(token), unfilled, reused: false };
  }

  /**
   * ‎**קישור החתמה בלי לקוח ובלי נכס** — הצד השני של `create`.
   *
   * ## ‏למה זו פעולה נפרדת ולא `contactId` אופציונלי
   *
   * ‏`create` שלם סביב לקוח ידוע: הוא ממחזר הסכם ממתין קיים, בודק
   * ‏את הבעלות על הכרטיס ועל הנכס, ונכשל כשפרט חובה של הלקוח חסר.
   * ‏כל אחד מהם הוא בדיוק ההתנהגות הנכונה שם, וכל אחד מהם היה
   * ‏צריך ענף „אלא אם אין לקוח” — ארבעה ענפים בתוך פונקציה שכל
   * ‏תפקידה הוא להוציא מסמך משפטי. כאן אין מה למחזר (שני לקוחות
   * ‏שנפגשו באותו יום צריכים שני קישורים) ואין בעלות לבדוק, כי אין
   * ‏על מי.
   *
   * ## ‏מה כן נשמר
   *
   * ‏פרטי **המשרד** נבדקים בדיוק כמו ב-`create`: מסמך בלי דמי
   * ‏תיווך או בלי מועד תשלום אינו מסמך תקף, והחותם אינו יכול
   * ‏להשלים אותם. מה שהחותם כן משלים (`OPEN_SIGNER_PLACEHOLDERS`)
   * ‏נשאר בנוסח כשורטקוד ומתמלא ברגע החתימה.
   */
  async createOpen(tx: TenantTx, input: { kind: AgreementKind }): Promise<{ id: string; url: string }> {
    const { tenantId, userId } = TenantContext.current();

    /*
     * ‎**בלעדיות אינה נִתנת בקישור פתוח** — אותו שער בדיוק שמחייב
     * ‏`propertyId` ב-`create`, ומאותו נימוק: היא נִתנת על חלקה
     * ‏מסוימת של המשרד. „בלעדיות שהלקוח מתאר בעצמו” היא מסמך על
     * ‏נכס שאיש במשרד לא בדק.
     */
    if (!agreementAllowsOpenLink(input.kind)) {
      throw new BadRequestException(
        `${AGREEMENT_KIND_LABELS[input.kind]} נִתן על נכס מסוים של המשרד — אי אפשר להפיק אותו בקישור פתוח`,
      );
    }

    const template = await this.templateFor(tx, input.kind);
    const frozen = renderAgreement(template, await this.officeValues(), {
      keep: OPEN_SIGNER_PLACEHOLDERS,
    });
    /*
     * ‏אותו כלל של `create`: מסמך לא שלם לא נקפא ולא נשלח. השדות
     * ‏שהחותם ימלא אינם יכולים להופיע כאן בכלל — `keep` מוציא אותם
     * ‏מ-`unfilled` — ולכן כל מה שנשאר הוא פרט משרד שלא הוזן.
     */
    const blocking = frozen.unfilled.filter((name) =>
      REQUIRED_PLACEHOLDERS[input.kind].includes(name as keyof AgreementValues),
    );
    if (blocking.length > 0) {
      throw new AgreementFieldsMissingError(blocking.map((name) => name.replace(/_/gu, " ")));
    }

    /*
     * ‏הנוסח שהחותם רואה לפני שמילא — שורות למילוי במקום השורטקוד.
     * ‏הוא גם מה שנכנס ל-`presented_hash`: „מה הוצג” הוא בדיוק זה.
     */
    const preview = renderAgreement(frozen.text, openSignerBlanks()).text;
    const token = randomBytes(32).toString("base64url");
    const row = await tx.agreement.create({
      data: {
        id: ulid(),
        tenantId,
        kind: input.kind,
        contactId: null,
        propertyId: null,
        signerTemplate: frozen.text,
        renderedBody: preview,
        bodyHash: AgreementsService.hashBody(preview),
        presentedHash: AgreementsService.hashBody(preview),
        publicToken: token,
        tokenExpires: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        createdBy: userId,
      },
    });

    await this.audit.record(tx, {
      action: "agreement.open_link",
      entityType: "agreement",
      entityId: row.id,
      metadata: { kind: input.kind },
    });

    return { id: row.id, url: this.publicUrl(token) };
  }

  /**
   * שליחת הקישור ללקוח בפועל.
   *
   * עד כה הקישור רק **הוצג** על המסך, והמתווך היה אמור להעתיק אותו
   * לאנשהו. זה נקודת הנשירה של כל התהליך: מסמך שנוצר ולא נשלח אינו
   * מסמך.
   *
   * וואטסאפ הוא ערוץ ברירת המחדל כי טלפון הוא שדה חובה על כל איש קשר
   * ואילו אימייל הוא רשות — כלומר לחלק גדול מהלקוחות פשוט אין כתובת
   * שאליה אפשר לשלוח. הקישור מוחזר לדפדפן ונפתח שם, כמו בעדכון לבעל
   * הנכס ובשליחת ההצעות.
   */
  async deliver(
    tx: TenantTx,
    id: string,
    channel: "whatsapp" | "email",
  ): Promise<{ waUrl?: string; sentTo?: string; message: string }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await tx.agreement.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("ההסכם לא נמצא");
    /*
     * בדיקת הבעלות על איש הקשר, לא רק על הדייר.
     *
     * התשובה כוללת את הקישור נושא־הטוקן, בדיוק כמו ב-`listForContact`
     * — ומי שמחזיק בו יכול לחתום בשם הלקוח.
     */
    /*
     * הסכם מנותק הוא תמיד הסכם חתום ששרד מחיקת לקוח — אין למי
     * לשלוח אותו, ואין כרטיס לבדוק עליו הרשאה.
     */
    if (row.contactId === null) {
      throw new BadRequestException("ההסכם אינו משויך ללקוח — הלקוח נמחק מהמערכת");
    }
    /* ‏הלקוח וגם הנכס — התשובה נושאת את קישור החתימה עצמו */
    await assertPropertyRecordScope(
      tx,
      tenantId,
      {
        requiresProperty: agreementRequiresProperty(row.kind),
        contactId: row.contactId,
        propertyId: row.propertyId,
      },
      "שליחת הסכם על נכס",
    );
    if (row.status === "signed") throw new BadRequestException("ההסכם כבר נחתם");
    if (row.status === "declined") throw new BadRequestException("הלקוח דחה את ההסכם");
    if (row.tokenExpires < new Date()) {
      throw new GoneException("תוקף הקישור פג — צרו הסכם חדש");
    }

    const contact = await this.contacts.getById(tx, row.contactId);
    if (!contact) throw new NotFoundException("איש הקשר לא נמצא");

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    const officeName = tenant?.name ?? "המשרד";
    const kindLabel = AGREEMENT_KIND_LABELS[row.kind as AgreementKind];
    const url = this.publicUrl(row.publicToken);
    const message = [
      `שלום ${contact.name},`,
      `מצורף ${kindLabel} מאת ${officeName} לחתימה דיגיטלית:`,
      url,
      "החתימה נעשית בדפדפן, ללא צורך בהדפסה. הקישור אישי — נא לא להעביר.",
    ].join("\n");

    if (channel === "email") {
      if (!contact.email) {
        throw new BadRequestException("לאיש הקשר אין כתובת אימייל — שלחו בוואטסאפ");
      }
      if (!(await this.email.isConfigured())) {
        throw new BadRequestException("שליחת אימייל אינה מוגדרת במערכת — שלחו בוואטסאפ");
      }
      /*
       * תשובת הלקוח ("מתי אפשר לדבר?", "יש טעות בסכום") חוזרת
       * לתיבה הפנימית ולציר — ולא לתיבת no-reply שאיש לא קורא.
       * null כשהתיבה לא הוגדרה — המייל יוצא כרגיל בלעדיה.
       */
      const replyTo = await this.emailInbox.replyAddressFor(
        tenantId,
        row.contactId,
        /* ‏מי ששלח את ההסכם — תשובת הלקוח עליו חוזרת אליו */
        actingUserId(),
        /*
         * ‎**הנכס, כשלהסכם יש אחד.** „יש טעות בסכום” על הסכם
         * ‏בלעדיות הוא על נכס מסוים, ולקוח עם שני הסכמים פתוחים
         * ‏אינו נותן לסוכן דרך לדעת על איזה מהם.
         *
         * ‏הסכם בלי נכס (ייפוי כוח כללי) — אין מה לתייג, ולא
         * ‏ממציאים.
         */
        row.propertyId === null ? null : { kind: "property", id: row.propertyId },
      );
      await this.email.send(
        contact.email,
        `${kindLabel} לחתימה — ${officeName}`,
        {
          heading: `${kindLabel} לחתימה`,
          greeting: `שלום ${contact.name},`,
          paragraphs: [
            `${officeName} שלח לכם ${kindLabel} לחתימה דיגיטלית.`,
            "החתימה נעשית ישירות בדפדפן, ללא צורך בהדפסה או בסריקה.",
          ],
          button: { label: "לצפייה ולחתימה", url },
          footnote: "הקישור אישי ותקף 30 יום. אם לא ציפיתם להודעה זו — אפשר להתעלם ממנה.",
        },
        /*
         * מה שנרשם מיד אחרי זה הוא **טענת עובדה**: הודעה יוצאת
         * בכרטיס איש הקשר ו-`sentAt` על ההסכם. הבדיקה למעלה אינה
         * ערובה — ההגדרות יכולות להשתנות בין שתי הקריאות — ובלי
         * `required` המתווך היה רואה „נשלח לחתימה” על מסמך שאיש לא
         * קיבל (ביקורת Codex).
         *
         * `tenantId` — ההסכם הוא מסמך של **המשרד** אל הלקוח שלו,
         * ומשרד שחיבר דומיין שולח אותו מהכתובת שלו. בלי חיבור —
         * מכתובת הפלטפורמה, כמו עד היום.
         */
        {
          /*
           * ‎`null` — **„שלחו שוב” הוא בקשה, לא ניסיון חוזר.** סוכן
           * ‏שלוחץ שוב עושה זאת כי הלקוח אמר שלא קיבל, וזה בדיוק
           * ‏הרגע שבו בליעת השליחה היא התקלה. הכישלון העמום מסומן
           * ‏עכשיו כ-`EmailAmbiguousError`, והמסך אומר „ייתכן שיצא”.
           */
          idempotency: null,
          required: true,
          tenantId,
          ...(replyTo === null ? {} : { replyTo }),
        },
      );
      await this.messaging.recordOutbound(tx, {
        contactId: contact.id,
        channel: "email",
        provider: "system",
        body: message,
      });
    } else {
      await this.messaging.recordOutbound(tx, {
        contactId: contact.id,
        channel: "whatsapp",
        provider: "walink",
        body: message,
      });
    }

    /*
     * הסטטוס חוזר ל-pending אחרי שליחה חוזרת? לא.
     *
     * `viewed` מתעד שהלקוח פתח, וזה מידע שאסור למחוק בשליחה נוספת —
     * המתווך צריך לדעת שהלקוח ראה ולא חתם.
     */
    await tx.agreement.update({ where: { id: row.id }, data: { sentAt: new Date() } });
    await this.audit.record(tx, {
      action: "agreement.deliver",
      entityType: "agreement",
      entityId: row.id,
      metadata: { channel },
    });

    return channel === "email"
      ? { sentTo: contact.email, message }
      : { waUrl: whatsappLink(contact.phone, message), message };
  }

  /**
   * הערכים שמגיעים **מהמשרד** — מה שידוע עוד לפני שיודעים מי הלקוח.
   *
   * ‏הופרד מ-`collectValues` כשנוסף הקישור הפתוח: שם אין לקוח ואין
   * ‏נכס, ורק החלק הזה של המפה ניתן למילוי בזמן היצירה. עותק שני של
   * ‏„מאיפה מגיע שם המשרד ומה הן ברירות המחדל לדמי התיווך” היה
   * ‏נפרד מהראשון בשקט ברגע שמישהו מוסיף שדה משרד אחד.
   */
  private async officeValues(): Promise<Partial<AgreementValues>> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const asText = (key: string): string =>
      typeof settings[key] === "string" ? (settings[key] as string) : "";
    return {
      שם_המשרד: tenant?.name ?? "",
      מספר_רישיון_תיווך: asText("licenseNumber"),
      כתובת_המשרד: asText("officeAddress"),
      טלפון_המשרד: asText("officePhone"),
      /*
       * ברירות המחדל של המשרד לדמי התיווך ומועד התשלום.
       *
       * שניהם פרטי חובה בתקנות, ושער ההצעות יוצר הסכם בלי שאיש הזין
       * אותם — כלומר בלעדיהם השער לא היה יכול לייצר מסמך תקף בכלל.
       * ערך מפורש בטופס השליחה גובר עליהם (הפריסה של input.values
       * ב-`collectValues`).
       */
      דמי_תיווך: asText("defaultCommission"),
      מועד_תשלום: asText("defaultPaymentTerms"),
      תאריך: formatJerusalemDate(new Date()),
    };
  }

  /** איסוף הערכים שממלאים את הנוסח — משרד, לקוח ונכס. */
  private async collectValues(
    tx: TenantTx,
    contact: { name: string; phone: string },
    input: { propertyId?: string; values?: Partial<AgreementValues> },
  ): Promise<Partial<AgreementValues>> {
    const tenantId = TenantContext.current().tenantId;
    const office = await this.officeValues();

    let propertyText = "";
    let priceText = "";
    let dealText = "";
    if (input.propertyId !== undefined) {
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, tenantId, deletedAt: null },
        select: {
          street: true,
          neighborhood: true,
          city: true,
          rooms: true,
          priceAgorot: true,
          dealType: true,
        },
      });
      /*
       * נכס שאינו קיים או שנמחק — **דחייה**, לא שדות ריקים.
       *
       * הסתמכות על כך שהשדות יישארו ריקים אינה אכיפה: `input.values`
       * נפרש מעל אותם שדות, ולכן קורא יכול לספק את סוג העסקה, תיאור
       * הנכס והמחיר בעצמו, לעבור את בדיקת החוסרים, ולקבל הסכם בר-חתימה
       * שה-propertyId השמור בו מצביע על נכס מחוק (ביקורת Codex).
       */
      if (!property) {
        throw new NotFoundException("הנכס לא נמצא או שנמחק — לא ניתן להפיק עליו הסכם");
      }
      {
        // סוג העסקה הוא פרט חובה בתקנות, והוא יושב על הנכס — אין סיבה
        // לבקש מהמתווך להקליד אותו שוב
        dealText = agreementDealLabel(property.dealType);
        propertyText = [
          property.rooms !== null ? `דירת ${property.rooms} חדרים` : null,
          [property.street, property.neighborhood, property.city].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(", ");
        if (property.priceAgorot !== null) {
          // priceAgorot הוא bigint בסכמה — המרה מפורשת לפני חישוב
          priceText = `${formatIsraeliNumber(Math.round(Number(property.priceAgorot) / 100))} ₪`;
        }
      }
    }

    return {
      ...office,
      שם_הלקוח: contact.name,
      טלפון_הלקוח: contact.phone,
      סוג_העסקה: dealText,
      תיאור_הנכס: propertyText,
      מחיר_משוער: priceText,
      ...input.values,
      /*
       * ‎**כשיש נכס, הנכס הוא המקור — גם אחרי פריסת הערכים מהבקשה.**
       *
       * ‏הפריסה של `input.values` נועדה לדמי התיווך ולמועד התשלום,
       * ‏שהמתווך משלים ידנית. אבל היא פרושה מעל **כל** המפתחות,
       * ‏ולכן קורא יכול היה לשלוח `תיאור_הנכס` משלו ולדרוס את מה
       * ‏שנקרא מהשורה — מסמך שנושא `propertyId` של נכס אחד ומתאר
       * ‏נכס אחר.
       *
       * ‏זה נעשה נגיש עכשיו: הזמנה בכתב בלי נכס מקבלת שדות טקסט
       * ‏לשלושת הפרטים האלה, ולכן הם נוסעים בבקשה. הם רלוונטיים
       * ‏**רק** כשאין נכס, וכאן זה נאכף — ולא בכך שהמסך לא ישלח
       * ‏אותם.
       */
      ...(input.propertyId === undefined
        ? {}
        : { סוג_העסקה: dealText, תיאור_הנכס: propertyText, מחיר_משוער: priceText }),
      /*
       * שדות שהחותם ממלא נשארים בשליטת השרת — **אחרי** פריסת הערכים
       * מהבקשה ולא לפניה.
       *
       * POST /agreements מקבל רשימת ערכים חופשית, ולכן קורא יכול היה
       * לשלוח תעודת זהות משלו ולדרוס את הסימון. אז fillSignerId לא
       * מוצא אותו בחתימה, המסמך הקפוא נשאר עם הזהות ששלח הקורא בזמן
       * ש-signerIdNumber מתעד זהות אחרת — והגיבוב מאמת בדיוק את
       * חוסר ההתאמה הזה (ביקורת Codex).
       */
      תעודת_זהות_הלקוח: SIGNER_BLANK,
    };
  }

  /** תצוגת ההסכם ללקוח החותם — בלי הקשר דייר. */
  async publicView(token: string): Promise<PublicAgreementView> {
    return this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      if (row.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג — בקשו מהמתווך קישור חדש");

      if (row.status === "pending") {
        await tx.agreement.updateMany({
          where: { id: row.id, status: "pending" },
          data: { status: "viewed", viewedAt: new Date() },
        });
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: row.tenantId },
        select: { name: true },
      });

      return {
        kind: row.kind as AgreementKind,
        kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
        officeName: tenant?.name ?? "",
        /*
         * ‎**נתיב, ולא הקובץ.** הדף טוען אותו כתמונה רגילה, ולכן
         * ‎`null` פירושו „אין לוגו” — והמסך יודע להציג מונוגרמה
         * במקום, בלי בקשה שתחזור 404 בכל טעינה.
         */
        logoUrl: (await this.logo.has(row.tenantId))
          ? `/public/agreements/${token}/logo`
          : null,
        body: row.renderedBody,
        status: row.status,
        signedAt: row.signedAt ?? undefined,
        signerName: row.signerName ?? undefined,
        bodyHash: row.bodyHash,
        openLink: row.signerTemplate !== null,
      };
    });
  }

  /**
   * חתימה. הראיות נלכדות ברגע החתימה, והעדכון מותנה בסטטוס הנוכחי
   * כדי ששתי לחיצות מקבילות לא ייצרו שתי חתימות שונות.
   *
   * ‎**קישור פתוח נחתם באותו מסלול בדיוק**, ולא במסלול שני: אותה
   * ‏נעילה מותנית, אותו גיבוב, אותן ראיות. מה שמשתנה הוא מאין בא
   * ‏הנוסח הסופי — מהנוסח הקפוא ומהשדות שהחותם מילא, במקום מהנוסח
   * ‏שכבר היה שלם — ומה שנוסף אחריו: פתירת הכרטיס.
   */
  async sign(
    token: string,
    input: {
      signerName: string;
      signerIdNumber: string;
      /** קישור פתוח בלבד — שאר השדות שהחותם מילא. ראו `OpenSignerAnswers`. */
      open?: OpenSignerAnswers;
      signatureImage?: string;
      ip?: string;
      userAgent?: string;
    },
  ): Promise<{ signedAt: Date }> {
    /*
     * ‎**שני שלבים, ובכוונה.**
     *
     * ‏`withPublicAgreement` היא פוליסה צרה: היא חושפת את שורת
     * ‏ההסכם של הטוקן, ותו לא. פתירת הכרטיס בקישור פתוח נוגעת
     * ‏ב-`contacts` וב-`buyers`, ולכן היא **חייבת** לרוץ תחת הקשר
     * ‏דייר רגיל — אותה הפרדה בדיוק שטופס הקליטה הציבורי עושה
     * ‏(`IntakeService.materializeOpen`). החלופה, פוליסות כתיבה
     * ‏ציבוריות על טבלאות הלקוחות, הייתה פותחת נתיב כתיבה שתלוי
     * ‏בנכונות `USING` אחד.
     *
     * ‏השלב הראשון קורא בלבד; כל הכתיבה — החתימה, הכרטיס והקישור
     * ‏ביניהם — יושבת בטרנזקציה אחת בשלב השני.
     */
    const head = await this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({
        where: { publicToken: token },
        select: { id: true, tenantId: true, tokenExpires: true, status: true },
      });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      return row;
    });
    if (head.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג");
    if (head.status === "signed") throw new BadRequestException("ההסכם כבר נחתם");
    if (head.status === "declined") throw new BadRequestException("ההסכם נדחה");

    /*
     * ‎**הקשר הדייר נקבע במפורש, ולא נסמך על „אין אחד”** (ביקורת
     * ‏Codex, P2).
     *
     * ‏`withExplicitTenant` קובעת הקשר רק כשאין — והיא צודקת:
     * ‏קורא שכבר פועל בשם אדם מסוים צריך להישאר הוא. אבל הנתיב
     * ‏הזה ציבורי, והחותם עשוי להחזיק עוגיית התחברות **של משרד
     * ‏אחר** (מתווך שבודק את הקישור של עצמו, עמית שקיבל אותו).
     * ‏אז `SessionMiddleware` קובע את ההקשר ההוא, ו-RLS נקבע
     * ‏למשרד של ההסכם — שני דיירים שונים באותה טרנזקציה.
     *
     * ‏התוצאה אינה דליפה: הכתיבה תידחה ב-`WITH CHECK` והכול יתגלגל
     * ‏אחורה. אבל היא כן הרסנית — החתימה נופלת בלי סיבה נראית
     * ‏לעין. `officeContext` של **הדייר שבהסכם** הוא מה שנכון כאן,
     * ‏כי זה הדייר שבשמו נעשית העבודה.
     */
    const { signedAt, freshBuyerId } = await TenantContext.run(
      officeContext(head.tenantId),
      () => this.prisma.withExplicitTenant(
      head.tenantId,
      async (tx) => {
      /*
       * ‏נקרא **שוב** תחת הקשר הדייר, ולא מועבר מהשלב הראשון:
       * ‏בין שני השלבים אפשר שההסכם נחתם או נדחה, והבדיקות שלמעלה
       * ‏מתארות מצב שכבר אינו. הנעילה המותנית שבהמשך היא ההכרעה
       * ‏האמיתית, וזו הקריאה שהיא נשענת עליה.
       */
      const row = await tx.agreement.findFirst({ where: { id: head.id } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      if (row.status === "signed") throw new BadRequestException("ההסכם כבר נחתם");
      if (row.status === "declined") throw new BadRequestException("ההסכם נדחה");

      /*
       * ‎**קישור פתוח בלי השדות שהחותם ממלא — דחייה, לא מסמך חסר.**
       *
       * ‏הסכמה של הבקר אינה יכולה לדעת אם הטוקן הזה פתוח, ולכן
       * ‏השדות שם `optional`. כאן זה ידוע: בלעדיהם הנוסח היה נחתם
       * ‏עם `[חסר: …]` מודפס באמצע מסמך משפטי — בדיוק מה ש-`create`
       * ‏כבר חוסם בצד השני.
       *
       * ‏והכיוון ההפוך נחסם גם הוא: בהסכם רגיל הערכים כבר בנוסח
       * ‏מרגע השליחה, ו„פרטים” בבקשת החתימה היו טענה לדרוס אותם.
       */
      if (row.signerTemplate !== null && input.open === undefined) {
        throw new BadRequestException("יש למלא את פרטי הלקוח ואת הנכס לפני החתימה");
      }
      if (row.signerTemplate === null && input.open !== undefined) {
        throw new BadRequestException("ההסכם הזה הופק על לקוח ונכס מסוימים — פרטיו כבר בתוכו");
      }

      const signedAt = new Date();
      /*
       * מספר הזהות נכנס לגוף המסמך, לא רק לשדה נפרד.
       *
       * התקנות דורשות שההזמנה בכתב תכלול את מספרי הזיהוי של הצדדים.
       * מסמך שכתוב בו `ת"ז ____________`, בזמן שהמספר יושב בעמודה
       * אחרת בבסיס הנתונים, לא מקיים את הדרישה (ביקורת Codex).
       *
       * הגיבוב מחושב מחדש על הנוסח הסופי — הוא צריך להעיד על מה
       * שנחתם. הגיבוב שהוצג ללקוח לפני החתימה נשמר ב-presented_hash,
       * כך שאפשר להוכיח גם מה הוצג וגם מה נחתם.
       *
       * ‎**בקישור פתוח הנוסח הסופי נבנה ולא מתוקן.** אין בו שורה
       * ‏אחת למלא אלא שבע, ולכן הוא מורץ מהנוסח הקפוא עם הערכים של
       * ‏החותם. `signerTemplate` הוא **הקפאה משלו** ולא הפניה
       * ‏לתבנית המשרד, ולכן ההבטחה נשמרת: נוסח שהמשרד שינה בינתיים
       * ‏אינו נוגע בהסכם שכבר יצא.
       */
      const finalBody =
        row.signerTemplate === null
          ? fillSignerId(row.renderedBody, input.signerIdNumber)
          : renderAgreement(
              row.signerTemplate,
              openSignerValues(input.signerName, input.signerIdNumber, input.open),
            ).text;
      const updated = await tx.agreement.updateMany({
        where: { id: row.id, status: { in: ["pending", "viewed"] } },
        data: {
          status: "signed",
          signerName: input.signerName,
          signerIdNumber: input.signerIdNumber,
          renderedBody: finalBody,
          /*
           * ‎`presentedHash` נשאר מה שהוצג. בהסכם רגיל זה
           * ‏`row.bodyHash`; בקישור פתוח הוא כבר נכתב ביצירה ולא
           * ‏השתנה מאז — ושניהם אותו דבר, כי עד החתימה הגיבובים
           * ‏זהים.
           */
          presentedHash: row.bodyHash,
          bodyHash: AgreementsService.hashBody(finalBody),
          signedAt,
          signatureImage: input.signatureImage ?? null,
          signedIp: input.ip ?? null,
          signedUserAgent: input.userAgent?.slice(0, 300) ?? null,
        },
      });
      if (updated.count === 0) throw new BadRequestException("ההסכם כבר טופל");

      /*
       * ‎**והכרטיס.** זה מה שהופך קישור פתוח למשהו שנשאר במערכת
       * ‏ולא למסמך יתום: מרגע החתימה ההסכם יושב על כרטיס הלקוח,
       * ‏בדיוק כמו כל הסכם אחר.
       */
      const freshBuyerId =
        row.signerTemplate === null || input.open === undefined
          ? null
          : await this.attachSignerCard(tx, row, {
              name: input.signerName,
              phone: input.open.phone,
            });

      // בלעדיות שנחתמה — הצלחה של מי שהוציא את ההסכם (docs/14 §2)
      if (row.kind === "exclusivity" && row.createdBy !== null) {
        const property =
          row.propertyId === null
            ? null
            : await tx.property.findFirst({
                where: { id: row.propertyId, tenantId: row.tenantId },
                select: { marketingTitle: true, street: true, city: true },
              });
        await recordMentorWin(tx, {
          tenantId: row.tenantId,
          userId: row.createdBy,
          kind: "exclusivity_signed",
          entityType: row.propertyId === null ? "mentor" : "property",
          entityId: row.propertyId ?? row.id,
          title:
            property?.marketingTitle ??
            ([property?.street, property?.city].filter(Boolean).join(", ") || "הסכם בלעדיות"),
        });
      }

      return { signedAt, freshBuyerId };
      },
      ),
    );

    /*
     * ‎`afterCreate` **מחוץ** לטרנזקציה — התאמות, פרסום לרשת
     * ‏והתראות. אותו סדר בדיוק שהקישור הפתוח של טופס הקליטה עובד
     * ‏בו, ומאותו נימוק: עבודה ארוכה בתוך טרנזקציה מחזיקה נעילות
     * ‏על שורות הלקוח.
     *
     * ‏וכישלון שלה אינו מבטל את החתימה: המסמך חתום, הכרטיס קיים,
     * ‏ורק הריצות שאחריהם יחזרו בסבב הבא. חתימה שנופלת בגלל התאמה
     * ‏שלא רצה היא בדיוק ההפך מהנכון.
     */
    if (freshBuyerId !== null) {
      await TenantContext.run(officeContext(head.tenantId), () =>
        this.buyers.afterCreate(freshBuyerId),
      ).catch(() => undefined);
    }

    return { signedAt };
  }

  /**
   * ‎**הכרטיס של מי שחתם על קישור פתוח.**
   *
   * ## ‏„לפתוח כרטיס רק אם אין כזה” (בקשת המשתמש)
   *
   * ‎`findOrCreateByPhone` מחזירה את איש הקשר הקיים כשהמספר כבר
   * ‏במאגר — לקוח ותיק שחתם על הזמנה בכתב אינו מקבל כרטיס שני,
   * ‏וההסכם נוחת אצלו. `typedBy` הוא „office” כי המספר הגיע
   * ‏**מבעליו**: אין כאן סוכן מחובר שאפשר לבדוק מולו הרשאה, בדיוק
   * ‏כמו בטופס הקליטה הציבורי.
   *
   * ## ‏למה גם כרטיס קונה
   *
   * ‏ההסכמים מוצגים על כרטיס הלקוח. איש קשר בלי כרטיס הוא מסמך
   * ‏שנחתם ואיש במשרד אינו רואה — כלומר בדיוק הכישלון שהתכונה באה
   * ‏למנוע. כרטיס **קיים** גובר תמיד; אחד חדש נפתח רק כשאין.
   *
   * ‎`ownerUserId` הוא מי שהפיק את הקישור: את השליחה עשה הלקוח,
   * ‏ובלי בעלים מפורש הכרטיס נעלם מכל סוכן שרואה „רק שלי” — כלומר
   * ‏מהסוכן שביקש אותו.
   *
   * ‏מחזירה את מזהה הקונה **החדש** בלבד, כי רק הוא צריך
   * ‎`afterCreate`.
   */
  private async attachSignerCard(
    tx: TenantTx,
    row: { id: string; tenantId: string; createdBy: string | null },
    signer: { name: string; phone: string },
  ): Promise<string | null> {
    const contact = await this.contacts.findOrCreateByPhone(tx, {
      name: signer.name,
      phone: signer.phone,
    });

    /*
     * ‏נעילת **שורת** איש הקשר לפני הבדיקה „יש כבר קונה”.
     *
     * ‎`findOrCreateByPhone` נוטלת נעילה מייעצת על המספר, וזה מסדר
     * ‏אותה מול יוצרי כרטיסים אחרים — אבל לא מול
     * ‏`BuyersService.convertFromLead`, שנועלת את שורת איש הקשר
     * ‏ב-`SELECT … FOR UPDATE`. שני מנגנוני נעילה שונים אינם
     * ‏נפגשים, ואותו אדם היה מקבל שני כרטיסי קונה פעילים. זו אותה
     * ‏נעילה בדיוק שטופס הקליטה נוטל באותה נקודה.
     */
    await tx.$queryRaw`SELECT id FROM contacts WHERE id = ${contact.id} AND tenant_id = ${row.tenantId} FOR UPDATE`;
    const existing = await tx.buyer.findFirst({
      where: { tenantId: row.tenantId, contactId: contact.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    await tx.agreement.update({
      where: { id: row.id },
      data: { contactId: contact.id },
    });
    await this.audit.record(tx, {
      action: "agreement.open_signed",
      entityType: "agreement",
      entityId: row.id,
      metadata: { contactId: contact.id, reusedCard: existing !== null },
    });

    if (existing !== null) return null;
    return this.buyers.createWithin(tx, {
      typedBy: "office",
      contactName: signer.name,
      contactPhone: signer.phone,
      /*
       * ‏בלי דרישות: הזמנה בכתב אינה אומרת מה הלקוח מחפש, ולנחש
       * ‏עבורו היה מייצר התאמות על קריטריונים שאיש לא מסר.
       */
      requirements: BuyerRequirementsSchema.parse({}),
      source: "agreement_link",
      ...(row.createdBy === null ? {} : { ownerUserId: row.createdBy }),
    });
  }

  async decline(token: string): Promise<void> {
    await this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      await tx.agreement.updateMany({
        where: { id: row.id, status: { in: ["pending", "viewed"] } },
        data: { status: "declined", declinedAt: new Date() },
      });
    });
  }

  /**
   * המסמך החתום המלא — הנוסח, החתימה והראיות.
   *
   * זה מה שהיה חסר: הלקוח חתם, ובכרטיס שלו לא היה שום מסמך להראות.
   * העמוד שמציג את התשובה הזו בנוי להדפסה, ו"שמור כ-PDF" של הדפדפן
   * מייצר ממנו קובץ — בלי ספריית PDF בשרת ובלי גופנים עבריים
   * שצריך לארוז איתה.
   *
   * "מאומת" כאן הוא הגיבוב ולא חתימה קריפטוגרפית על הקובץ: המסמך
   * מציג את `bodyHash` ואת `presentedHash`, וכל אחד יכול לחשב
   * SHA-256 על הנוסח המודפס ולראות שהוא תואם.
   */
  async document(
    tx: TenantTx,
    id: string,
  ): Promise<{
    id: string;
    kindLabel: string;
    officeName: string;
    body: string;
    status: string;
    signerName?: string;
    signerIdNumber?: string;
    signatureImage?: string;
    signedAt?: Date;
    signedIp?: string;
    bodyHash: string;
    presentedHash?: string;
    createdAt: Date;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const row = await tx.agreement.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("ההסכם לא נמצא");
    /*
     * הסכם שנשמר אחרי מחיקת הלקוח — אין כרטיס לבדוק עליו בעלות,
     * ולכן הוא נפתח בהרשאת ניהול בלבד. זה גם הנתיב שחייב לעבוד:
     * מסמך משפטי שנשמר ואי אפשר לפתוח אותו הוא מסמך שאבד.
     */
    const gate = await contactGateFor(tx, tenantId, row.contactId);
    /*
     * ‎**ובארכיון יש רק מה שנשמר.** מחיקת לקוח מנתקת הסכם **חתום**
     * ומוחקת את השאר — טיוטה, קישור שנשלח ולא נחתם, קישור שפג.
     * שורה מנותקת היא לכן חתומה בהגדרה, אבל לכרטיס **יתום** הניקוי
     * מעולם לא רץ: בלי הבדיקה הזו מזהה ידוע פתח מסמך שלא נחתם לכל
     * בעל `settings.manage` (ביקורת Codex).
     *
     * הרשימה כבר מסננת `status = 'signed'`; זה השער שמסכים איתה.
     */
    if (gate.mode === "archive" && row.status !== "signed") {
      throw new NotFoundException("ההסכם אינו בארכיון המשרד");
    }
    if (gate.mode === "contact") {
      /*
       * ‏המסמך נושא את שם החותם, מספר הזהות, החתימה ו-IP. כשהוא
       * ‏מוצמד לנכס, הנכס הוא חלק מהשאלה מי רשאי לפתוח אותו.
       */
      await assertPropertyRecordScope(
        tx,
        tenantId,
        {
          requiresProperty: agreementRequiresProperty(row.kind),
          contactId: gate.contactId,
          propertyId: row.propertyId,
        },
        "מסמך הסכם על נכס",
      );
    } else if (!TenantContext.current().capabilities.has("settings.manage")) {
      throw new ForbiddenException("ההסכם שמור בארכיון המשרד — נדרשת הרשאת ניהול");
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });

    return {
      id: row.id,
      kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
      officeName: tenant?.name ?? "",
      body: row.renderedBody,
      status: row.status,
      signerName: row.signerName ?? undefined,
      signerIdNumber: row.signerIdNumber ?? undefined,
      signatureImage: row.signatureImage ?? undefined,
      signedAt: row.signedAt ?? undefined,
      signedIp: row.signedIp ?? undefined,
      bodyHash: row.bodyHash,
      presentedHash: row.presentedHash ?? undefined,
      createdAt: row.createdAt,
    };
  }

  /**
   * ההסכמים החתומים ששרדו מחיקת לקוח.
   *
   * בלי הרשימה הזו הם היו בלתי נגישים: כל שאר המסלולים אל הסכם
   * עוברים דרך כרטיס הלקוח, ולכרטיס הזה כבר אין קיום. מסמך שנשמר
   * מטעמים משפטיים ואי אפשר להגיע אליו הוא מסמך שנאבד — רק בלי
   * שאיש יודע.
   *
   * שם החותם מגיע מהמסמך עצמו ולא מכרטיס: זה השם שנחתם, וזה גם
   * היחיד שנשאר.
   */
  async listRetained(tx: TenantTx): Promise<
    {
      id: string;
      kind: AgreementKind;
      kindLabel: string;
      signerName: string | null;
      signedAt: Date | null;
      url: string;
    }[]
  > {
    const tenantId = TenantContext.current().tenantId;
    /*
     * ‎**„נותק” אינו התנאי — „איש אינו יכול להגיע אליו” הוא.**
     *
     * הארכיון סינן `contactId: null` בלבד, כלומר את מה שמחיקת לקוח
     * ניתקה במפורש. אבל כרטיס יכול להפוך לבלתי-נגיש בלי שאיש ניתק
     * אותו: `assertContactAccess` דורשת קונה חי, ליד או נכס חי,
     * ומחיקת נכס לצמיתות מסירה את השלישי — אצל בעלים-בלבד זה
     * היחיד. מאותו רגע ההסכם החתום שלו אינו נגיש מכרטיס הלקוח
     * (הכרטיס מחזיר 404) ואינו נכנס לכאן, כלומר **ראיה משפטית
     * שאיש אינו יכול להגיע אליה, למחוק אותה, או לדעת שהיא שם**.
     *
     * ‎`NOT EXISTS` **באותה שאילתה עם ה-LIMIT** ולא סינון אחריה:
     * סינון אחרי השליפה מחזיר עמוד חסר. `orphanContactCondition`
     * הוא אותו כלל של `isOrphanContact`, בניסוח אחד לכל הקוראים.
     */
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM agreements a
       WHERE a.tenant_id = ${tenantId}
         AND a.status = 'signed'
         AND (a.contact_id IS NULL OR ${orphanContactCondition("a")})
       ORDER BY a.signed_at DESC NULLS LAST
       LIMIT 500`;
    const rows = await tx.agreement.findMany({
      where: { tenantId, id: { in: ids.map((row) => row.id) } },
      orderBy: { signedAt: "desc" },
      select: { id: true, kind: true, signerName: true, signedAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AgreementKind,
      kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind] ?? row.kind,
      signerName: row.signerName,
      signedAt: row.signedAt,
      url: `/agreements/${row.id}/document`,
    }));
  }

  /**
   * ‎**כל מי שנשלח אליו הסכם ולא חתם — בכל המשרד.**
   *
   * עד כה אפשר היה לשאול על **לקוח אחד** (`listForContact`), כלומר
   * לדעת רק אם כבר ידעת את מי לבדוק. השאלה שהמתווך שואל בפועל הפוכה,
   * והיא גם זו ששוות כסף: `hasSigned` חוסמת הצעות למי שלא חתם, ולכן
   * כל שורה כאן היא לקוח שהמערכת **מסננת בשקט** מכל שליחה אוטומטית.
   *
   * ‎**ההיקף הוא היקף הלקוחות, לא היקף ההסכמים.** ל-`agreements` אין
   * עמודת בעלים — הבעלות נגזרת מהלקוח, בדיוק כמו ב-`assertContactAccess`.
   * ‎`visibleContactIds` הוא אותו כלל עצמו בצורתו הקבוצתית, ולכן סוכן
   * עם `view_own` אינו רואה כאן את הלקוחות של עמיתו. שאילתה על
   * ‎`tenantId` בלבד הייתה חושפת שם של לקוח זר בשורה הראשונה.
   *
   * ‎`null` מ-`visibleContactIds` = רואה את כל המשרד; אז אין מה לסנן,
   * וזה **אינו** אותו דבר כמו רשימה ריקה. רשימה ריקה היא „אין לך אף
   * לקוח”, ותנאי `in: []` היה מחזיר כלום למי שרואה הכול.
   */
  async listPending(tx: TenantTx, now: Date): Promise<PendingAgreementRow[]> {
    const tenantId = TenantContext.current().tenantId;
    const visible = await visibleContactIds(tx, tenantId);
    if (visible !== null && visible.length === 0) return [];

    /*
     * ‎**היקף הנכס בשאילתה, לפני התקרה** (ביקורת Codex, P2).
     *
     * ‏הסינון היה כאן למטה, אחרי `take: 200`, ולכן הוא סינן את
     * ‏המאתיים ולא את המאגר: מאתיים הסכמים חדשים על נכסים של עמיתים
     * ‏מילאו את החלון, נמחקו, והתור חזר ריק בזמן שהסכמים ישנים יותר
     * ‏**שלי** המתינו מחוצה לו. אותו כלל בדיוק —
     * ‏`actionablePropertyWhere` הוא התאום של `actionablePropertyIds`,
     * ‏והשניים נבדקים זה מול זה.
     */
    const propertyScope = await actionablePropertyWhere(
      tx,
      tenantId,
      AGREEMENT_KINDS_ON_PROPERTY,
    );

    const rows = await tx.agreement.findMany({
      where: {
        tenantId,
        // הסכם מנותק (הלקוח נמחק) הוא ארכיון חתום, לא ממתין
        contactId: visible === null ? { not: null } : { in: visible },
        status: { in: ["pending", "viewed", "declined"] },
        ...propertyScope,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        contactId: true,
        propertyId: true,
        status: true,
        sentAt: true,
        createdAt: true,
        tokenExpires: true,
        publicToken: true,
      },
      take: 200,
    });
    if (rows.length === 0) return [];

    /*
     * ‏הסינון עצמו כבר רץ בשאילתה למעלה. התור נושא `publicToken`
     * ‏לכל שורה, ולכן הסכם על נכס של עמית היה מגיע לתור שלי עם
     * ‏קישור החתימה שלו (ביקורת Codex, P1).
     */
    const scoped = rows;
    if (scoped.length === 0) return [];

    // שאילתה אחת לכל השמות, לא אחת לשורה
    const contacts = await this.contacts.getByIds(
      tx,
      scoped.map((row) => row.contactId!),
    );

    const out: PendingAgreementRow[] = [];
    for (const row of scoped) {
      const contactId = row.contactId!;
      const name = contacts.get(contactId)?.name;
      /*
       * לקוח שהשם שלו אינו נפענח אינו מוצג כ„לקוח ללא שם”. שורה בלי
       * זהות אינה ניתנת לפעולה, והיא מזמינה שליחה חוזרת אל מי שאיש
       * אינו יודע מיהו.
       */
      if (name === undefined) continue;

      // סדר הקדימה בין המצבים חי ב-shared ונבדק שם
      const state: PendingAgreementState = pendingAgreementState(
        row.status,
        row.tokenExpires,
        now,
      );

      const since = row.sentAt;
      out.push({
        id: row.id,
        kind: row.kind as AgreementKind,
        kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind] ?? row.kind,
        contactId,
        contactName: name,
        propertyId: row.propertyId,
        state,
        /*
         * נמדד בין **תחילות ימים ישראליות** ולא בין רגעים: אחרת
         * „ממתין 3 ימים” היה 2 בבוקר ו-3 בערב על אותו נתון.
         */
        daysWaiting:
          since === null
            ? null
            : Math.max(
                0,
                Math.round(
                  (jerusalemDayStart(now).getTime() - jerusalemDayStart(since).getTime()) /
                    (24 * 60 * 60 * 1000),
                ),
              ),
        url: state === "expired" ? null : this.publicUrl(row.publicToken),
      });
    }

    /*
     * ‎**דירוג לפי מה שדורש פעולה, לא לפי תאריך.** „נפתח ולא נחתם”
     * ראשון כי הוא הלקוח החם ביותר ברשימה; „פג” אחריו כי הוא הכשל
     * השקט; „סירב” אחרון כי אינו ממתין לדבר. בתוך מצב — הוותיק קודם.
     */
    return out.sort(
      (a, b) =>
        pendingAgreementRank(a.state) - pendingAgreementRank(b.state) ||
        (b.daysWaiting ?? -1) - (a.daysWaiting ?? -1),
    );
  }

  /**
   * ‎**הרשימה מסננת את מה שהשער חוסם — אחרת היא עוקפת אותו.**
   *
   * ‏כל שורה כאן נושאת `url` נושא־טוקן: מי שרואה אותה יכול לחתום
   * ‏בשם הלקוח. הסכם שמוצמד לנכס של עמית נחסם ב-`deliver`
   * ‏וב-`document`, ולכן הצגתו כאן הייתה מוסרת בדיוק את מה שהם
   * ‏מגנים עליו (ביקורת Codex, P1).
   */
  async listForContact(tx: TenantTx, contactId: string): Promise<AgreementSummary[]> {
    const tenantId = TenantContext.current().tenantId;
    const all = await tx.agreement.findMany({
      where: { tenantId, contactId },
      orderBy: { createdAt: "desc" },
    });
    /* ‏שאילתה אחת לכל הנכסים שברשימה, ולא אחת לשורה */
    const allowed = await actionablePropertyIds(
      tx,
      tenantId,
      all.map((row) => row.propertyId).filter((id): id is string => id !== null),
    );
    /*
     * ‎**ושורה שחייבת נכס ואין לה אינה „ברמת המשרד”** (ביקורת Codex, P1).
     *
     * ‏הסינון כאן ויתר על כל `propertyId === null`, ולכן בלעדיות
     * ‏ישנה שנוצרה לפני שהיצירה דרשה נכס חזרה ברשימה — עם קישור
     * ‏החתימה נושא־הטוקן בתוכה, בדיוק מה ש-`deliver` ו-`document`
     * ‏כבר חוסמים. `propertyRecordInScope` הוא הביטוי הקבוצתי של
     * ‏`assertPropertyRecordScope`, ושניהם שואלים את
     * ‏`agreementRequiresProperty` — כלל אחד, שתי צורות.
     */
    const rows = all.filter((row) =>
      propertyRecordInScope(
        { propertyId: row.propertyId, requiresProperty: agreementRequiresProperty(row.kind) },
        allowed,
      ),
    );
    // שאילתה אחת לכל הרשימה ולא אחת לשורה — כולן על אותו איש קשר
    const contact = rows.length > 0 ? await this.contacts.getById(tx, contactId) : null;
    const canEmail = Boolean(contact?.email);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AgreementKind,
      kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
      status: row.status,
      contactId: row.contactId,
      propertyId: row.propertyId ?? undefined,
      signedAt: row.signedAt ?? undefined,
      sentAt: row.sentAt ?? undefined,
      url: this.publicUrl(row.publicToken),
      createdAt: row.createdAt,
      canEmail,
    }));
  }
}
