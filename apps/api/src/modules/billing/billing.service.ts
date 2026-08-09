import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  checkoutRejectionReason,
  cyclePriceAgorot,
  describeCycle,
  isBillingCycle,
  nextPeriodEnd,
  periodDaysLeft,
  type BillingCycle,
  type SubscriptionStatus,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { CardcomService } from "../../core/cardcom.service";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * מנוי בתשלום.
 *
 * זרימת הרכישה: המשרד בוחר מסלול ⟵ נוצרת שורת תשלום `pending` ⟵
 * נפתח דף תשלום אצל קארדקום ⟵ הדפדפן מופנה אליו ⟵ המשרד משלם ⟵
 * המנוי מופעל.
 *
 * ההפעלה קורית **בשני מסלולים שמגיעים לאותה פונקציה**: הוובהוק
 * מקארדקום, ודף החזרה שהמשרד רואה. זה לא כפל מיותר — וובהוק יכול
 * להתעכב דקות, ומשרד ששילם ורואה "עדיין בניסיון" מתקשר לתמיכה.
 * שניהם עוברים דרך `apply`, שהיא אידמפוטנטית, ולכן מי שמגיע שני
 * לא מאריך את התקופה פעם נוספת.
 *
 * `payments` ו-`subscriptions` הן טבלאות ברמת הפלטפורמה (מחוץ
 * ל-RLS) — ראו את ההסבר בסכימה. הסינון לפי דייר נעשה כאן, מפורשות,
 * בכל שאילתה.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly cardcom: CardcomService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  /** מצב המנוי של הדייר הנוכחי, כולל יצירה עצלה לדיירים ותיקים. */
  async current(tenantId: string): Promise<{
    planCode: string;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    daysLeft: number | null;
    cardLast4: string | null;
    cardExpiry: string | null;
    cancelledAt: Date | null;
  }> {
    const row = await this.ensureSubscription(tenantId);
    return {
      planCode: row.planCode,
      billingCycle: isBillingCycle(row.billingCycle) ? row.billingCycle : "monthly",
      status: row.status as SubscriptionStatus,
      currentPeriodEnd: row.currentPeriodEnd,
      daysLeft: periodDaysLeft(row.currentPeriodEnd, new Date()),
      cardLast4: row.cardLast4,
      cardExpiry: row.cardExpiry,
      cancelledAt: row.cancelledAt,
    };
  }

  /**
   * שורת המנוי, ואם אין — נוצרת מהמצב הנוכחי של הדייר.
   *
   * המיגרציה מייצרת שורה לכל דייר קיים, אבל דייר שנוצר בין הרצת
   * המיגרציה לפריסת הקוד הזה לא יקבל אחת. מסך חיוב ריק למשרד שמשלם
   * הוא בדיוק סוג התקלה ששווה שתי שורות קוד למנוע.
   */
  private async ensureSubscription(tenantId: string): Promise<{
    planCode: string;
    billingCycle: string;
    status: string;
    currentPeriodEnd: Date | null;
    cardLast4: string | null;
    cardExpiry: string | null;
    cancelledAt: Date | null;
  }> {
    const existing = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (existing) return existing;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { plan: true, status: true },
    });
    if (!tenant) throw new BadRequestException("המשרד לא נמצא");

    return this.prisma.subscription.create({
      data: {
        id: ulid(),
        tenantId,
        planCode: tenant.plan,
        status: tenant.status === "active" ? "active" : "trial",
      },
    });
  }

  /**
   * פתיחת תשלום — מחזיר את הכתובת שאליה יש להפנות את הדפדפן.
   *
   * שורת התשלום נכתבת **לפני** הפנייה לקארדקום, עם מזהה זמני
   * בעמודת דף התשלום. הסדר הזה מכוון: תשלום שהתקבל בלי שורה תואמת
   * הוא כסף שנגבה בלי שירות, וזה גרוע משורה מיותרת במצב `failed`.
   */
  async startCheckout(input: {
    tenantId: string;
    userId: string;
    planCode: string;
    cycle: string;
  }): Promise<{ url: string; paymentId: string }> {
    const plan = await this.plans.byCode(input.planCode);
    const rejection = checkoutRejectionReason(plan, input.cycle);
    if (rejection !== null) throw new BadRequestException(rejection);

    // אחרי הבדיקה שני אלה ודאיים; ההצהרה כאן היא כדי ש-TypeScript ידע
    const cycle = input.cycle as BillingCycle;
    const amountAgorot = cyclePriceAgorot(plan!, cycle)!;

    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: input.tenantId,
        planCode: plan!.code,
        billingCycle: cycle,
        amountAgorot,
        status: "pending",
        // מציין מקום עד שקארדקום מחזיר מזהה אמיתי. הוא ייחודי כי הוא
        // מזהה השורה עצמה, והעמודה חייבת ערך.
        lowProfileId: paymentId,
        createdBy: input.userId,
      },
    });

    const origin = loadEnv().WEB_ORIGIN;
    try {
      const page = await this.cardcom.createPaymentPage({
        reference: paymentId,
        amountAgorot,
        productName: `${plan!.name} — מנוי ${describeCycle(cycle)}`,
        successUrl: `${origin}/settings/billing/return?payment=${paymentId}`,
        failureUrl: `${origin}/settings/billing/return?payment=${paymentId}&failed=1`,
        webhookUrl: `${origin}/api/v1/webhooks/cardcom`,
        createToken: true,
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { lowProfileId: page.lowProfileId },
      });
      return { url: page.url, paymentId };
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: "failed", failureReason: "פתיחת דף התשלום נכשלה" },
      });
      throw error;
    }
  }

  /**
   * אימות תשלום והפעלת המנוי — **הפונקציה היחידה שמפעילה מנוי**.
   *
   * נקראת גם מהוובהוק וגם מדף החזרה, ולכן היא אידמפוטנטית: המעבר
   * `pending ⟵ paid` נעשה ב-`updateMany` מותנה, ורק מי שהצליח לשנות
   * את השורה ממשיך להאריך את התקופה. בלי התנאי הזה שתי הודעות של
   * קארדקום — והוא שולח יותר מאחת — היו נותנות חודשיים בתשלום אחד.
   *
   * מקור האמת הוא `cardcom.verify`, לא גוף הוובהוק: ההודעה אינה
   * חתומה, וכל מי שיודע את הכתובת יכול לשלוח "שולם".
   */
  async apply(lowProfileId: string): Promise<{ applied: boolean; status: string }> {
    const verified = await this.cardcom.verify(lowProfileId);
    if (!verified.paid) {
      // כישלון מסומן, אבל רק על שורה שעדיין ממתינה — הודעת כישלון
      // מאוחרת לא תבטל תשלום שכבר נקלט
      if (verified.reference) {
        await this.prisma.payment.updateMany({
          where: { id: verified.reference, status: "pending" },
          data: {
            status: "failed",
            failureReason: verified.message.slice(0, 300) || "התשלום לא אושר",
          },
        });
      }
      return { applied: false, status: "failed" };
    }

    if (!verified.reference) {
      this.logger.warn(`תשלום שאושר בקארדקום הגיע בלי מזהה שלנו: ${lowProfileId}`);
      return { applied: false, status: "unknown" };
    }

    const payment = await this.prisma.payment.findUnique({ where: { id: verified.reference } });
    if (!payment) {
      // עסקה על אותו מסוף שאינה שלנו — למשל תשלום שנעשה במערכת אחרת
      this.logger.warn(`התקבל אישור על תשלום שאינו מוכר: ${verified.reference}`);
      return { applied: false, status: "unknown" };
    }
    if (payment.status === "paid") return { applied: false, status: "paid" };

    /*
     * הסכום שנגבה בפועל חייב להתאים לסכום שנרשם. בלי הבדיקה הזו
     * שינוי של הסכום בדף התשלום היה מפעיל מנוי מלא בתשלום סמלי.
     */
    if (verified.amountAgorot !== null && verified.amountAgorot !== payment.amountAgorot) {
      this.logger.error(
        `סכום שאינו תואם בתשלום ${payment.id}: נגבו ${verified.amountAgorot} מול ${payment.amountAgorot}`,
      );
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: "pending" },
        data: { status: "failed", failureReason: "הסכום שנגבה אינו תואם להזמנה" },
      });
      return { applied: false, status: "failed" };
    }

    const now = new Date();

    // המעבר המותנה הוא השער: רק מי שהצליח לשנות את השורה ממשיך
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: {
        status: "paid",
        paidAt: now,
        transactionId: verified.transactionId,
      },
    });
    if (claimed.count === 0) return { applied: false, status: "paid" };

    const cycle: BillingCycle = isBillingCycle(payment.billingCycle)
      ? payment.billingCycle
      : "monthly";
    const subscription = await this.ensureSubscription(payment.tenantId);
    const periodEnd = nextPeriodEnd(subscription.currentPeriodEnd, now, cycle);

    await this.prisma.$transaction([
      this.prisma.subscription.update({
        where: { tenantId: payment.tenantId },
        data: {
          planCode: payment.planCode,
          billingCycle: cycle,
          status: "active",
          currentPeriodEnd: periodEnd,
          // ביטול קודם מתבטל ברכישה חדשה — אחרת המשרד היה משלם
          // וממשיך לראות "המנוי בוטל"
          cancelledAt: null,
          ...(verified.token
            ? {
                cardTokenEncrypted: this.crypto.encrypt(verified.token),
                cardLast4: verified.cardLast4,
                cardExpiry: verified.cardExpiry,
              }
            : {}),
        },
      }),
      this.prisma.tenant.update({
        where: { id: payment.tenantId },
        data: {
          plan: payment.planCode,
          status: "active",
          // הניסיון נגמר ברכישה; השארתו הייתה נועלת משרד משלם ביום התפוגה
          trialEndsAt: null,
        },
      }),
    ]);

    this.logger.log(
      `מנוי הופעל: משרד ${payment.tenantId}, מסלול ${payment.planCode}, עד ${periodEnd.toISOString()}`,
    );
    return { applied: true, status: "paid" };
  }

  /** מצב תשלום בודד — דף החזרה שואל עליו עד שהוא נסגר. */
  async paymentStatus(
    tenantId: string,
    paymentId: string,
  ): Promise<{ status: string; failureReason: string | null }> {
    const payment = await this.prisma.payment.findFirst({
      // tenantId מפורש: הטבלה מחוץ ל-RLS, וזה מה שמונע צפייה בתשלום
      // של משרד אחר לפי ניחוש מזהה
      where: { id: paymentId, tenantId },
      select: { status: true, failureReason: true, lowProfileId: true },
    });
    if (!payment) throw new BadRequestException("התשלום לא נמצא");

    // עדיין ממתין ⇒ הוובהוק טרם הגיע. שואלים את קארדקום ישירות במקום
    // להשאיר את המשרד מול "ממתין" עד שהוא מרענן
    if (payment.status === "pending" && payment.lowProfileId !== paymentId) {
      await this.apply(payment.lowProfileId);
      const fresh = await this.prisma.payment.findFirst({
        where: { id: paymentId, tenantId },
        select: { status: true, failureReason: true },
      });
      if (fresh) return fresh;
    }
    return { status: payment.status, failureReason: payment.failureReason };
  }

  /** רשימת התשלומים של המשרד — לקבלות ולבירורים. */
  async history(tenantId: string): Promise<
    { id: string; planCode: string; billingCycle: string; amountAgorot: number; status: string; paidAt: Date | null; createdAt: Date }[]
  > {
    return this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        planCode: true,
        billingCycle: true,
        amountAgorot: true,
        status: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * ביטול חידוש. השירות ממשיך עד סוף התקופה ששולמה — זה מה שכתוב
   * בתנאי השימוש, והמשרד שילם עליה.
   */
  async cancel(tenantId: string): Promise<void> {
    const subscription = await this.ensureSubscription(tenantId);
    if (subscription.status !== "active") {
      throw new BadRequestException("אין מנוי פעיל לביטול");
    }
    /*
     * טרנזקציה אחת עם הקשר דייר: `subscriptions` יושבת מחוץ ל-RLS
     * אבל `audit_logs` תחתיו, ובלי `withTenant` הכתיבה ליומן הייתה
     * נכשלת. אותה טרנזקציה גם מבטיחה שאין ביטול בלי תיעוד.
     */
    await this.prisma.withTenant(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          // הכרטיס נמחק בביטול — שמירת אמצעי תשלום אחרי בקשת עזיבה
          // אינה משהו שצריך להסביר בדיעבד
          cardTokenEncrypted: null,
          cardLast4: null,
          cardExpiry: null,
        },
      });
      await this.audit.record(tx, {
        action: "subscription.cancelled",
        entityType: "subscription",
        entityId: tenantId,
      });
    });
  }
}
