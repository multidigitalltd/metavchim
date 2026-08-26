import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  accessUntil,
  billingAnchorDay,
  checkoutRejectionReason,
  effectiveCyclePriceAgorot,
  describeCycle,
  discountedAgorot,
  isBillingCycle,
  isFreePlan,
  nextPeriodEnd,
  periodDaysLeft,
  sanitizeFeatures,
  type BillingCycle,
  type SubscriptionOfferDefinition,
  type SubscriptionStatus,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { AuditService } from "../../core/audit.service";
import { CreditEconomyService } from "../../core/credit-economy.service";
import { CardcomService, type Payer } from "../../core/cardcom.service";
import { CryptoService } from "../../core/crypto.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { NumberRentalService } from "./number-rental.service";
import { SubscriptionOfferService } from "./subscription-offer.service";

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

/**
 * דף תשלום שנפתח דף חדש במקומו — **אינו „נכשל”.**
 *
 * פתיחת דף חדש היא פעולה שלנו בלבד; דף התשלום הקודם נשאר חי אצל
 * קארדקום וניתן לחיוב. לקוח שחזר ללשונית הישנה ושילם בה חויב
 * באמת — ואם סימנו אותה „נכשל”, המעבר המותנה `pending ⟵ paid`
 * לא תופס אותה, והתוצאה היא חיוב בלי מנוי ובלי מסלול התאוששות
 * (ביקורת Codex).
 *
 * הסטטוס הנפרד אומר את האמת: לא נדחה, הוחלף. `apply` מתייחסת
 * אליו כאל בר-תפיסה, כי אימות מול קארדקום גובר על ניחוש שלנו.
 */
const SUPERSEDED = "superseded";

/**
 * הסטטוסים שאישור תשלום מאומת רשאי לתפוס.
 *
 * ‎`paid` אינו כאן בכוונה — הוא נבדק לפני כן ומחזיר מוקדם, וזה
 * השער מול הודעות כפולות של קארדקום.
 */
const CLAIMABLE: string[] = ["pending", SUPERSEDED];

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly cardcom: CardcomService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly creditEconomy: CreditEconomyService,
    private readonly offers: SubscriptionOfferService,
    private readonly numberRentals: NumberRentalService,
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
    /*
     * המחיר המוסכם למשרד — נקרא כאן ומועבר גם לשער וגם לחישוב.
     * אותה חריגה בדיוק נקראת בחידוש האוטומטי; מחיר שחל רק באחד
     * מהשניים הוא הבטחה שנשברת בחודש השני.
     */
    const priceOverride = await this.plans.tenantPriceOverride(input.tenantId);
    const rejection = checkoutRejectionReason(plan, input.cycle, priceOverride);
    if (rejection !== null) throw new BadRequestException(rejection);

    // אחרי הבדיקה שני אלה ודאיים; ההצהרה כאן היא כדי ש-TypeScript ידע
    const cycle = input.cycle as BillingCycle;
    const fullAgorot = effectiveCyclePriceAgorot(plan!, cycle, priceOverride)!;

    /*
     * הנחת הקופון — **מחושבת כאן ולא מתקבלת מהדפדפן**.
     *
     * הסכום שנשלח לסולק ונשמר בשורת התשלום הוא זה שנחשב בשרת מתוך
     * מה שנשמר על הדייר ברגע ההרשמה. סכום שמגיע מהלקוח הוא הזמנה
     * לשלם כמה שרוצים, וגם הוובהוק מאמת מולו.
     *
     * ההנחה **אינה נמחקת כאן** אלא רק כשתשלום מצליח: מי שפתח דף
     * תשלום ונטש לא אמור לאבד את מה שהובטח לו.
     *
     * הגבלת המסלול של הקופון נאכפת **גם כאן**, לא רק בהרשמה: בלעדיה
     * מי שנרשם למסלול הזול עם קופון מוגבל היה רוכש מיד את היקר
     * באותה הנחה (ביקורת Codex). מסלול אחר ⇒ מחיר מלא, והזכאות
     * נשארת שמורה למסלול הנכון.
     */
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { couponPercentOff: true, couponPlanCode: true },
    });
    const couponEligible =
      tenant?.couponPlanCode === null ||
      tenant?.couponPlanCode === undefined ||
      tenant.couponPlanCode === plan!.code;
    const percentOff = couponEligible ? (tenant?.couponPercentOff ?? null) : null;
    const amountAgorot = discountedAgorot(fullAgorot, percentOff);

    /*
     * **תשלום פתוח אחד לכל משרד.**
     *
     * שני דפי תשלום פתוחים במקביל היו נושאים שניהם את ההנחה: הראשון
     * שמצליח מוחק אותה, אבל השני כבר נוצר עם הסכום המוזל — והנחה
     * שהובטחה לתשלום הראשון הייתה חלה פעמיים (ביקורת Codex). סגירת
     * הקודמים היא הכלל הפשוט שמונע את זה, והוא נכון גם בלי קופון:
     * דף תשלום ישן שמישהו ישלם בו הוא הזמנה ישנה במחיר ישן.
     */
    await this.prisma.payment.updateMany({
      where: { tenantId: input.tenantId, status: "pending" },
      data: { status: SUPERSEDED, failureReason: "נפתח דף תשלום חדש במקומו" },
    });

    const paymentId = ulid();

    /*
     * קופון של 100% ⇒ אין מה לגבות, ואין מה לשלוח לסולק.
     *
     * דף תשלום על אפס שקלים אינו רק מיותר — קארדקום עלולה לדחות
     * אותו, והלקוח עם הקופון התקין ביותר היה היחיד שלא מצליח לקבל
     * את המנוי (ביקורת Codex). ההפעלה ישירה, באותה ליבה של תשלום
     * שהצליח, עם שורת תשלום על 0 כדי שהדוח יראה את המימוש.
     */
    if (amountAgorot === 0) {
      const now = new Date();
      await this.ensureSubscription(input.tenantId);
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            id: paymentId,
            tenantId: input.tenantId,
            planCode: plan!.code,
            billingCycle: cycle,
            amountAgorot: 0,
            status: "paid",
            paidAt: now,
            lowProfileId: paymentId,
            createdBy: input.userId,
          },
        });
        await this.activateWithin(tx, {
          tenantId: input.tenantId,
          planCode: plan!.code,
          cycle,
          now,
          card: null,
        });
      });
      this.logger.log(`מנוי הופעל בקופון מלא: משרד ${input.tenantId}, מסלול ${plan!.code}`);
      // חוזרים לדף החזרה הרגיל — הוא כבר יודע להציג "המנוי פעיל"
      return {
        url: `${loadEnv().WEB_ORIGIN}/settings/billing/return?payment=${paymentId}`,
        paymentId,
      };
    }

    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }

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
   * רכישת קרדיטים — אותו מסלול סליקה בדיוק כמו המנוי.
   *
   * **המחיר נקבע בשרת ולעולם לא מגיע מהדפדפן.** הלקוח שולח כמה
   * קרדיטים הוא רוצה; הסכום נגזר מהכלכלה שהוגדרה בפלטפורמה — חבילה
   * תואמת אם יש, אחרת מחיר היחידה כפול הכמות. סכום שמגיע מהלקוח
   * הוא הזמנה לשלם כמה שרוצים.
   *
   * שורה באותה טבלת תשלומים ולא בטבלה נפרדת: האידמפוטנטיות מול
   * קארדקום, הזיכוי והדוחות כבר יושבים שם, ופיצול היה מכפיל את
   * שלושתם.
   */
  async startCreditCheckout(input: {
    tenantId: string;
    userId: string;
    credits: number;
  }): Promise<{ url: string; paymentId: string }> {
    const economy = await this.creditEconomy.current();
    if (!Number.isInteger(input.credits) || input.credits < 1) {
      throw new BadRequestException("כמות הקרדיטים חייבת להיות מספר שלם חיובי");
    }

    /*
     * חבילה בדיוק בכמות הזו מתומחרת לפי מחירה; אחרת מחיר היחידה.
     * ההתאמה מדויקת ולא "הכי קרוב" — הנחה שנופלת על כמות שהלקוח לא
     * ביקש היא הפתעה, לשני הכיוונים.
     */
    const pkg = economy.packages.find((p) => p.credits === input.credits);
    const amountAgorot = pkg ? pkg.priceAgorot : economy.unitPriceAgorot * input.credits;
    if (amountAgorot < 1) {
      throw new BadRequestException("מחיר הקרדיטים אינו מוגדר — יש לפנות למנהל הפלטפורמה");
    }

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: input.tenantId,
        purpose: "credits",
        creditsPurchased: input.credits,
        amountAgorot,
        status: "pending",
        lowProfileId: paymentId,
        createdBy: input.userId,
      },
    });

    const origin = loadEnv().WEB_ORIGIN;
    try {
      const page = await this.cardcom.createPaymentPage({
        reference: paymentId,
        amountAgorot,
        productName: `${input.credits} קרדיטים לרשת השיתופים`,
        successUrl: `${origin}/collaboration?payment=${paymentId}`,
        failureUrl: `${origin}/collaboration?payment=${paymentId}&failed=1`,
        webhookUrl: `${origin}/api/v1/webhooks/cardcom`,
        // בלי טוקן: רכישת קרדיטים היא חד-פעמית ואינה מתחדשת
        createToken: false,
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
   * פתיחת תשלום על הצעה בלינק — הצעה אישית או לינק מכירה לחבילה.
   *
   * אותה זרימה בדיוק כמו `startCheckout`, עם שני הבדלים מכוונים:
   *
   * 1. **אין שער `isPublic` ואין קופון.** יצירת ההצעה בפלטפורמה היא
   *    ההרשאה למכור את המסלול הזה במחיר הזה, כולל מסלול מוסתר —
   *    וההנחה כבר בתוך המחיר שנקבע, כך שקופון מעליה היה הנחה כפולה
   *    שאיש לא התכוון אליה.
   * 2. **התשלום נושא את מזהה ההצעה.** זה מה שמפעיל, בתשלום שמצליח,
   *    גם את המחיר המוסכם לחידושים הבאים ואת התכונות שהובטחו.
   *
   * הסכום מחושב בשרת מההצעה — כמו תמיד, שום סכום אינו מגיע מהדפדפן.
   */
  async startOfferCheckout(input: {
    tenantId: string;
    userId: string;
    token: string;
  }): Promise<{ url: string; paymentId: string }> {
    const { offer, plan, amountAgorot } = await this.offers.resolveForCheckout(
      input.token,
      input.tenantId,
      new Date(),
    );
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }

    // תשלום פתוח אחד לכל משרד — אותו כלל ומאותה סיבה כמו ב-startCheckout
    await this.prisma.payment.updateMany({
      where: { tenantId: input.tenantId, status: "pending" },
      data: { status: SUPERSEDED, failureReason: "נפתח דף תשלום חדש במקומו" },
    });

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: input.tenantId,
        planCode: plan.code,
        billingCycle: offer.billingCycle,
        amountAgorot,
        status: "pending",
        lowProfileId: paymentId,
        offerId: offer.id,
        createdBy: input.userId,
      },
    });

    const origin = loadEnv().WEB_ORIGIN;
    try {
      const page = await this.cardcom.createPaymentPage({
        reference: paymentId,
        amountAgorot,
        productName:
          offer.kind === "custom"
            ? `${plan.name} — מנוי ${describeCycle(offer.billingCycle)} בהתאמה אישית`
            : `${plan.name} — מנוי ${describeCycle(offer.billingCycle)}`,
        successUrl: `${origin}/settings/billing/return?payment=${paymentId}`,
        failureUrl: `${origin}/settings/billing/return?payment=${paymentId}&failed=1`,
        webhookUrl: `${origin}/api/v1/webhooks/cardcom`,
        // טוקן נשמר — המנוי מתחדש חודש בחודשו באותו סכום
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
        where: { lowProfileId, status: { in: CLAIMABLE } },
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
        where: { id: payment.id, status: { in: CLAIMABLE } },
        data: { status: "failed", failureReason: "הסכום שנגבה אינו תואם להזמנה" },
      });
      return { applied: false, status: "failed" };
    }

    const now = new Date();
    const cycle: BillingCycle = isBillingCycle(payment.billingCycle ?? "")
      ? (payment.billingCycle as BillingCycle)
      : "monthly";
    /*
     * מחוץ לטרנזקציה כי הוא עשוי ליצור שורה; מה שנקרא ממנו נקרא שוב
     * בפנים, ושם זה קובע.
     *
     * **רק למנוי.** רכישת קרדיטים אינה נוגעת במנוי כלל, ויצירת שורת
     * מנוי בעקבותיה הייתה ממציאה מנוי למי שרק קנה קרדיטים.
     */
    if (payment.purpose !== "credits") await this.ensureSubscription(payment.tenantId);
    /*
     * ההצעה שהתשלום מממש — נקראת לפני הטרנזקציה, כמו ensureSubscription.
     * הצעה שנעלמה (לא אמור לקרות — מבטלים, לא מוחקים) אינה עוצרת את
     * ההפעלה: הלקוח שילם, והמסלול שעל שורת התשלום מופעל בכל מקרה.
     */
    const offer =
      payment.offerId !== null ? await this.offers.definitionById(payment.offerId) : null;
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
        where: { id: payment.id, status: { in: CLAIMABLE } },
        data: {
          status: "paid",
          paidAt: now,
          transactionId: verified.transactionId,
          documentType: verified.documentType,
          documentNumber: verified.documentNumber,
        },
      });
      if (claimed.count === 0) return null; // מישהו הקדים — אין מה לעשות

      /*
       * רכישת קרדיטים — הזיכוי **באותה טרנזקציה** שתפסה את השורה.
       *
       * זה מה שהופך אותו לאידמפוטנטי: קארדקום שולח את ההודעה יותר
       * מפעם אחת, ורק מי שהצליח להעביר את השורה `pending ⟵ paid`
       * מזכה. זיכוי מחוץ לטרנזקציה היה יכול לרוץ פעמיים על אותו
       * תשלום, או להיעלם בנפילה בין השניים ולהשאיר לקוח מחויב בלי
       * קרדיטים.
       */
      if (payment.purpose === "credits") {
        await tx.creditLedger.create({
          data: {
            id: ulid(),
            tenantId: payment.tenantId,
            kind: "purchase",
            amount: payment.creditsPurchased ?? 0,
            refId: payment.id,
          },
        });
        return now;
      }

      /*
       * השכרת מספר — ההפעלה באותה טרנזקציה, מאותה סיבה כמו הקרדיטים.
       * תפיסת המספר אצל 015 היא קריאת רשת ולכן רצה **אחרי** הטרנזקציה
       * (ראו למטה); מה שקורה כאן הוא רק מה שחייב להיות אטומי: התקופה.
       */
      if (payment.purpose === "number_rental") {
        if (payment.rentalId === null) return null;
        const activated = await this.numberRentals.activateWithin(tx, payment.rentalId, now);
        if (activated === null) return null;
        /*
         * הכרטיס נשמר על שורת המנוי — אמצעי תשלום אחד למשרד. זה מה
         * שהחיוב החודשי המתחדש של ההשכרה יחייב בו, וגם משרד בניסיון
         * ששכר מספר לפני שרכש מנוי מקבל כך כרטיס שמור.
         */
        if (token !== null) {
          await tx.subscription.updateMany({
            where: { tenantId: payment.tenantId },
            data: {
              cardTokenEncrypted: token,
              cardLast4: verified.cardLast4,
              cardMonth: verified.cardMonth,
              cardYear: verified.cardYear,
              cardOwnerIdEncrypted: verified.cardOwnerIdentity
                ? this.crypto.encrypt(verified.cardOwnerIdentity)
                : null,
            },
          });
        }
        return activated.periodEnd;
      }

      // מכאן והלאה — מנוי. בלי מסלול אין מה להפעיל.
      const planCode = payment.planCode;
      if (planCode === null) return null;

      const periodEnd = await this.activateWithin(tx, {
        tenantId: payment.tenantId,
        planCode,
        cycle,
        now,
        card: token
          ? {
              cardTokenEncrypted: token,
              cardLast4: verified.cardLast4,
              cardMonth: verified.cardMonth,
              cardYear: verified.cardYear,
              cardOwnerIdEncrypted: verified.cardOwnerIdentity
                ? this.crypto.encrypt(verified.cardOwnerIdentity)
                : null,
            }
          : null,
      });
      /*
       * מה שההצעה הבטיחה — **באותה טרנזקציה שתפסה את התשלום**, מאותה
       * סיבה שהזיכוי בקרדיטים שם: רק מי שהעביר `pending ⟵ paid`
       * מפעיל, ולכן הודעה כפולה של קארדקום אינה מעניקה פעמיים.
       *
       * מכסה שנוצלה אינה מבטלת את התקופה — היא כבר הוארכה למעלה,
       * והכסף שולם עבורה. היא כן חוסמת את הטבות ההצעה, ולכן זה מצב
       * שדורש עין אנושית: החזר, או הצעה מעודכנת.
       */
      if (offer !== null && !(await this.applyOfferWithin(tx, payment.tenantId, offer))) {
        this.logger.error(
          `תשלום ${payment.id} מימש הצעה ${offer.id} שמכסתה כבר נוצלה — התקופה הוארכה, הטבות ההצעה לא הוענקו`,
        );
      }
      return periodEnd;
    });

    if (outcome === null) {
      /*
       * בהשכרת מספר, תוצאה ריקה אינה בהכרח "עותק מקביל הקדים": ייתכן
       * שהתשלום נתפס אך ההשכרה כבר שוחררה (דף שנשאר פתוח אחרי ביטול)
       * — כסף בלי שירות. הדיווח בודק את המצב בפועל ושותק בכפילות רגילה.
       */
      if (payment.purpose === "number_rental") {
        await this.numberRentals.reportOrphanPayment(payment.id, payment.rentalId);
      }
      return { applied: false, status: "paid" };
    }

    /*
     * תפיסת המספר אצל 015 — **אחרי** הטרנזקציה: קריאת רשת אינה
     * יושבת בתוך טרנזקציית מסד. היא אידמפוטנטית בעצמה (מספר שכבר
     * נתפס אינו נתפס שוב), וכישלון בה אינו מפיל את הוובהוק — הוא
     * נרשם על ההשכרה ומגיע במייל למנהלי הפלטפורמה, לטיפול ידני.
     */
    if (payment.purpose === "number_rental" && payment.rentalId !== null) {
      await this.numberRentals.provisionAfterPayment(payment.rentalId);
    }

    this.logger.log(
      payment.purpose === "credits"
        ? `קרדיטים נרכשו: משרד ${payment.tenantId}, ${payment.creditsPurchased ?? 0} קרדיטים`
        : payment.purpose === "number_rental"
          ? `השכרת מספר שולמה: משרד ${payment.tenantId}, עד ${outcome.toISOString()}`
          : `מנוי הופעל: משרד ${payment.tenantId}, מסלול ${payment.planCode}, עד ${outcome.toISOString()}`,
    );
    return { applied: true, status: "paid" };
  }

  /**
   * הפעלת המנוי — הליבה המשותפת לתשלום רגיל ולרכישה בקופון של 100%.
   *
   * חייבת לרוץ בתוך טרנזקציה של הקורא, אחרי שהוא תפס את שורת התשלום
   * שלו (`pending ⟵ paid`). שני מסלולי הפעלה עם שני עותקים של הקוד
   * הזה היו נפרדים בדיוק בשדה אחד — וזה השדה שהיה מתגלה בחשבונית.
   */
  private async activateWithin(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    input: {
      tenantId: string;
      planCode: string;
      cycle: BillingCycle;
      now: Date;
      card: {
        cardTokenEncrypted: string;
        cardLast4: string | null;
        cardMonth: number | null;
        cardYear: number | null;
        cardOwnerIdEncrypted: string | null;
      } | null;
    },
  ): Promise<Date> {
    const subscription = await tx.subscription.findUnique({
      where: { tenantId: input.tenantId },
    });
    // העוגן נקבע פעם אחת ואינו מחושב מחדש מהתאריך המקוצר
    const anchorDay = subscription?.billingAnchorDay ?? billingAnchorDay(input.now);
    const periodEnd = nextPeriodEnd(subscription?.currentPeriodEnd, input.now, input.cycle, anchorDay);

    await tx.subscription.update({
      where: { tenantId: input.tenantId },
      data: {
        planCode: input.planCode,
        billingCycle: input.cycle,
        status: "active",
        currentPeriodEnd: periodEnd,
        billingAnchorDay: anchorDay,
        // ביטול קודם מתבטל ברכישה חדשה — אחרת המשרד היה משלם
        // וממשיך לראות "המנוי בוטל"
        cancelledAt: null,
        ...(input.card ?? {}),
      },
    });
    await tx.tenant.update({
      where: { id: input.tenantId },
      data: {
        plan: input.planCode,
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
  }

  /**
   * מימוש מה שההצעה הבטיחה — אחרי שהמנוי עצמו כבר הופעל.
   *
   * שלושה דברים, כולם באותה טרנזקציה של התשלום:
   *
   * 1. **המחיר הסופי הופך למחיר המוסכם של המשרד**, במחזור שנרכש.
   *    זה מה שהופך "מנוי מותאם אישית" לאמת מתמשכת: החידוש האוטומטי
   *    קורא את `priceOverride*` — בלי הכתיבה הזו החודש הראשון היה
   *    במחיר שסוכם והשני במחיר המחירון.
   * 2. **התכונות שהובטחו נפתחות** — איחוד עם ההענקות הקיימות, לא
   *    החלפה: הצעה אינה אמורה למחוק חריג שניתן למשרד קודם לכן.
   *    הדחיות אינן נגועות — סגירה של הפלטפורמה גוברת תמיד.
   * 3. **המימוש נספר** — וזה גם השער. הספירה נעשית **ראשונה
   *    ובתנאי**: `updateMany` שמגדיל רק כשעוד נשאר מקום מתחת למכסה.
   *    כשלא נשאר, הפונקציה מחזירה `false` ואינה מעניקה דבר.
   *
   * ‎**למה זה השתנה.** קודם הספירה הייתה אחרונה וללא תנאי, בהנחה
   * מתועדת שחציית המכסה היא „מרוץ נדיר”, ושעדיף לתת שירות למי
   * ששילם. ההנחה הראשונה נשברה כשדף שהוחלף הפך לבר-תפיסה: שתי
   * לשוניות מספיקות כדי ששני דפים יהיו סליקים, וההצעה החד-פעמית
   * הייתה נפרעת פעמיים (ביקורת Codex). המרוץ כבר לא נדיר.
   *
   * ההנחה השנייה נשמרת: **התקופה שנרכשה כן ניתנת** — הכסף שולם
   * עבורה, וזה נקבע ב-`apply` לפני הקריאה לכאן. מה שהמכסה חוסמת הוא
   * מה שהיא באמת מגבילה: המחיר המוסכם, התכונות, וספירת המימוש. כך
   * אף אחד אינו מחויב בלי לקבל דבר, ו„חד-פעמית” נשארת חד-פעמית.
   */
  private async applyOfferWithin(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    tenantId: string,
    offer: SubscriptionOfferDefinition,
  ): Promise<boolean> {
    /*
     * ראשון ובתנאי: `updateMany` מותנה הוא הנעילה. שני תשלומים
     * שמגיעים יחד — כל אחד בטרנזקציה משלו — רק אחד מהם יראה
     * ‎`count === 1`.
     */
    const consumed = await tx.subscriptionOffer.updateMany({
      where:
        offer.maxRedemptions === null
          ? { id: offer.id }
          : { id: offer.id, redemptions: { lt: offer.maxRedemptions } },
      data: { redemptions: { increment: 1 } },
    });
    if (consumed.count === 0) return false;

    if (offer.priceAgorot !== null) {
      await tx.tenant.update({
        where: { id: tenantId },
        data:
          offer.billingCycle === "yearly"
            ? { priceOverrideYearlyAgorot: offer.priceAgorot }
            : { priceOverrideMonthlyAgorot: offer.priceAgorot },
      });
    }
    if (offer.featureGrants.length > 0) {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { featureGrants: true },
      });
      if (tenant) {
        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            featureGrants: sanitizeFeatures([...tenant.featureGrants, ...offer.featureGrants]),
          },
        });
      }
    }
    return true;
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

    /*
     * טרם הוכרע ⇒ הוובהוק טרם הגיע. שואלים את קארדקום ישירות במקום
     * להשאיר את המשרד מול „ממתין” עד שהוא מרענן.
     *
     * ‎**גם `superseded`, לא רק `pending`.** דף שנפתח דף חדש במקומו
     * נשאר חי וניתן לחיוב, ולכן דווקא הוא זה שעלול להיות משולם בלי
     * שהוובהוק הגיע. בדיקה שמדלגת עליו הופכת את הבדיקה החוזרת של
     * דף החזרה לסיבוב סרק — הלקוח מחויב, המסך מסתובב, ואיש אינו
     * שואל את הסולק (ביקורת Codex).
     */
    if (CLAIMABLE.includes(payment.status) && payment.lowProfileId !== paymentId) {
      await this.apply(payment.lowProfileId);
      const fresh = await this.prisma.payment.findFirst({
        where: { id: paymentId, tenantId },
        select: { status: true, failureReason: true },
      });
      if (fresh) return fresh;
    }
    return { status: payment.status, failureReason: payment.failureReason };
  }

  /**
   * רשימת התשלומים של המשרד — לקבלות ולבירורים.
   *
   * `planCode` ריק ברכישת קרדיטים, ו-`purpose` הוא מה שמבדיל. שדה
   * ריק אומר את האמת; ערך מדומה היה גורם לרכישת קרדיטים להיראות
   * כמו מנוי בכל דוח.
   */
  async history(tenantId: string): Promise<
    {
      id: string;
      purpose: string;
      planCode: string | null;
      billingCycle: string | null;
      creditsPurchased: number | null;
      amountAgorot: number;
      status: string;
      paidAt: Date | null;
      createdAt: Date;
    }[]
  > {
    return this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        purpose: true,
        planCode: true,
        billingCycle: true,
        creditsPurchased: true,
        amountAgorot: true,
        status: true,
        paidAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * מעבר עצמי למסלול חינמי — בלחיצה, בלי נציג ובלי דף תשלום
   * (בקשת המשתמש: מסלול השת"פ היה כתוב "פנו אלינו" בלי סיבה).
   *
   * השרת מוודא בעצמו שהמסלול באמת חינמי **וגם** ציבורי — הקוד מגיע
   * מהלקוח ואינו ראיה: מסלול בתשלום, "לפי הצעה", או מסלול מוסתר
   * שנשלחו לכאן נדחים. תקופה ששולמה לא נלקחת: המעבר החינמי חל מיד,
   * אבל `paidUntil` מתאפס רק כי המסלול החדש אינו פוקע — אין כאן
   * ויתור על כסף, אין תקופת חיוב שממשיכה לרוץ, והכרטיס נמחק כמו
   * בביטול.
   */
  async switchToFreePlan(tenantId: string, planCode: string): Promise<void> {
    const plan = (await this.plans.publicPlans()).find((p) => p.code === planCode);
    if (!plan) throw new BadRequestException("מסלול לא מוכר");
    if (!isFreePlan(plan)) {
      throw new BadRequestException("המסלול הזה אינו חינמי — המעבר אליו נעשה דרך דף התשלום");
    }
    await this.ensureSubscription(tenantId);
    await this.prisma.withTenant(async (tx) => {
      await tx.subscription.update({
        where: { tenantId },
        data: {
          planCode: plan.code,
          status: "active",
          // אין תקופה = החידוש האוטומטי לא נוגע בשורה הזו
          currentPeriodEnd: null,
          cancelledAt: null,
          cardTokenEncrypted: null,
          cardLast4: null,
          cardMonth: null,
          cardYear: null,
          cardOwnerIdEncrypted: null,
        },
      });
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          plan: plan.code,
          status: "active",
          trialEndsAt: null,
          // null = בלי תפוגה — מסלול חינמי אינו ננעל
          paidUntil: null,
        },
      });
      await this.audit.record(tx, {
        action: "subscription.switched_free",
        entityType: "subscription",
        entityId: tenantId,
        metadata: { planCode: plan.code },
      });
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
