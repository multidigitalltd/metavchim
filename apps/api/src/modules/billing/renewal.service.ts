import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BILLING_GRACE_DAYS,
  accessUntil,
  billingAnchorDay,
  cyclePriceAgorot,
  describeCycle,
  isBillingCycle,
  nextPeriodEnd,
  type BillingCycle,
} from "@metavchim/shared";
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
    const amountAgorot = plan ? cyclePriceAgorot(plan, cycle) : null;
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
