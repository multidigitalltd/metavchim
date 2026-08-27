import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import {
  AUTO_OFFER_MAX_PER_EMAIL,
  AUTO_OFFER_MIN_SCORE,
  buildOfferEmail,
  OfferPresentationSchema,
  type OfferEmailItem,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { EmailRejectedError, EmailService } from "../../core/email.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { AgreementsService } from "../agreements/agreements.service";
import { ContactsService } from "../contacts/contacts.service";
import { ExclusivityService } from "../exclusivity/exclusivity.service";
import { OffersService } from "./offers.service";

/**
 * כל עשר דקות — מהיר מספיק כדי ש"נכס חדש" יגיע ללקוח בעודו חדשות,
 * ואיטי מספיק כדי שגל התאמות מלקוח שנרשם הרגע יתקבץ למייל אחד.
 */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** שתי דקות אחרי העלייה — אחרי המיגרציות וההגדרות, כמו שאר הסורקים. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;

/**
 * תקרת לקוחות למשרד בסבב. לא מכסה — ויסות: השאר מחכים לסבב הבא,
 * שכבר מתוזמן. שולח שמפזר את העומס שלו הוא גם שולח שספקי הדואר
 * אינם חוסמים.
 */
const MAX_BUYERS_PER_TENANT_SWEEP = 20;

const TOKEN_TTL_DAYS = 14;

interface EligibleMatch {
  matchId: string;
  buyerId: string;
  propertyId: string;
}

/**
 * הצעה שנכתבה ומחכה למייל.
 *
 * ‎**`propertyId` ו-`buyerId` נוסעים איתה לא בשביל השליחה אלא בשביל
 * מה שנרשם אחריה.** התיעוד שטוען „נשלח” נכתב בטרנזקציית האישור,
 * ולכן הוא זקוק שם לנכס ולקונה — ולא רק לכתובת ולכותרת.
 */
interface OutgoingOffer {
  offerId: string;
  token: string;
  title: string;
  priceAgorot?: number;
  propertyId: string;
  buyerId: string;
}

/**
 * הצעות אוטומטיות במייל — התאמות פנימיות של המשרד בלבד.
 *
 * ## מה קורה כאן
 *
 * משרד שהדליק את `autoEmailOffers` בהגדרות: התאמה פנימית חדשה
 * (נכס ↔ לקוח של אותו משרד, טבלת `matches` — הרשת אינה נכנסת לכאן
 * בכלל) שנולדה מומלצת (ציון ≥ 85) הופכת להצעה רגילה — אותו
 * Snapshot, אותו דף ציבורי, אותו תיעוד — והקישור נשלח ללקוח במייל
 * בשם המשרד, מהדומיין שלו אם חובר ואומת.
 *
 * ## מי **לא** מקבל
 *
 * - לקוח בלי כתובת אימייל בכרטיס.
 * - לקוח שהסיר את עצמו (`Contact.optedOutAt`) — קישור ההסרה נמצא
 *   בכל מייל, כנדרש בחוק התקשורת §30א.
 * - לקוח שטרם חתם על הזמנה בכתב לנכס — אותו שער החתמה בדיוק כמו
 *   בהצעה ידנית (חוק המתווכים §9). ההתאמה נשארת לסוכן, שיכול
 *   לשלוח קודם את ההסכם.
 * - התאמות לנכסי טיוטה: סוכן רשאי להציע טיוטה במודע; אוטומציה
 *   משווקת רק נכס שהמשרד סימן פעיל.
 * - התאמות שחושבו לפני הפעלת הדגל — ההפעלה היא "מכאן והלאה".
 *
 * ## הסדר: יצירה → שליחה → אישור
 *
 * ההצעות נכתבות תחילה בסטטוס `pending_email` (טרנזקציה), המייל
 * נשלח, ורק אז הסטטוס הופך `sent`. כך כשל שליחה אינו משאיר "נשלח"
 * שלא נשלח: `pending_email` מנוסה שוב בכל סבב; דחייה ודאית של
 * הספק (4xx) או פקיעת הטוקן מסמנות `email_failed` — גלוי לסוכן
 * במסך ההצעות, שממשיך משם ידנית. קריסה בין שליחה לאישור עלולה
 * לשלוח מייל כפול זהה — המחיר הזול מבין שני הכיוונים.
 *
 * ‎**והזכאות נבדקת מחדש בניסיון החוזר, לא רק ביצירה.** בין הסבבים
 * הלקוח יכול היה להסיר את עצמו והנכס יכול היה להימכר; הצעה ממתינה
 * שהנכס שלה ירד משיווק אינה נשלחת אלא מסומנת `email_failed`. קישור
 * חי אינו מוכר דירה שנמכרה, וזה נכון גם כשהשליחה כבר בתור.
 *
 * ‎**והכלל הזה חל על כל מה שנכתב, לא רק על הסטטוס.** שורת "נשלחה
 * הצעה" בכרטיס הקונה ופעולת השיווק בתיק הבלעדיות הן קביעות על
 * העולם, ושתיהן נכתבות בטרנזקציית האישור. מה שיושב בשלב היצירה
 * מתאר רק את מה שקרה שם — נוצרה הצעה שממתינה למייל.
 *
 * ## למה ב-API ולא ב-Workers
 *
 * אותו נימוק כמו שאר הסורקים כאן: אישורי הדואר מוצפנים
 * ב-`platform_settings` ונקראים רק בתהליך הזה, ו-PII של אנשי קשר
 * מפוענח באותה שכבה. הסבב זול — שאילתות ספורות למשרד.
 */
@Injectable()
export class OfferEmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfferEmailService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly offers: OffersService,
    private readonly contacts: ContactsService,
    private readonly agreements: AgreementsService,
    private readonly exclusivity: ExclusivityService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    }, FIRST_SWEEP_DELAY_MS);
    // אחרת התהליך לא יוצא בבדיקות ובסקריפטים קצרים
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error: unknown) {
      this.logger.error(`סבב הצעות אוטומטיות נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** סבב אחד על כל המשרדים. ציבורי — לבדיקות, כמו שאר הסורקים. */
  async sweep(): Promise<{ emails: number; offers: number }> {
    // בלי ספק דואר אין לאן לשלוח — עדיף לא ליצור הצעות שימתינו לשווא
    if (!(await this.email.isConfigured())) return { emails: 0, offers: 0 };

    const tenants = await this.prisma.tenant.findMany({
      select: { id: true, name: true, settings: true },
    });
    let emails = 0;
    let offers = 0;
    for (const tenant of tenants) {
      const settings = (tenant.settings ?? {}) as Record<string, unknown>;
      if (settings["autoEmailOffers"] !== true) continue;
      const sinceRaw = settings["autoEmailOffersSince"];
      const since = typeof sinceRaw === "string" ? new Date(sinceRaw) : null;
      // בלי חותמת הפעלה אין קו "מכאן והלאה" — עדיף לא לשלוח כלום
      if (since === null || Number.isNaN(since.getTime())) continue;
      try {
        const result = await TenantContext.run(
          // בלי משתמש ובלי יכולות — הסבב מבצע מדיניות משרד, לא פעולת סוכן
          { tenantId: tenant.id, userId: "", capabilities: new Set(), billingOnly: false },
          () => this.sweepTenant(tenant.id, tenant.name, since),
        );
        emails += result.emails;
        offers += result.offers;
      } catch (error: unknown) {
        // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
        this.logger.warn(`הצעות אוטומטיות נכשלו למשרד ${tenant.id}: ${String(error)}`);
      }
    }
    if (emails > 0) {
      this.logger.log(`הצעות אוטומטיות: ${emails} מיילים, ${offers} הצעות`);
    }
    return { emails, offers };
  }

  private async sweepTenant(
    tenantId: string,
    officeName: string,
    since: Date,
  ): Promise<{ emails: number; offers: number }> {
    let emails = 0;
    let offers = 0;

    /*
     * שלב א' — הצעות שכבר נוצרו וטרם נשלחו (סבב קודם שנפל באמצע,
     * או דחייה זמנית של הספק). לקוח עם ממתינות אינו מקבל חדשות
     * באותו סבב — קודם נסגר החוב, אחרת הוא מקבל שני מיילים.
     */
    const pendingBuyers = await this.retryPending(tenantId, officeName);
    emails += pendingBuyers.emails;

    /*
     * שלב ב' — התאמות חדשות. הזכאות נבדקת מחדש בכל סבב ולא נשמרת:
     * לקוח שהוסיף אימייל או חתם על הסכם אתמול נכנס מעצמו.
     */
    const eligible = await this.eligibleMatches(tenantId, since);
    const byBuyer = new Map<string, EligibleMatch[]>();
    for (const match of eligible) {
      if (pendingBuyers.buyerIds.has(match.buyerId)) continue;
      const list = byBuyer.get(match.buyerId) ?? [];
      if (list.length < AUTO_OFFER_MAX_PER_EMAIL) list.push(match);
      byBuyer.set(match.buyerId, list);
    }

    let processed = 0;
    for (const [buyerId, matches] of byBuyer) {
      if (processed >= MAX_BUYERS_PER_TENANT_SWEEP) {
        this.logger.log(
          `משרד ${tenantId}: ${byBuyer.size - processed} לקוחות נדחו לסבב הבא (ויסות)`,
        );
        break;
      }
      processed += 1;
      try {
        const sent = await this.offerAndEmail(tenantId, officeName, buyerId, matches);
        if (sent > 0) {
          emails += 1;
          offers += sent;
        }
      } catch (error: unknown) {
        this.logger.warn(
          `הצעה אוטומטית נכשלה ללקוח ${buyerId} במשרד ${tenantId}: ${String(error)}`,
        );
      }
    }
    return { emails, offers };
  }

  /**
   * ההתאמות שראויות להישלח אוטומטית. שאילתות גסות ואז סינון מדויק —
   * אותו סדר כמו במנוע ההתאמות עצמו.
   */
  private async eligibleMatches(tenantId: string, since: Date): Promise<EligibleMatch[]> {
    return this.prisma.withTenant(async (tx) => {
      const candidates = await tx.match.findMany({
        where: {
          tenantId,
          status: "suggested",
          score: { gte: AUTO_OFFER_MIN_SCORE },
          /*
           * ‎**`createdAt` ולא `computedAt` — הגבול חייב חותמת שאינה זזה.**
           *
           * ‎`upsertMatch` דורס את `computedAt` בכל חישוב מחדש, וחישוב
           * מחדש קורה על כל עריכת נכס או קונה. כלומר התאמה בת שנתיים
           * שמחירה עודכן אתמול קיבלה חותמת של אתמול, חצתה את גבול
           * ההפעלה, ונשלחה ללקוח שיושב במאגר שנתיים — בדיוק הדיוור
           * ההיסטורי ש„מכאן והלאה” נועד למנוע (ביקורת Codex).
           *
           * ‎`createdAt` נכתב פעם אחת ואינו מתעדכן, ולכן שורה שנוצרה
           * לפני ההפעלה אינה יכולה לחצות את הגבול לעולם.
           */
          createdAt: { gte: since },
        },
        orderBy: { score: "desc" },
        select: { id: true, buyerId: true, propertyId: true },
      });
      if (candidates.length === 0) return [];

      // הצעה אחת פר התאמה — מה שכבר הוצע (בכל ערוץ) לא מוצע שוב
      const offered = new Set(
        (
          await tx.offer.findMany({
            where: { tenantId, matchId: { in: candidates.map((c) => c.id) } },
            select: { matchId: true },
          })
        ).map((o) => o.matchId),
      );

      // אוטומציה משווקת רק נכס פעיל — טיוטה היא בחירה מודעת של סוכן
      const activeProperties = new Set(
        (
          await tx.property.findMany({
            where: {
              tenantId,
              id: { in: [...new Set(candidates.map((c) => c.propertyId))] },
              status: "active",
              deletedAt: null,
            },
            select: { id: true },
          })
        ).map((p) => p.id),
      );

      const buyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(candidates.map((c) => c.buyerId))] },
          deletedAt: null,
        },
        select: { id: true, contactId: true },
      });
      const contactByBuyer = new Map(buyers.map((b) => [b.id, b.contactId]));

      // לקוח בלי אימייל או שהסיר את עצמו — מסונן לפני כל יצירה
      const reachable = new Set(
        (
          await tx.contact.findMany({
            where: {
              tenantId,
              id: { in: [...new Set(buyers.map((b) => b.contactId))] },
              emailEncrypted: { not: null },
              optedOutAt: null,
            },
            select: { id: true },
          })
        ).map((c) => c.id),
      );

      const eligible: EligibleMatch[] = [];
      for (const candidate of candidates) {
        if (offered.has(candidate.id)) continue;
        if (!activeProperties.has(candidate.propertyId)) continue;
        const contactId = contactByBuyer.get(candidate.buyerId);
        if (contactId === undefined || !reachable.has(contactId)) continue;
        // שער ההחתמה — בדיוק כמו בהצעה ידנית; בלי חתימה אין שליחה
        const signed = await this.agreements.hasSigned(
          tx,
          tenantId,
          contactId,
          "brokerage",
          candidate.propertyId,
        );
        if (!signed) continue;
        eligible.push({
          matchId: candidate.id,
          buyerId: candidate.buyerId,
          propertyId: candidate.propertyId,
        });
      }
      return eligible;
    });
  }

  /**
   * לקוח אחד: יצירת ההצעות (טרנזקציה), שליחת מייל אחד, אישור.
   * מחזיר כמה הצעות נשלחו בפועל.
   */
  private async offerAndEmail(
    tenantId: string,
    officeName: string,
    buyerId: string,
    matches: EligibleMatch[],
  ): Promise<number> {
    const created = await this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
        select: { contactId: true },
      });
      if (!buyer) return [];
      const contact = await this.contacts.getById(tx, buyer.contactId);
      if (!contact?.email) return [];

      const rows: OutgoingOffer[] = [];
      for (const match of matches) {
        const property = await tx.property.findFirst({
          where: { id: match.propertyId, tenantId, deletedAt: null, status: "active" },
        });
        if (!property) continue;
        const presentation = await this.offers.presentationFor(tx, tenantId, property);
        const id = ulid();
        const token = randomBytes(32).toString("base64url");
        await tx.offer.create({
          data: {
            id,
            tenantId,
            matchId: match.matchId,
            channel: "email",
            presentation: presentation as object,
            publicToken: token,
            tokenExpires: new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
            status: "pending_email",
          },
        });
        await tx.match.update({ where: { id: match.matchId }, data: { status: "offered" } });
        await this.audit.record(tx, { action: "offer.auto_email", entityType: "offer", entityId: id });
        /*
         * ‎**„נשלחה” ופעולת השיווק אינן כאן.** בשלב הזה ההצעה נוצרה
         * ותו לא; היא עדיין `pending_email` והמייל טרם יצא. שתיהן
         * נכתבות ב-`deliver`, אחרי שהספק קיבל.
         */
        rows.push({
          offerId: id,
          token,
          title: presentation.title,
          ...(presentation.priceAgorot === undefined ? {} : { priceAgorot: presentation.priceAgorot }),
          propertyId: property.id,
          buyerId,
        });
      }
      return rows.map((row) => ({ ...row, to: contact.email as string, buyerName: contact.name }));
    });
    const first = created[0];
    if (first === undefined) return 0;

    await this.deliver(tenantId, officeName, first.to, first.buyerName, created);
    return created.length;
  }

  /** בניית המייל, שליחה, ואישור `sent` — או סימון הכישלון. */
  private async deliver(
    tenantId: string,
    officeName: string,
    to: string,
    buyerName: string,
    rows: OutgoingOffer[],
  ): Promise<void> {
    const first = rows[0];
    if (first === undefined) return;
    const env = loadEnv();
    const items: OfferEmailItem[] = rows.map((row) => ({
      title: row.title,
      ...(row.priceAgorot === undefined ? {} : { priceAgorot: row.priceAgorot }),
      url: `${env.WEB_ORIGIN}/offer/${row.token}`,
    }));
    const { subject, content } = buildOfferEmail({
      officeName,
      buyerName,
      offers: items,
      // כל טוקן הצעה מזהה את הלקוח — הראשון משמש גם להסרה
      optOutUrl: `${env.WEB_ORIGIN}/offer-optout/${first.token}`,
    });

    const offerIds = rows.map((row) => row.offerId);
    try {
      await this.email.send(to, subject, content, { tenantId, required: true });
    } catch (error) {
      if (error instanceof EmailRejectedError && !error.retryable) {
        /*
         * דחייה ודאית (4xx) — כתובת פסולה וכדומה. ניסיון חוזר היה
         * נכשל זהה בכל סבב לנצח; הסימון מוציא את ההצעה מהמחזור
         * ומאיר אותה לסוכן במסך ההצעות.
         *
         * ‎**`retryable` יוצא מכאן במכוון.** חריגה מקצב אצל הספק היא
         * גם היא 4xx וגם בה ההודעה לא יצאה — אבל ההצעה עצמה תקינה,
         * והסבב הבא ישלח אותה. סימון `email_failed` שם היה קובר הצעה
         * בגלל עומס רגעי (ביקורת Codex).
         */
        await this.prisma.withTenant((tx) =>
          tx.offer.updateMany({
            where: { tenantId, id: { in: offerIds } },
            data: { status: "email_failed" },
          }),
        );
        this.logger.error(
          `מייל הצעות נדחה ללקוח במשרד ${tenantId} — ההצעות סומנו email_failed`,
        );
        return;
      }
      // תקלה עמומה (רשת/5xx) — נשאר pending_email לניסיון בסבב הבא
      throw error;
    }

    /*
     * ‎**כל מה שטוען „נשלח” — כאן, ובאותה טרנזקציה של הסטטוס.**
     *
     * זה היה קודם בטרנזקציית היצירה, ושם הוא טען על שליחה שטרם
     * קרתה. שתי תוצאות, ושתיהן נצפו בקוד ולא בהשערה:
     *
     * ‎**1 · פעולת שיווק על מייל שלא יצא.** `offer_sent` נספרת בכלל
     * השליש שבסעיף 9(ב2), ו-`removeAction` חוסמת מחיקה של רשומה
     * אוטומטית — כלומר בלעדיות הייתה נשמרת בזכות הודעה שאיש לא קיבל,
     * בלי דרך לתקן מהמסך (ביקורת Codex).
     *
     * ‎**2 · והחמור מזה: הצעה שנמחקה.** לקוח שהסיר את עצמו בין
     * היצירה לשליחה — ההצעה נמחקת ב-`retryPending` וההתאמה חוזרת
     * לסוכן, אבל הרישום `offer:<id>` והשורה „נשלחה” בכרטיס הקונה
     * נשארו מאחור, מפנים למזהה שכבר אינו קיים.
     *
     * ‎`performedAt` הוא רגע השליחה בפועל, וזה גם התאריך הנכון: כלל
     * השליש מודד חלון זמן, ותיארוך למועד היצירה היה מזיז את הפעולה
     * לפני שקרתה.
     */
    const sentAt = new Date();
    await this.prisma.withTenant(async (tx) => {
      await tx.offer.updateMany({
        where: { tenantId, id: { in: offerIds } },
        data: { status: "sent", sentAt },
      });
      for (const row of rows) {
        // רגע-ציר על הקונה: "כלום לא נשכח" — ההצעה בהיסטוריה שלו
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId,
            buyerId: row.buyerId,
            kind: "system",
            content: `נשלחה הצעה אוטומטית במייל: ${row.title}`,
            createdBy: null,
          },
        });
        // אותה פעולת שיווק כמו הצעה ידנית — נרשמת בתיק הבלעדיות
        await this.exclusivity.recordAuto(tx, row.propertyId, "offer_sent", {
          sourceKey: `offer:${row.offerId}`,
          performedAt: sentAt,
          detail: `הצעה אוטומטית נשלחה במייל לקונה מהמאגר: ${row.title}`,
        });
        await this.outbox.emit(tx, "offer.sent", { offerId: row.offerId, tenantId });
      }
    });
  }

  /**
   * הצעות `pending_email` מסבבים קודמים: פקעו — `email_failed`;
   * הלקוח הסיר את עצמו בינתיים — נמחקות וההתאמה חוזרת לסוכן;
   * אחרת — ניסיון שליחה נוסף, מקובץ למייל אחד לכל לקוח.
   */
  private async retryPending(
    tenantId: string,
    officeName: string,
  ): Promise<{ emails: number; buyerIds: Set<string> }> {
    const pending = await this.prisma.withTenant(async (tx) => {
      const rows = await tx.offer.findMany({
        where: { tenantId, channel: "email", status: "pending_email" },
        select: {
          id: true,
          matchId: true,
          publicToken: true,
          tokenExpires: true,
          presentation: true,
        },
      });
      if (rows.length === 0) return [];

      /*
       * ‎`propertyId` נשלף כאן ולא רק `buyerId`, כי תיעוד השליחה עבר
       * לטרנזקציית האישור והוא זקוק לנכס. בלעדיו ההצעה הייתה נשלחת
       * בניסיון החוזר ולא נרשמת בתיק הבלעדיות כלל.
       */
      const matches = await tx.match.findMany({
        where: { tenantId, id: { in: rows.map((r) => r.matchId) } },
        select: { id: true, buyerId: true, propertyId: true },
      });
      const byMatch = new Map(matches.map((m) => [m.id, m]));
      return rows.map((row) => {
        const match = byMatch.get(row.matchId);
        return {
          ...row,
          buyerId: match?.buyerId ?? null,
          propertyId: match?.propertyId ?? null,
        };
      });
    });
    if (pending.length === 0) return { emails: 0, buyerIds: new Set() };

    /*
     * ההתאמה נעלמה בין הסבבים — אין קונה ואין נכס, ולכן אין למי
     * לשלוח ואין מה לתעד. שער אחד במקום בדיקה לכל שדה בנפרד.
     */
    const resolved = pending.filter(
      (row): row is typeof row & { buyerId: string; propertyId: string } =>
        row.buyerId !== null && row.propertyId !== null,
    );

    /*
     * ‎**הנכס נבדק שוב — כי בין הסבבים הוא יכול היה להימכר.**
     *
     * הזכאות הראשונית דורשת `status: "active"` ו-`deletedAt: null`,
     * והמסלול הזה בדק עד כה את **הלקוח** בלבד (הסרה מרשימת התפוצה).
     * כלומר שליחה שנכשלה בפסק זמן, ואחריה הנכס נמכר או ירד משיווק,
     * הייתה יוצאת בסבב הבא: הלקוח מקבל הצעה על דירה שהמשרד כבר משך,
     * ומאז ששליחה מתעדת פעולת שיווק — גם נרשמת פעולה על נכס שהוסר
     * (ביקורת Codex).
     *
     * ‎**ולא `offerPropertyMarketable` שכבר קיים**: הוא מתיר גם
     * ‎`draft`, כי מתווך רשאי להציע טיוטה במודע. האוטומציה משווקת רק
     * מה שהמשרד סימן פעיל, ושימוש חוזר בו כאן היה מרחיב אותה בשקט.
     */
    const stillActive = new Set(
      (
        await this.prisma.withTenant((tx) =>
          tx.property.findMany({
            where: {
              tenantId,
              id: { in: [...new Set(resolved.map((row) => row.propertyId))] },
              status: "active",
              deletedAt: null,
            },
            select: { id: true },
          }),
        )
      ).map((row) => row.id),
    );

    const withdrawn = resolved.filter((row) => !stillActive.has(row.propertyId));
    if (withdrawn.length > 0) {
      /*
       * יוצא מהמחזור ונשאר גלוי לסוכן במסך ההצעות — אותו מצב סופי
       * כמו טוקן שפג. ההתאמה **אינה** חוזרת ל„מומלצת”: נכס שנמכר
       * אינו הצעה שכדאי לשלוח ידנית.
       */
      await this.prisma.withTenant((tx) =>
        tx.offer.updateMany({
          where: { tenantId, id: { in: withdrawn.map((row) => row.id) } },
          data: { status: "email_failed" },
        }),
      );
      this.logger.log(
        `משרד ${tenantId}: ${withdrawn.length} הצעות ממתינות בוטלו — הנכס אינו משווק עוד`,
      );
    }
    const marketable = resolved.filter((row) => stillActive.has(row.propertyId));

    const buyerIds = new Set<string>();
    const now = new Date();
    const byBuyer = new Map<string, typeof marketable>();
    for (const offer of marketable) {
      buyerIds.add(offer.buyerId);
      if (offer.tokenExpires < now) {
        // הטוקן פג לפני שהשליחה הצליחה — סוף המחזור, הסוכן ממשיך ידנית
        await this.prisma.withTenant((tx) =>
          tx.offer.update({ where: { id: offer.id }, data: { status: "email_failed" } }),
        );
        continue;
      }
      const list = byBuyer.get(offer.buyerId) ?? [];
      list.push(offer);
      byBuyer.set(offer.buyerId, list);
    }

    let emails = 0;
    for (const [buyerId, offers] of byBuyer) {
      const contact = await this.prisma.withTenant(async (tx) => {
        const buyer = await tx.buyer.findFirst({
          where: { id: buyerId, tenantId, deletedAt: null },
          select: { contactId: true },
        });
        if (!buyer) return null;
        const row = await tx.contact.findFirst({
          where: { id: buyer.contactId, tenantId },
          select: { optedOutAt: true },
        });
        if (row === null) return null;
        if (row.optedOutAt !== null) return { optedOut: true as const };
        return this.contacts.getById(tx, buyer.contactId);
      });

      if (contact !== null && "optedOut" in contact) {
        /*
         * הלקוח הסיר את עצמו אחרי שההצעה נוצרה ולפני שנשלחה —
         * ההצעה נמחקת וההתאמה חוזרת "מוצעת" → "מומלצת", כדי שהסוכן
         * יראה אותה שוב ויחליט בעצמו (וואטסאפ, טלפון). הסבב הבא לא
         * ייצור אותה מחדש: הכרטיס המוסר מסונן בזכאות.
         */
        await this.prisma.withTenant(async (tx) => {
          for (const offer of offers) {
            await tx.offer.delete({ where: { id: offer.id } });
            await tx.match.updateMany({
              where: { id: offer.matchId, tenantId, status: "offered" },
              data: { status: "suggested" },
            });
          }
        });
        continue;
      }
      if (contact === null || contact.email === undefined) continue;

      try {
        await this.deliver(
          tenantId,
          officeName,
          contact.email,
          contact.name,
          offers.map((offer): OutgoingOffer => {
            const presentation = OfferPresentationSchema.parse(offer.presentation);
            return {
              offerId: offer.id,
              token: offer.publicToken,
              title: presentation.title,
              ...(presentation.priceAgorot === undefined
                ? {}
                : { priceAgorot: presentation.priceAgorot }),
              propertyId: offer.propertyId,
              buyerId: offer.buyerId,
            };
          }),
        );
        emails += 1;
      } catch (error: unknown) {
        this.logger.warn(
          `ניסיון חוזר של מייל הצעות נכשל ללקוח ${buyerId} במשרד ${tenantId}: ${String(error)}`,
        );
      }
    }
    return { emails, buyerIds };
  }
}
