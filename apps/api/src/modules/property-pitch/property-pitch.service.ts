import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  buildPropertyPitchEmail,
  pitchRecipientState,
  type PitchProperty,
  type PitchRecipientState,
} from "@metavchim/shared";
import { actingUserId, TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailService, emailSendOutcome } from "../../core/email.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { LandingService } from "../properties/landing.service";

/**
 * ‎**„שליחת הצעת נכס” — סוכן בוחר נכס, בוחר למי, ושולח.**
 *
 * ## ‏מנוע אחד, שני כיוונים
 *
 * ‏מכרטיס הנכס בוחרים קונים; מכרטיס הקונה בוחרים נכסים. זו אותה
 * ‏פעולה — **(נכסים × קונים) ⇐ מייל** — ולכן שירות אחד ולא שניים.
 * ‏שני מימושים היו נפרדים ביום שאחד מהם מתוקן, וזה בדיוק סוג
 * ‏הכפילות שהמסך השני היה יורש בשקט.
 *
 * ## ‏למה זו אינה `Offer`
 *
 * ‏`Offer` נשענת על `Match` (`matchId` ייחודי), כלומר על קביעה של
 * ‏מנוע ההתאמות. כאן **הסוכן** מחליט, גם על צירוף שהמנוע לא הציע,
 * ‏ויצירת התאמות מלאכותיות הייתה מזייפת את מה שהמנוע מצא ומשבשת
 * ‏את המונים והרשימות שנשענים עליו.
 *
 * ## ‏שלושה כללים שהשליחה אינה עוקפת
 *
 * ‎1. **בעלות.** רשימת הקונים מסוננת כמו רשימת הקונים עצמה — סוכן
 *    ‏אינו רואה ואינו שולח לקונים של עמית.
 * ‎2. **הסרה מדיוור.** מי שהסיר את עצמו אינו מקבל, והמייל נושא
 *    ‏קישור הסרה (§30א).
 * ‎3. **אין מייל — אין שליחה**, וזה נאמר במסך **לפני** הבחירה ולא
 *    ‏מתגלה אחריה.
 */

/** ‏קונה ברשימת הבחירה — עם הסיבה שבגללה אולי לא יקבל. */
export interface PitchBuyerRow {
  buyerId: string;
  contactId: string;
  name: string;
  hasEmail: boolean;
  optedOut: boolean;
  state: PitchRecipientState;
}

/** ‏תוצאת השליחה — מה יצא, ומה לא ולמה. */
export interface PitchResult {
  sent: number;
  skippedNoEmail: number;
  skippedOptedOut: number;
  failed: number;
  /**
   * ‎**„איננו יודעים” אינו „לא”** (ביקורת Codex, P1).
   *
   * ‏פסק זמן או ‎5xx מהספק פירושם שייתכן שההודעה **כן** יצאה. סיווגה
   * ‏כ„נכשלה” מזמין שליחה חוזרת — ומזהה חדש ומפתח אידמפוטנטיות חדש
   * ‏פירושם שהלקוח יקבל אותה פעמיים. ההבחנה הזו כבר קיימת בתיבת
   * ‏הדואר ובשירות המייל עצמו; כאן היא הייתה חסרה.
   */
  unknown: number;
}

@Injectable()
export class PropertyPitchService {
  private readonly logger = new Logger(PropertyPitchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly email: EmailService,
    private readonly emailInbox: EmailInboxService,
    private readonly landing: LandingService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ‏הקונים שאפשר לבחור מהם — **מסוננים בבעלות**, עם חיפוש.
   *
   * ‏החיפוש הוא על השם בלבד, והוא נעשה אחרי הפענוח: השם מוצפן
   * ‏במסד, ולכן `contains` בשאילתה לא היה מוצא דבר.
   */
  async buyers(query: { q?: string; limit: number }): Promise<PitchBuyerRow[]> {
    const ctx = TenantContext.current();
    const tenantId = ctx.tenantId;
    /*
     * ‎**היכולת נבדקת כאן ולא רק בשער הנתיב.** השער דורש
     * ‎`offers.send` — יכולת השליחה — ובזה נגמר תפקידו. „מי מותר
     * ‏לי לראות” היא שאלה על **הקונים**, ולכן נשאלת במקום שקורא
     * ‏אותם; אחרת תפקיד עם שליחה ובלי צפייה בקונים היה מקבל את
     * ‏המאגר דרך הדלת הזו.
     */
    if (!ctx.capabilities.has("buyers.view_own") && !ctx.capabilities.has("buyers.view_all")) {
      throw new ForbiddenException("אין הרשאה לצפות בקונים");
    }
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.buyer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        orderBy: { createdAt: "desc" },
        /*
         * ‏תקרה נדיבה ואז סינון בזיכרון: החיפוש הוא על שם מפוענח,
         * ‏ולכן אי אפשר לצמצם אותו בשאילתה. התקרה מונעת שליפה של
         * ‏מאגר שלם למשרד גדול.
         */
        take: 2000,
        select: { id: true, contactId: true },
      });
      const contacts = await this.contacts.getByIds(
        tx,
        rows.map((row) => row.contactId),
      );
      const consent = await tx.contact.findMany({
        where: { tenantId, id: { in: rows.map((row) => row.contactId) } },
        select: { id: true, optedOutAt: true, emailHash: true },
      });
      const byId = new Map(consent.map((row) => [row.id, row]));
      const term = (query.q ?? "").trim();
      const out: PitchBuyerRow[] = [];
      for (const row of rows) {
        const contact = contacts.get(row.contactId);
        const flags = byId.get(row.contactId);
        if (contact === undefined || flags === undefined) continue;
        if (term !== "" && !contact.name.includes(term)) continue;
        /*
         * ‎`emailHash` ולא הכתובת עצמה: „יש מייל” היא כל השאלה כאן,
         * ‏והכתובת אינה נחוצה למסך הבחירה. פענוח כתובת של כל
         * ‏המאגר כדי לענות על שאלת כן/לא הוא חשיפה מיותרת.
         */
        const hasEmail = flags.emailHash !== null;
        const optedOut = flags.optedOutAt !== null;
        out.push({
          buyerId: row.id,
          contactId: row.contactId,
          name: contact.name,
          hasEmail,
          optedOut,
          state: pitchRecipientState({ hasEmail, optedOut }),
        });
        if (out.length >= query.limit) break;
      }
      return out;
    });
  }

  /**
   * ‎**טוקן ההסרה של הכרטיס — נוצר פעם אחת ונשאר.**
   *
   * ‏קישור הסרה שנשלח אתמול חייב להמשיך לעבוד, ולכן הטוקן אינו
   * ‏מתחדש בכל שליחה. הייחודיות על ‎(tenant, contact) היא מה
   * ‏שהופך את „צור אם אין” לאטומי: שתי שליחות במקביל לאותו
   * ‏כרטיס — אחת תיצור, השנייה תיתקל בהתנגשות ותקרא את הקיים.
   */
  private async optOutToken(tx: TenantTx, tenantId: string, contactId: string): Promise<string> {
    /*
     * ‎**`upsert` ולא „נסה ליצור, ואם נפל קרא”** (ביקורת Codex, P2).
     *
     * ‏הניסוח הקודם היה שגוי מול Postgres: הפרת ייחודיות **מבטלת
     * ‏את הטרנזקציה כולה**, ולכן ה-`findFirst` שאחריה לא היה
     * ‏משחזר דבר אלא נופל ב„transaction is aborted” — כלומר שליחה
     * ‏תקינה לגמרי הייתה נספרת ככישלון. „אטומי” לא היה מה שכתבתי;
     * ‏זה מה שכתוב כאן עכשיו.
     *
     * ‎`update: {}` הוא בכוונה ריק: בהתנגשות אין מה לעדכן — הטוקן
     * ‏הקיים הוא התשובה, וזה בדיוק „צור אם אין, אחרת קרא”.
     */
    const row = await tx.contactOptOutToken.upsert({
      where: { tenantId_contactId: { tenantId, contactId } },
      create: {
        id: ulid(),
        tenantId,
        contactId,
        token: randomBytes(32).toString("base64url"),
      },
      update: {},
      select: { token: true },
    });
    return row.token;
  }

  /**
   * ‎**ההסרה עצמה — מהקישור שבתחתית המייל** (§30א).
   *
   * ‏הטוקן מזהה את הכרטיס בטבלה שאין בה PII; רק אחרי שהוצב הקשר
   * ‏הדייר מתוך אותה שורה נכתבת ההסרה על הכרטיס — אותו סדר בדיוק
   * ‏כמו במסלול ההצעה, ולכן אין כאן דרך שנייה להסיר.
   *
   * ‏אידמפוטנטי: לחיצה שנייה אינה מזיזה את מועד ההסרה.
   */
  async publicEmailOptOut(token: string): Promise<void> {
    await this.prisma.withPublicContactOptOut(token, async (tx) => {
      const row = await tx.contactOptOutToken.findFirst({
        where: { token },
        select: { tenantId: true, contactId: true },
      });
      if (row === null) throw new NotFoundException("הקישור אינו תקין");
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${row.tenantId}, true)`;
      await tx.contact.updateMany({
        where: { id: row.contactId, tenantId: row.tenantId, optedOutAt: null },
        data: { optedOutAt: new Date() },
      });
    });
  }

  /**
   * ‎**השליחה — נכסים × קונים, ומה שלא יצא נאמר במפורש.**
   *
   * ‏מכרטיס הנכס מגיע נכס אחד והרבה קונים; מכרטיס הקונה — קונה
   * ‏אחד והרבה נכסים. אותה קריאה בדיוק, ולכן שני הצדדים רשימות.
   *
   * ‏התוצאה סופרת בנפרד את מי שאין לו מייל ואת מי שהסיר את עצמו:
   * ‏„נשלח ל-7 מתוך 10” בלי לומר מה קרה לשלושה הוא בדיוק ה„✓
   * ‏נשלח” שאינו נכון.
   */
  async send(input: { propertyIds: string[]; buyerIds: string[] }): Promise<PitchResult> {
    const tenantId = TenantContext.current().tenantId;
    if (input.propertyIds.length === 0 || input.buyerIds.length === 0) {
      throw new BadRequestException("צריך לבחור לפחות נכס אחד ולפחות קונה אחד");
    }
    if (!(await this.email.isConfigured())) {
      throw new BadRequestException("שליחת אימייל אינה מוגדרת במערכת");
    }

    /*
     * ‏קישורי דף הנחיתה נוצרים פעם אחת לכל נכס, לפני הלולאה:
     * ‏`ensure` אידמפוטנטי, אבל קריאה לו בתוך הלולאה הייתה חוזרת
     * ‏על אותה עבודה לכל נמען.
     */
    const properties = await this.propertyCards(tenantId, input.propertyIds);
    if (properties.length === 0) throw new NotFoundException("הנכס לא נמצא");

    /*
     * ‎**הרשימה נשלפת מחדש ואינה מתקבלת מהמסך.** המסך שלח מזהים;
     * ‏מי מהם באמת שייך למשרד הזה, נראה לסוכן הזה, ומה מצבו — זו
     * ‏שאלה שנענית בשרת. בחירה שהגיעה מהדפדפן אינה הרשאה.
     */
    const allowed = await this.buyers({ limit: 5000 });
    const chosen = new Set(input.buyerIds);
    const selected = allowed.filter((row) => chosen.has(row.buyerId));

    /*
     * ‎**נמען אחד לכל אדם, לא לכל כרטיס** (ביקורת Codex, P1).
     *
     * ‏למערכת מותר במפורש שיהיו שני כרטיסי קונה על אותו איש קשר —
     * ‏שתי דרישות שונות של אותו אדם, או שארית של מיזוג (ראו
     * ‎`partner-match.ts`, שם אותה עובדה כבר תפסה באג של „לשדך אדם
     * ‏לעצמו”). „סמן הכל” היה שולח לאותו אדם את אותו מייל פעמיים.
     *
     * ‏הכרטיס הראשון הוא שנשמר, כי התג בתיבת הדואר וכתובת התשובה
     * ‏נגזרים ממנו וצריך שיהיה להם כרטיס אחד לחזור אליו.
     */
    const byContact = new Map<string, PitchBuyerRow>();
    for (const row of selected) {
      if (!byContact.has(row.contactId)) byContact.set(row.contactId, row);
    }
    const rows = [...byContact.values()];

    const result: PitchResult = {
      sent: 0,
      skippedNoEmail: 0,
      skippedOptedOut: 0,
      failed: 0,
      unknown: 0,
    };
    const officeName = await this.officeName(tenantId);
    const env = loadEnv();

    for (const row of rows) {
      if (row.state === "no_email") {
        result.skippedNoEmail += 1;
        continue;
      }
      if (row.state === "opted_out") {
        result.skippedOptedOut += 1;
        continue;
      }
      try {
        const outcome = await this.sendOne({
          tenantId,
          row,
          properties,
          officeName,
          origin: env.WEB_ORIGIN,
        });
        if (outcome === "sent") result.sent += 1;
        else if (outcome === "opted_out") result.skippedOptedOut += 1;
        else result.skippedNoEmail += 1;
      } catch (error) {
        /*
         * ‏כישלון אצל נמען אחד אינו עוצר את השאר — אבל הוא **נספר**
         * ‏ומוחזר, ובנפרד לפי מה שידוע: „נדחתה” ודאית מול „איננו
         * ‏יודעים”. שליחה לעשרה שהצליחה לתשעה היא לא „נשלח”, וגם
         * ‏לא „נכשל”.
         *
         * ‎**אותה פונקציה שקובעת את מצב השורה** — ולא הכרעה שנייה
         * ‏לאותה שגיאה. שתיהן ישבו בקובץ הזה בשני ניסוחים, ולכן
         * ‏יכלו לחלוק על עצמן: השורה בתיבה אומרת דבר אחד, והמונה
         * ‏שמוצג לסוכן אומר אחר על אותה שליחה בדיוק.
         */
        if (emailSendOutcome(error) === "failed") result.failed += 1;
        else result.unknown += 1;
        this.logger.warn(
          `שליחת הצעת נכס נכשלה לקונה ${row.buyerId} במשרד ${tenantId}: ${String(error)}`,
        );
      }
    }

    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "property_pitch.sent",
        entityType: "property",
        entityId: properties[0]!.propertyId,
        metadata: {
          properties: properties.length,
          ...result,
        },
      }),
    );
    return result;
  }

  /** ‏שם המשרד — ההודעה מדברת בשמו. */
  private async officeName(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    return tenant?.name ?? "משרד התיווך";
  }

  /**
   * ‏כרטיסי הנכסים למייל — **בלי הכתובת המדויקת**, כמו דף הנחיתה.
   *
   * ‏רחוב ומספר אינם נכנסים למייל שיווקי: זה בדיוק מה שמאפשר
   * ‏לעקוף את המתווך ולפנות לבעלים ישירות, ודף הנחיתה כבר נמנע
   * ‏מזה מאותה סיבה.
   */
  private async propertyCards(
    tenantId: string,
    ids: readonly string[],
  ): Promise<(PitchProperty & { propertyId: string })[]> {
    /* ‏אותו נימוק כמו אצל הקונים, בצד השני של הצירוף */
    if (!TenantContext.current().capabilities.has("properties.view")) {
      throw new ForbiddenException("אין הרשאה לצפות בנכסים");
    }
    const rows = await this.prisma.withTenant((tx) =>
      tx.property.findMany({
        where: { id: { in: [...ids] }, tenantId, deletedAt: null },
        select: {
          id: true,
          marketingTitle: true,
          city: true,
          neighborhood: true,
          rooms: true,
          areaSqm: true,
          priceAgorot: true,
          propertyType: true,
        },
      }),
    );
    const out: (PitchProperty & { propertyId: string })[] = [];
    for (const row of rows) {
      const { url } = await this.landing.ensure(row.id);
      out.push({
        propertyId: row.id,
        title: row.marketingTitle ?? row.propertyType ?? "נכס",
        ...(row.city === null ? {} : { city: row.city }),
        ...(row.neighborhood === null ? {} : { neighborhood: row.neighborhood }),
        ...(row.rooms === null ? {} : { rooms: Number(row.rooms) }),
        ...(row.areaSqm === null ? {} : { areaSqm: Number(row.areaSqm) }),
        ...(row.priceAgorot === null ? {} : { priceAgorot: Number(row.priceAgorot) }),
        landingUrl: url,
      });
    }
    return out;
  }

  /** ‏שליחה לנמען אחד — כולל השורה בתיבה, כדי שתישאר עקבה. */
  private async sendOne(input: {
    tenantId: string;
    row: PitchBuyerRow;
    properties: (PitchProperty & { propertyId: string })[];
    officeName: string;
    origin: string;
  }): Promise<"sent" | "opted_out" | "no_email"> {
    const { tenantId, row, properties, officeName, origin } = input;

    /*
     * ‎**ההסכמה נקראת כאן, ולא רק ברשימה** (ביקורת Codex, P1).
     *
     * ‏`buyers()` צילמה את `optedOutAt` פעם אחת לפני הלולאה. שליחה
     * ‏למאה נמענים אינה מיידית, ומי שלחץ „הסירו אותי” באמצעה היה
     * ‏מקבל בכל זאת דיוור שיווקי — כלומר בדיוק מה ש§30א אוסר, על
     * ‏בקשה שכבר נרשמה במסד.
     *
     * ‏אותה שאילתה מחזירה גם את הכתובת וגם את ההסכמה, כלומר אין
     * ‏כאן סבב נוסף — רק תשובה עדכנית במקום תשובה משומרת.
     */
    const state = await this.prisma.withTenant(async (tx) => {
      const [to, consent] = await Promise.all([
        this.contacts.emailFor(tx, row.contactId),
        tx.contact.findFirst({
          where: { id: row.contactId, tenantId },
          select: { optedOutAt: true },
        }),
      ]);
      return { to, optedOut: (consent?.optedOutAt ?? null) !== null };
    });
    if (state.optedOut) return "opted_out";
    const to = state.to;
    if (to === undefined || to === "") return "no_email";

    const token = await this.prisma.withTenant((tx) =>
      this.optOutToken(tx, tenantId, row.contactId),
    );
    const { subject, content } = buildPropertyPitchEmail({
      officeName,
      buyerName: row.name,
      properties,
      optOutUrl: `${origin}/contact-optout/${token}`,
    });

    /*
     * ‎**תשובת הלקוח חוזרת לסוכן ששלח**, ומתויגת לכרטיס הקונה —
     * ‏זו שליחה שיצאה מכרטיס, ולכן התג הוא עובדה ולא ניחוש.
     */
    const replyTo = await this.emailInbox.replyAddressFor(
      tenantId,
      row.contactId,
      actingUserId(),
      { kind: "buyer", id: row.buyerId },
    );

    /*
     * ‏השורה בתיבה נכתבת **לפני** השליחה ומאושרת אחריה — אותו
     * ‏סדר של כל שליחה אחרת: כשל בכתיבה אחרי שהלקוח כבר קיבל
     * ‏משאיר מייל בלי שום זכר.
     */
    const messageId = ulid();
    const body = [
      content.paragraphs.join("\n"),
      ...properties.map((property) => `${property.title} — ${property.landingUrl}`),
    ].join("\n");
    await this.prisma.withTenant((tx) =>
      tx.emailMessage.create({
        data: {
          id: messageId,
          tenantId,
          contactId: row.contactId,
          direction: "out",
          subject: subject.slice(0, 200),
          body: body.slice(0, 5000),
          readAt: new Date(),
          sendState: "pending",
          cardKind: "buyer",
          cardId: row.buyerId,
          createdBy: actingUserId(),
        },
      }),
    );

    try {
      await this.email.send(to, subject, content, {
        /* ‏אותה שורה, אותו מפתח — ניסיון חוזר לא ישלח עותק שני */
        idempotency: { key: `pitch:${messageId}`, purpose: "offer" },
        tenantId,
        required: true,
        ...(replyTo === null ? {} : { replyTo }),
      });
    } catch (error: unknown) {
      /*
       * ‎**„נכשלה” רק כשידוע שלא יצאה** (ביקורת Codex, P1) —
       * ‏ו-`emailSendOutcome` היא המקום היחיד שמנסח את זה.
       */
      await this.prisma
        .withTenant((tx) =>
          tx.emailMessage.updateMany({
            where: { id: messageId, tenantId },
            data: { sendState: emailSendOutcome(error) },
          }),
        )
        .catch(() => this.logger.error(`סימון מצב שליחה נכשל: ${messageId}`));
      throw error;
    }

    /*
     * ‎**כשל כאן אינו כשל בשליחה — המייל כבר יצא** (ביקורת Codex, P1).
     *
     * ‏הכתיבה הזו הייתה חשופה: חריגה שלה יצאה מ-`sendOne` אל
     * ‏הלולאה שקוראת לה, ושם `emailSendOutcome` סיווגה אותה
     * ‏כ„נכשלה” — על הודעה שהלקוח **קיבל**. הסוכן היה שולח שוב,
     * ‏ומזהה חדש פירושו מפתח ייחודיות חדש, כלומר עותק שני אצל
     * ‏הלקוח. הכלל החדש נכון לשגיאות שליחה; החלון שאחרי שהספק
     * ‏אישר פשוט אינו שייך לו.
     *
     * ‎**ושלושת נתיבי השליחה האחרים כבר עושים בדיוק את זה**, שניים
     * ‏מהם עם אותו משפט מילה במילה. זו הפעם הרביעית שכלל שנוסח
     * ‏במקום אחד נשכח בנתיב שני — ולכן הוא נאכף עכשיו בשער.
     *
     * ‏השורה נשארת `pending` ותתיישן; זה תיעוד חסר, לא שליחה חסרה.
     */
    await this.prisma
      .withTenant(async (tx) => {
        await tx.emailMessage.updateMany({
          where: { id: messageId, tenantId },
          data: { sendState: "sent" },
        });
        /*
         * ‎**וגם על ציר הזמן של הקונה.**
         *
         * ‏השורה בתיבה נושאת `cardKind: "buyer"`, אבל ציר הזמן
         * ‏בכרטיס קורא `interaction` לפי `buyerId` — כלומר ההצעה
         * ‏יצאה, נשמרה, ולא הופיעה בשום מקום שהסוכן מסתכל בו
         * ‏כשהוא פותח את הקונה (בקשת המשתמש).
         *
         * ‏נכתב **כאן ולא לפני השליחה**: ציר הזמן הוא מה שהסוכן
         * ‏קורא כדי לדעת מה נאמר ללקוח, ושורה שאומרת „נשלחה הצעה”
         * ‏על מייל שנדחה היא בדיוק התיעוד הכוזב שהמצב `failed`
         * ‏קיים כדי למנוע.
         */
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            buyerId: row.buyerId,
            kind: "email",
            direction: "out",
            content: `נשלחה הצעת נכס: ${properties.map((item) => item.title).join(", ")}`.slice(
              0,
              1500,
            ),
          },
        });
      })
      // המייל כבר יצא; כשל כאן הוא כשל בתיעוד ולא בשליחה
      .catch(() => this.logger.error(`אישור שליחת הצעת נכס נכשל: ${messageId}`));
    return "sent";
  }
}
