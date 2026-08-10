import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  accessUntil,
  billingAnchorDay,
  checkoutRejectionReason,
  cyclePriceAgorot,
  describeCycle,
  discountedAgorot,
  isBillingCycle,
  nextPeriodEnd,
  periodDaysLeft,
  type BillingCycle,
  type SubscriptionStatus,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { CardcomService, type Payer } from "../../core/cardcom.service";
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
      // מורכב לתצוגה כאן ולא נשמר כמחרוזת: שני השדות הם מה שהחיוב
      // החוזר צריך, ומחרוזת מקבילה הייתה עוד מקום שיכול להיות לא מסונכרן
      cardExpiry:
        row.cardMonth !== null && row.cardYear !== null
          ? `${String(row.cardMonth).padStart(2, "0")}/${String(row.cardYear % 100).padStart(2, "0")}`
          : null,
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
    cardMonth: number | null;
    cardYear: number | null;
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
   * מי משלם — לשם על החשבונית ולמילוי מראש של דף התשלום.
   *
   * בעל/ת המשרד ולא המשתמש שלחץ: החשבונית מונפקת למשרד. אם אין
   * בעלים (מצב שלא אמור לקרות), נופלים למי שלחץ — חשבונית עם שם
   * ריק גרועה מחשבונית עם השם הלא-מדויק.
   */
  private async payer(tenantId: string, userId: string): Promise<Payer> {
    const [tenant, owner, actor] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.user.findFirst({
        where: { tenantId, role: "owner", isActive: true },
        select: { email: true, phone: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true },
      }),
    ]);
    const contact = owner ?? actor;
    return {
      name: tenant?.name ?? "לקוח",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
    };
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
    const fullAgorot = cyclePriceAgorot(plan!, cycle)!;

    /*
     * הנחת הקופון — **מחושבת כאן ולא מתקבלת מהדפדפן**.
     *
     * הסכום שנשלח לסולק ונשמר בשורת התשלום הוא זה שנחשב בשרת מתוך
     * מה שנשמר על הדייר ברגע ההרשמה. סכום שמגיע מהלקוח הוא הזמנה
     * לשלם כמה שרוצים, וגם הוובהוק מאמת מולו.
     *
     * ההנחה **אינה נמחקת כאן** אלא רק כשתשלום מצליח: מי שפתח דף
     * תשלום ונטש לא אמור לאבד את מה שהובטח לו.
     */
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { couponPercentOff: true },
    });
    const amountAgorot = discountedAgorot(fullAgorot, tenant?.couponPercentOff ?? null);

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
        payer: await this.payer(input.tenantId, input.userId),
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
      await this.prisma.payment.updateMany({
        where: { lowProfileId, status: "pending" },
        data: {
          status: "failed",
          failureReason: verified.message.slice(0, 300) || "התשלום לא אושר",
        },
      });
      return { applied: false, status: "failed" };
    }

    /*
     * ההתאמה לשורה שלנו נעשית **לפי `LowProfileId` ולא לפי
     * `ReturnValue`** — אזהרה מפורשת של קארדקום, ואותה החלטה כמו
     * באינטגרציה שכבר רצה אצלנו בפרודקשן. ה-`ReturnValue` משמש
     * לצילוב בלבד: כשהוא קיים ואינו תואם, משהו לא במקומו והתשלום
     * לא מופעל.
     */
    const payment = await this.prisma.payment.findUnique({ where: { lowProfileId } });
    if (!payment) {
      // עסקה על אותו מסוף שאינה שלנו — למשל תשלום ממערכת אחרת
      this.logger.warn(`התקבל אישור על דף תשלום שאינו מוכר: ${lowProfileId}`);
      return { applied: false, status: "unknown" };
    }
    if (verified.reference !== null && verified.reference !== payment.id) {
      this.logger.error(
        `אי-התאמה בין דף התשלום ${lowProfileId} לבין המזהה שהוחזר ${verified.reference}`,
      );
      return { applied: false, status: "unknown" };
    }
    if (payment.status === "paid") return { applied: false, status: "paid" };

    /*
     * הסכום שנגבה בפועל חייב להתאים לסכום שנרשם, ו**חייב להיות ידוע**.
     * תשובה שאין בה סכום אינה "בסדר" — היא תשובה שאי אפשר לאמת, ובלי
     * הדרישה הזו קודי תגובה תקינים לבדם היו מפעילים מנוי מלא (ביקורת
     * Codex). בלי הבדיקה בכלל, שינוי הסכום בדף התשלום היה מספיק.
     */
    if (verified.amountAgorot === null || verified.amountAgorot !== payment.amountAgorot) {
      this.logger.error(
        `סכום שאינו תואם בתשלום ${payment.id}: נגבו ${verified.amountAgorot ?? "לא ידוע"} מול ${payment.amountAgorot}`,
      );
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: "pending" },
        data: { status: "failed", failureReason: "הסכום שנגבה אינו תואם להזמנה" },
      });
      return { applied: false, status: "failed" };
    }

    const now = new Date();
    const cycle: BillingCycle = isBillingCycle(payment.billingCycle)
      ? payment.billingCycle
      : "monthly";
    // מחוץ לטרנזקציה כי הוא עשוי ליצור שורה; מה שנקרא ממנו נקרא שוב
    // בפנים, ושם זה קובע
    await this.ensureSubscription(payment.tenantId);
    const token = verified.token ? this.crypto.encrypt(verified.token) : null;

    /*
     * **הכול בטרנזקציה אחת, כולל סימון התשלום כשולם.**
     *
     * הסימון היה קודם לפניה. משמעות הפער: תהליך שנפל בין השניים היה
     * משאיר תשלום מסומן "שולם" ומנוי שלא הופעל — ולנצח, כי כל ניסיון
     * חוזר של הוובהוק נעצר בדיוק על הסימון הזה. לקוח מחויב בלי שירות
     * ובלי מסלול התאוששות (ביקורת Codex).
     *
     * המעבר המותנה `pending ⟵ paid` נשאר השער מול הודעות כפולות; הוא
     * פשוט נבדק עכשיו **בתוך** הטרנזקציה, כך שאו ששניהם קורים או
     * שאף אחד.
     */
    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: "pending" },
        data: {
          status: "paid",
          paidAt: now,
          transactionId: verified.transactionId,
          documentType: verified.documentType,
          documentNumber: verified.documentNumber,
        },
      });
      if (claimed.count === 0) return null; // מישהו הקדים — אין מה לעשות

      const subscription = await tx.subscription.findUnique({
        where: { tenantId: payment.tenantId },
      });
      // העוגן נקבע פעם אחת ואינו מחושב מחדש מהתאריך המקוצר
      const anchorDay = subscription?.billingAnchorDay ?? billingAnchorDay(now);
      const periodEnd = nextPeriodEnd(subscription?.currentPeriodEnd, now, cycle, anchorDay);

      await tx.subscription.update({
        where: { tenantId: payment.tenantId },
        data: {
          planCode: payment.planCode,
          billingCycle: cycle,
          status: "active",
          currentPeriodEnd: periodEnd,
          billingAnchorDay: anchorDay,
          // ביטול קודם מתבטל ברכישה חדשה — אחרת המשרד היה משלם
          // וממשיך לראות "המנוי בוטל"
          cancelledAt: null,
          ...(token
            ? {
                cardTokenEncrypted: token,
                cardLast4: verified.cardLast4,
                cardMonth: verified.cardMonth,
                cardYear: verified.cardYear,
                cardOwnerIdEncrypted: verified.cardOwnerIdentity
                  ? this.crypto.encrypt(verified.cardOwnerIdentity)
                  : null,
              }
            : {}),
        },
      });
      await tx.tenant.update({
        where: { id: payment.tenantId },
        data: {
          plan: payment.planCode,
          status: "active",
          // הניסיון נגמר ברכישה; השארתו הייתה נועלת משרד משלם ביום התפוגה
          trialEndsAt: null,
          /*
           * שער ההרשאה. בלעדיו תשלום אחד היה פותח גישה לנצח, כי
           * `tenantCanOperate` קורא את שורת הדייר ולא את המנוי.
           *
           * `accessUntil` ולא `periodEnd`: החיוב החוזר נבדק **אחרי**
           * סוף התקופה, ובלי חלון החסד כל משרד משלם היה ננעל בחוץ בכל
           * מחזור עד שהסורק רץ. אותה פונקציה משמשת גם את החידוש, כי
           * שני ערכים שונים ל-`paid_until` היו בדיוק הבאג הזה.
           */
          paidUntil: accessUntil(periodEnd),
          /*
           * ההנחה נצרכת **כאן**, בתשלום שהצליח, ולא בפתיחת דף
           * התשלום: מי שפתח דף ונטש לא אמור לאבד את מה שהובטח לו.
           * `couponCode` נשאר לתמיכה ולדוח — הוא היסטוריה, לא זכאות.
           */
          couponPercentOff: null,
        },
      });
      return periodEnd;
    });

    if (outcome === null) return { applied: false, status: "paid" };

    this.logger.log(
      `מנוי הופעל: משרד ${payment.tenantId}, מסלול ${payment.planCode}, עד ${outcome.toISOString()}`,
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
          cardMonth: null,
          cardYear: null,
          cardOwnerIdEncrypted: null,
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
