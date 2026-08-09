import { BadRequestException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  AGREEMENT_KIND_LABELS,
  REQUIRED_PLACEHOLDERS,
  SIGNER_BLANK,
  SIGNER_PROVIDED_PLACEHOLDERS,
  defaultAgreementTemplate,
  fillSignerId,
  renderAgreement,
  type AgreementKind,
  type AgreementValues,
} from "@metavchim/shared";
import { assertContactAccess } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

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
  contactId: string;
  propertyId?: string;
  signedAt?: Date;
  url: string;
  createdAt: Date;
}

export interface PublicAgreementView {
  kind: AgreementKind;
  kindLabel: string;
  officeName: string;
  body: string;
  status: string;
  signedAt?: Date;
  signerName?: string;
  bodyHash: string;
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
  ) {}

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
    const signed = await tx.agreement.findFirst({
      where: {
        tenantId,
        contactId,
        kind,
        // ההזמנה בכתב נוקבת בנכס מסוים, ולכן חתימה עליו אינה מכסה
        // נכס אחר. בלי הסינון הזה חתימה אחת הייתה פותחת את השער לכל
        // הנכסים שיוצעו ללקוח מכאן והלאה (ביקורת Codex).
        propertyId: propertyId ?? null,
        status: "signed",
      },
      select: { id: true },
    });
    return signed !== null;
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
    await assertContactAccess(tx, tenantId, input.contactId);

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
      throw new BadRequestException(
        `אי אפשר לשלוח הסכם לחתימה בלי פרטי החובה: ${blocking
          .map((name) => name.replace(/_/gu, " "))
          .join(", ")}. השלימו אותם בהגדרות המשרד או בטופס השליחה.`,
      );
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

  /** איסוף הערכים שממלאים את הנוסח — משרד, לקוח ונכס. */
  private async collectValues(
    tx: TenantTx,
    contact: { name: string; phone: string },
    input: { propertyId?: string; values?: Partial<AgreementValues> },
  ): Promise<Partial<AgreementValues>> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const asText = (key: string): string =>
      typeof settings[key] === "string" ? (settings[key] as string) : "";

    let propertyText = "";
    let priceText = "";
    let dealText = "";
    if (input.propertyId !== undefined) {
      const property = await tx.property.findFirst({
        // נכס מחוק אינו נכס שמחתימים עליו הזמנה בכתב. השדות יישארו
        // ריקים והזרימה תדווח עליהם כ-unfilled, וזה נכון: עדיף הסכם
        // שלא ניתן לשלוח מהסכם שמפנה לנכס שאינו קיים.
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
      if (property) {
        // סוג העסקה הוא פרט חובה בתקנות, והוא יושב על הנכס — אין סיבה
        // לבקש מהמתווך להקליד אותו שוב
        dealText = property.dealType === "rent" ? "שכירות" : property.dealType === "sale" ? "מכר" : "";
        propertyText = [
          property.rooms !== null ? `דירת ${property.rooms} חדרים` : null,
          [property.street, property.neighborhood, property.city].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(", ");
        if (property.priceAgorot !== null) {
          // priceAgorot הוא bigint בסכמה — המרה מפורשת לפני חישוב
          priceText = `${Math.round(Number(property.priceAgorot) / 100).toLocaleString("he-IL")} ₪`;
        }
      }
    }

    return {
      שם_המשרד: tenant?.name ?? "",
      מספר_רישיון_תיווך: asText("licenseNumber"),
      כתובת_המשרד: asText("officeAddress"),
      טלפון_המשרד: asText("officePhone"),
      שם_הלקוח: contact.name,
      טלפון_הלקוח: contact.phone,
      סוג_העסקה: dealText,
      תיאור_הנכס: propertyText,
      מחיר_משוער: priceText,
      /*
       * ברירות המחדל של המשרד לדמי התיווך ומועד התשלום.
       *
       * שניהם פרטי חובה בתקנות, ושער ההצעות יוצר הסכם בלי שאיש הזין
       * אותם — כלומר בלעדיהם השער לא היה יכול לייצר מסמך תקף בכלל.
       * ערך מפורש בטופס השליחה גובר עליהם (הפריסה של input.values
       * למטה).
       */
      דמי_תיווך: asText("defaultCommission"),
      מועד_תשלום: asText("defaultPaymentTerms"),
      תאריך: new Date().toLocaleDateString("he-IL"),
      ...input.values,
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
        body: row.renderedBody,
        status: row.status,
        signedAt: row.signedAt ?? undefined,
        signerName: row.signerName ?? undefined,
        bodyHash: row.bodyHash,
      };
    });
  }

  /**
   * חתימה. הראיות נלכדות ברגע החתימה, והעדכון מותנה בסטטוס הנוכחי
   * כדי ששתי לחיצות מקבילות לא ייצרו שתי חתימות שונות.
   */
  async sign(
    token: string,
    input: { signerName: string; signerIdNumber: string; ip?: string; userAgent?: string },
  ): Promise<{ signedAt: Date }> {
    return this.prisma.withPublicAgreement(token, async (tx) => {
      const row = await tx.agreement.findFirst({ where: { publicToken: token } });
      if (!row) throw new NotFoundException("ההסכם לא נמצא");
      if (row.tokenExpires < new Date()) throw new GoneException("תוקף הקישור פג");
      if (row.status === "signed") throw new BadRequestException("ההסכם כבר נחתם");
      if (row.status === "declined") throw new BadRequestException("ההסכם נדחה");

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
       */
      const finalBody = fillSignerId(row.renderedBody, input.signerIdNumber);
      const updated = await tx.agreement.updateMany({
        where: { id: row.id, status: { in: ["pending", "viewed"] } },
        data: {
          status: "signed",
          signerName: input.signerName,
          signerIdNumber: input.signerIdNumber,
          renderedBody: finalBody,
          presentedHash: row.bodyHash,
          bodyHash: AgreementsService.hashBody(finalBody),
          signedAt,
          signedIp: input.ip ?? null,
          signedUserAgent: input.userAgent?.slice(0, 300) ?? null,
        },
      });
      if (updated.count === 0) throw new BadRequestException("ההסכם כבר טופל");

      return { signedAt };
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

  async listForContact(tx: TenantTx, contactId: string): Promise<AgreementSummary[]> {
    const rows = await tx.agreement.findMany({
      where: { tenantId: TenantContext.current().tenantId, contactId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as AgreementKind,
      kindLabel: AGREEMENT_KIND_LABELS[row.kind as AgreementKind],
      status: row.status,
      contactId: row.contactId,
      propertyId: row.propertyId ?? undefined,
      signedAt: row.signedAt ?? undefined,
      url: this.publicUrl(row.publicToken),
      createdAt: row.createdAt,
    }));
  }
}
