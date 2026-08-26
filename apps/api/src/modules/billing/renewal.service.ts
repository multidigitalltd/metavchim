import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import { BILLING_GRACE_DAYS, RENEWAL_WARN_WITHIN_DAYS, accessUntil, billingAnchorDay, describeCycle, effectiveCyclePriceAgorot, formatIsraeliNumber, formatJerusalemDate, isBillingCycle, nextPeriodEnd, periodDaysLeft, type BillingCycle } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CardcomService } from "../../core/cardcom.service";
import { CryptoService } from "../../core/crypto.service";
import { EmailService } from "../../core/email.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * חידוש מנוי אוטומטי — בטוקן השמור, בלי דף תשלום ובלי וובהוק.
 *
 * זו הנקודה שהופכת את החידוש לפשוט: `Transactions/Transaction` עם
 * הטוקן מחזיר תשובה **סינכרונית** שאומרת מיד אם החיוב עבר. אין
 * הפניה, אין המתנה, ואין הודעה חוזרת שצריך לאמת — ולכן החידוש הוא
 * סורק ותו לא.
 *
 * הסורק יושב ב-API ולא ב-Workers כי הוא צריך את אישורי קארדקום
 * ואת מפתח ההצפנה של הטוקן, ושניהם כבר כאן. אותו דפוס בדיוק כמו
 * `OutboxDispatcherService`.
 *
 * **בטיחות מפני חיוב כפול** אינה נשענת על כך שרק עותק אחד רץ:
 * החיוב נתפס בעדכון מותנה על `currentPeriodEnd`, ורק מי שהצליח
 * לשנות את השורה שולח בקשה לקארדקום.
 */

/** כל שעה. תקופה נמדדת בחודשים — דיוק גבוה יותר אינו קונה דבר. */
const TICK_MS = 60 * 60 * 1000;
/** כמה מנויים לחדש בכל סבב. תקרה, לא יעד. */
const BATCH = 25;
@Injectable()
export class RenewalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RenewalService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardcom: CardcomService,
    private readonly crypto: CryptoService,
    private readonly plans: PlanCatalogService,
    private readonly email: EmailService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // ‎unref‎ כדי שהטיימר לא יחזיק את התהליך בכיבוי מסודר
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return; // אין טיקים חופפים
    this.running = true;
    try {
      /*
       * התזכורות **לפני** החידושים, באותו סבב.
       *
       * הן מסתכלות על תקופות שטרם הסתיימו והחידוש על תקופות שכבר
       * הסתיימו, ולכן אין ביניהן חפיפה — הסדר הוא רק כדי שמנוי לא
       * יקבל תזכורת על תקופה שזה עתה חודשה.
       */
      await this.remindUpcoming();
      await this.renewDue();
    } catch (error) {
      this.logger.error(`סבב החידושים נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** מנויים שהגיע מועד חידושם — כל אחד בנפרד, כישלון אינו עוצר את השאר. */
  async renewDue(now = new Date()): Promise<{ renewed: number; failed: number }> {
    if (!(await this.cardcom.isConfigured())) return { renewed: 0, failed: 0 };

    const due = await this.prisma.subscription.findMany({
      where: {
        status: "active",
        // מבוטל אינו מתחדש — זו כל המשמעות של ביטול
        cardTokenEncrypted: { not: null },
        currentPeriodEnd: { not: null, lte: now },
      },
      orderBy: { currentPeriodEnd: "asc" },
      take: BATCH,
    });

    let renewed = 0;
    let failed = 0;
    for (const row of due) {
      try {
        const ok = await this.renewOne(row.tenantId, now);
        if (ok) renewed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`חידוש מנוי של ${row.tenantId} נכשל: ${String(error)}`);
      }
    }
    if (renewed > 0 || failed > 0) {
      this.logger.log(`סבב חידושים: ${renewed} חודשו, ${failed} נכשלו`);
    }
    return { renewed, failed };
  }

  /**
   * תזכורת לפני החיוב.
   *
   * החיוב האוטומטי עובר בשקט, והמשרד פוגש אותו לראשונה בדף האשראי.
   * זה גם החלון היחיד שבו אפשר **למנוע** כישלון במקום להודיע עליו:
   * כרטיס שתוקפו פג בעוד שבועיים נראה כאן בזמן שעוד אפשר להחליף
   * אותו.
   *
   * `renewalReminderFor` שומר את התקופה ולא דגל — הסורק רץ כל שעה,
   * ו"נשלח כן/לא" היה מייצר תזכורת בכל סבב עד החיוב. ההשוואה
   * לתקופה הנוכחית מאפסת את עצמה בכל חידוש.
   */
  async remindUpcoming(now = new Date()): Promise<number> {
    if (!(await this.email.isConfigured())) return 0;

    const horizon = new Date(now.getTime() + RENEWAL_WARN_WITHIN_DAYS * 24 * 60 * 60 * 1000);
    const upcoming = await this.prisma.subscription.findMany({
      where: {
        status: "active",
        cardTokenEncrypted: { not: null },
        currentPeriodEnd: { gt: now, lte: horizon },
      },
      orderBy: { currentPeriodEnd: "asc" },
      take: BATCH,
    });

    let sent = 0;
    for (const row of upcoming) {
      if (row.currentPeriodEnd === null) continue;
      /*
       * ההשוואה בזיכרון ולא ב-where: Postgres יודע להשוות שתי עמודות,
       * Prisma לא מבטא את זה ב-findMany. הסינון על החלון כבר צמצם
       * את התוצאה לשורות בודדות, ולכן זה זול.
       */
      if (row.renewalReminderFor?.getTime() === row.currentPeriodEnd.getTime()) continue;

      /*
       * תפיסה מותנית לפני השליחה, כמו בחיוב עצמו: שני עותקים של
       * ה-API שקוראים את אותה שורה — רק אחד ישלח מייל.
       */
      const claimed = await this.prisma.subscription.updateMany({
        where: {
          tenantId: row.tenantId,
          currentPeriodEnd: row.currentPeriodEnd,
          renewalReminderFor: row.renewalReminderFor,
        },
        data: { renewalReminderFor: row.currentPeriodEnd },
      });
      if (claimed.count === 0) continue;

      try {
        await this.sendReminder(row.tenantId, row, now);
        sent += 1;
      } catch (error) {
        /*
         * הסימון **אינו** מוחזר לאחור.
         *
         * כישלון בשליחת מייל הוא בדרך כלל כתובת פסולה או ספק שנפל,
         * ושניהם יחזרו על עצמם בכל סבב עד החיוב — כלומר ניסיון חוזר
         * כל שעה במשך שבעה ימים. התזכורת היא נוחות, לא תנאי לחיוב.
         */
        this.logger.warn(`תזכורת חידוש למשרד ${row.tenantId} נכשלה: ${String(error)}`);
      }
    }
    if (sent > 0) this.logger.log(`נשלחו ${sent} תזכורות לפני חיוב`);
    return sent;
  }

  private async sendReminder(
    tenantId: string,
    row: { planCode: string; billingCycle: string; currentPeriodEnd: Date | null },
    now: Date,
  ): Promise<void> {
    const payer = await this.payer(tenantId);
    if (!payer.email) return;

    const cycle: BillingCycle = isBillingCycle(row.billingCycle) ? row.billingCycle : "monthly";
    const plan = await this.plans.byCode(row.planCode);
    // התזכורת נוקבת בסכום, ולכן חייבת לדעת על המחיר המוסכם — אחרת
    // הלקוח מקבל מייל עם מחיר אחד ומחויב באחר
    const priceOverride = await this.plans.tenantPriceOverride(tenantId);
    const amountAgorot = plan ? effectiveCyclePriceAgorot(plan, cycle, priceOverride) : null;
    const days = periodDaysLeft(row.currentPeriodEnd, now) ?? 0;
    const when = row.currentPeriodEnd ? formatJerusalemDate(row.currentPeriodEnd) : "";
    const amount =
      amountAgorot !== null ? `${formatIsraeliNumber(Math.round(amountAgorot / 100))} ₪` : "";

    await this.email.send(payer.email, "המנוי מתחדש בקרוב", {
      heading: "תזכורת לפני חידוש",
      paragraphs: [
        `המנוי במסלול "${plan?.name ?? row.planCode}" מתחדש בעוד ${days} ימים, ב-${when}.`,
        amount !== ""
          ? `החיוב יבוצע אוטומטית בכרטיס השמור, בסך ${amount} (${describeCycle(cycle)}).`
          : "החיוב יבוצע אוטומטית בכרטיס השמור.",
        "אם הכרטיס הוחלף או שתוקפו עומד לפוג — זה הזמן לעדכן אותו, וכך החידוש יעבור חלק.",
      ],
      button: { label: "למסך המנוי", url: `${loadEnv().WEB_ORIGIN}/settings/billing` },
      footnote: "אין צורך לעשות דבר אם הכל תקין — ההודעה נשלחת פעם אחת לפני כל חידוש.",
    });
  }

  private async renewOne(tenantId: string, now: Date): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription?.cardTokenEncrypted) return false;
    if (subscription.cardMonth === null || subscription.cardYear === null) {
      this.logger.warn(`אין תוקף כרטיס שמור למשרד ${tenantId} — חידוש אוטומטי אינו אפשרי`);
      return false;
    }

    const cycle: BillingCycle = isBillingCycle(subscription.billingCycle)
      ? subscription.billingCycle
      : "monthly";
    const plan = await this.plans.byCode(subscription.planCode);
    const priceOverride = await this.plans.tenantPriceOverride(tenantId);
    const amountAgorot = plan ? effectiveCyclePriceAgorot(plan, cycle, priceOverride) : null;
    if (plan === undefined || amountAgorot === null || amountAgorot <= 0) {
      this.logger.warn(`מסלול ${subscription.planCode} אינו ניתן לחיוב — חידוש מדולג`);
      return false;
    }

    const anchorDay = subscription.billingAnchorDay ?? billingAnchorDay(now);
    const periodEnd = nextPeriodEnd(subscription.currentPeriodEnd, now, cycle, anchorDay);

    /*
     * תפיסת החידוש **לפני** הפנייה לקארדקום, מותנית בתקופה שקראנו.
     * זה מה שמונע חיוב כפול בלי להסתמך על כך שרק עותק אחד של ה-API
     * רץ: שני תהליכים שקוראים את אותה שורה — רק אחד יצליח לשנות
     * אותה, והשני יוצא בלי לשלוח כלום.
     */
    const claimed = await this.prisma.subscription.updateMany({
      where: { tenantId, currentPeriodEnd: subscription.currentPeriodEnd, status: "active" },
      data: { currentPeriodEnd: periodEnd },
    });
    if (claimed.count === 0) return false;

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId,
        planCode: subscription.planCode,
        billingCycle: cycle,
        amountAgorot,
        status: "pending",
        // אין דף תשלום בחידוש; המזהה של השורה משמש גם כמפתח הייחודי
        lowProfileId: paymentId,
      },
    });

    const payer = await this.payer(tenantId);
    const result = await this.cardcom.chargeToken({
      token: this.crypto.decrypt(subscription.cardTokenEncrypted),
      amountAgorot,
      cardMonth: subscription.cardMonth,
      cardYear: subscription.cardYear,
      cardOwnerIdentity: subscription.cardOwnerIdEncrypted
        ? this.crypto.decrypt(subscription.cardOwnerIdEncrypted)
        : null,
      productName: `${plan.name} — חידוש מנוי ${describeCycle(cycle)}`,
      payer,
    });

    if (!result.paid) {
      /*
       * החזרת התקופה לקדמותה: התפיסה הייתה אופטימית, והחיוב לא עבר.
       * בלי ההחזרה המשרד היה מקבל חודש חינם על חיוב שנכשל.
       *
       * `paid_until` על שורת הדייר **אינו נגוע** — הוא נשאר בתאריך
       * הישן, וכך ההרשאה נסגרת מעצמה בתום חלון החסד.
       */
      await this.prisma.subscription.updateMany({
        where: { tenantId, currentPeriodEnd: periodEnd },
        data: { currentPeriodEnd: subscription.currentPeriodEnd },
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: "failed", failureReason: result.message.slice(0, 300) || "החיוב נדחה" },
      });
      await this.notifyFailure(tenantId, payer, plan.name);
      this.logger.warn(`חידוש נדחה למשרד ${tenantId}: ${result.message}`);
      return false;
    }

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: "paid",
          paidAt: now,
          transactionId: result.transactionId,
          documentType: result.documentType,
          documentNumber: result.documentNumber,
        },
      }),
      this.prisma.tenant.update({
        where: { id: tenantId },
        // חלון החסד נכנס ל-paid_until ולא לתקופה עצמה: התקופה
        // הבאה נמדדת מהמועד האמיתי, וחלון החסד לא נצבר משנה לשנה
        data: { paidUntil: accessUntil(periodEnd) },
      }),
    ]);

    this.logger.log(`מנוי חודש אוטומטית: ${tenantId} עד ${periodEnd.toISOString()}`);
    return true;
  }

  private async payer(tenantId: string): Promise<{ name: string; email: string; phone?: string }> {
    const [tenant, owner] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.user.findFirst({
        where: { tenantId, role: "owner", isActive: true },
        select: { email: true, phone: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      name: tenant?.name ?? "לקוח",
      email: owner?.email ?? "",
      phone: owner?.phone ?? "",
    };
  }

  /**
   * הודעה על חיוב שנכשל.
   *
   * נשלחת מיד ולא בסוף חלון החסד: מי שכרטיסו פג צריך את הימים
   * שנשארו כדי לעדכן אותו, ולא הודעה ביום שבו הוא כבר נעול בחוץ.
   */
  private async notifyFailure(tenantId: string, payer: { email: string }, planName: string): Promise<void> {
    if (!payer.email || !(await this.email.isConfigured())) return;
    try {
      await this.email.send(payer.email, "חידוש המנוי לא הושלם", {
        heading: "החיוב לא עבר",
        paragraphs: [
          `החיוב עבור מסלול "${planName}" נדחה. הסיבה הנפוצה היא כרטיס שתוקפו פג.`,
          `השירות ממשיך לפעול עוד ${BILLING_GRACE_DAYS} ימים, ואפשר לעדכן אמצעי תשלום עכשיו.`,
        ],
        button: { label: "למסך המנוי", url: `${loadEnv().WEB_ORIGIN}/settings/billing` },
        footnote: "לא בוצע חיוב. אם עדכנתם כבר אמצעי תשלום — אפשר להתעלם מהודעה זו.",
      });
    } catch (error) {
      this.logger.warn(`שליחת הודעה על חידוש שנכשל נכשלה (${tenantId}): ${String(error)}`);
    }
  }
}
