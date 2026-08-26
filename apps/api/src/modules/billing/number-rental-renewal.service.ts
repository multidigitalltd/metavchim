import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import { billingAnchorDay, formatRentalNumber, nextPeriodEnd } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CardcomService } from "../../core/cardcom.service";
import { CryptoService } from "../../core/crypto.service";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";
import { NumberRentalService } from "./number-rental.service";

/**
 * הסורק החודשי של השכרות המספרים — חיוב, ושחרור.
 *
 * אותו דפוס בדיוק כמו `RenewalService` של המנוי, ומאותן סיבות:
 * החיוב בטוקן השמור הוא קריאה סינכרונית, התפיסה נעשית בעדכון מותנה
 * על `currentPeriodEnd` **לפני** הפנייה לסולק (שני עותקי API לא
 * יחייבו פעמיים), וכישלון מחזיר את התקופה לקדמותה.
 *
 * **חיוב שנכשל אינו משחרר את המספר.** מספר טלפון שאבד הוא נזק שאין
 * ממנו חזרה, ולכן ההשכרה עוברת ל-`past_due`, המשרד והמנהלים מקבלים
 * מייל, וההכרעה — לגבות ידנית או לשחרר — נשארת אנושית. שחרור
 * אוטומטי קורה רק להשכרה **שבוטלה** ותקופתה ששולמה נגמרה.
 */

/** כל שעה, כמו סורק המנויים — תקופה נמדדת בחודשים. */
const TICK_MS = 60 * 60 * 1000;
const BATCH = 25;

@Injectable()
export class NumberRentalRenewalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NumberRentalRenewalService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardcom: CardcomService,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly rentals: NumberRentalService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.renewDue();
      await this.releaseDue();
      await this.purgeStalePending();
    } catch (error) {
      this.logger.error(`סבב השכרות נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** השכרות פעילות שתקופתן נגמרה — חיוב חודש נוסף בכרטיס השמור. */
  async renewDue(now = new Date()): Promise<{ renewed: number; failed: number }> {
    if (!(await this.cardcom.isConfigured())) return { renewed: 0, failed: 0 };

    const due = await this.prisma.rentedNumber.findMany({
      where: { status: "active", currentPeriodEnd: { not: null, lte: now } },
      orderBy: { currentPeriodEnd: "asc" },
      take: BATCH,
    });

    let renewed = 0;
    let failed = 0;
    for (const rental of due) {
      try {
        if (await this.renewOne(rental.id, now)) renewed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`חידוש השכרה ${rental.id} נכשל: ${String(error)}`);
      }
    }
    if (renewed > 0 || failed > 0) {
      this.logger.log(`סבב השכרות: ${renewed} חודשו, ${failed} נכשלו`);
    }
    return { renewed, failed };
  }

  private async renewOne(rentalId: string, now: Date): Promise<boolean> {
    const rental = await this.prisma.rentedNumber.findUnique({ where: { id: rentalId } });
    if (rental === null || rental.status !== "active") return false;

    /*
     * הכרטיס השמור של המשרד יושב על שורת המנוי — אמצעי תשלום אחד
     * למשרד, לא אחד לכל שירות. בלעדיו אין את מי לחייב: ההשכרה
     * עוברת לטיפול ידני, לא נמחקת.
     */
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: rental.tenantId },
    });
    if (
      subscription?.cardTokenEncrypted === null ||
      subscription?.cardTokenEncrypted === undefined ||
      subscription.cardMonth === null ||
      subscription.cardYear === null
    ) {
      await this.markPastDue(rental.id, rental.tenantId, rental.number, "אין כרטיס שמור לחיוב");
      return false;
    }

    const anchorDay = rental.billingAnchorDay ?? billingAnchorDay(now);
    const periodEnd = nextPeriodEnd(rental.currentPeriodEnd, now, "monthly", anchorDay);

    // תפיסה מותנית לפני הפנייה לסולק — בדיוק כמו בחידוש המנוי
    const claimed = await this.prisma.rentedNumber.updateMany({
      where: { id: rental.id, currentPeriodEnd: rental.currentPeriodEnd, status: "active" },
      data: { currentPeriodEnd: periodEnd },
    });
    if (claimed.count === 0) return false;

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: rental.tenantId,
        purpose: "number_rental",
        rentalId: rental.id,
        amountAgorot: rental.monthlyAgorot,
        status: "pending",
        lowProfileId: paymentId,
      },
    });

    const payer = await this.payer(rental.tenantId);
    const result = await this.cardcom.chargeToken({
      token: this.crypto.decrypt(subscription.cardTokenEncrypted),
      amountAgorot: rental.monthlyAgorot,
      cardMonth: subscription.cardMonth,
      cardYear: subscription.cardYear,
      cardOwnerIdentity: subscription.cardOwnerIdEncrypted
        ? this.crypto.decrypt(subscription.cardOwnerIdEncrypted)
        : null,
      productName: `השכרת מספר וירטואלי ${formatRentalNumber(rental.number)} — חידוש חודשי`,
      payer,
    });

    if (!result.paid) {
      // החזרת התקופה לקדמותה — התפיסה הייתה אופטימית והחיוב לא עבר
      await this.prisma.rentedNumber.updateMany({
        where: { id: rental.id, currentPeriodEnd: periodEnd },
        data: { currentPeriodEnd: rental.currentPeriodEnd },
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: "failed", failureReason: result.message.slice(0, 300) || "החיוב נדחה" },
      });
      await this.markPastDue(rental.id, rental.tenantId, rental.number, result.message);
      return false;
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: "paid",
        paidAt: now,
        transactionId: result.transactionId,
        documentType: result.documentType,
        documentNumber: result.documentNumber,
      },
    });
    this.logger.log(
      `השכרת מספר חודשה: ${rental.number} של ${rental.tenantId} עד ${periodEnd.toISOString()}`,
    );
    return true;
  }

  /**
   * חיוב שנכשל — `past_due`, מייל למשרד ולמנהלים, **ובלי שחרור**:
   * מספר טלפון שאבד הוא נזק בלתי הפיך, וההכרעה נשארת אנושית.
   */
  private async markPastDue(
    rentalId: string,
    tenantId: string,
    number: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.rentedNumber.update({
      where: { id: rentalId },
      data: { status: "past_due", providerError: `החיוב החודשי נכשל: ${reason}`.slice(0, 300) },
    });
    const payer = await this.payer(tenantId);
    if (payer.email) {
      try {
        await this.email.send(payer.email, "חיוב השכרת המספר הווירטואלי נכשל", {
          heading: "החיוב החודשי לא עבר",
          paragraphs: [
            `החיוב החודשי עבור המספר ${formatRentalNumber(number)} נדחה. הסיבה הנפוצה היא כרטיס שתוקפו פג.`,
            "המספר ממשיך לפעול בינתיים; עדכנו אמצעי תשלום במסך המנוי כדי שהחיוב הבא יעבור.",
          ],
          button: { label: "למסך המנוי", url: `${loadEnv().WEB_ORIGIN}/settings/billing` },
        });
      } catch (error) {
        this.logger.warn(`מייל כישלון חיוב למשרד ${tenantId} נכשל: ${String(error)}`);
      }
    }
    await this.rentals.notifyAdmins(
      "חיוב חודשי של מספר שכור נכשל — נדרשת החלטה",
      `החיוב החודשי של המספר ${formatRentalNumber(number)} נכשל (${reason.slice(0, 120)}). המספר לא שוחרר — יש לגבות ידנית או להחליט על שחרור.`,
    );
  }

  /**
   * השכרות שבוטלו ותקופתן ששולמה נגמרה — שחרור המספר אצל 015.
   *
   * ההשהיה עד סוף התקופה אינה נדיבות: המשרד שילם על החודש הזה
   * במלואו (חלק מחודש מחויב כחודש), והמספר שלו עד סופו.
   */
  async releaseDue(now = new Date()): Promise<number> {
    const due = await this.prisma.rentedNumber.findMany({
      where: {
        status: "cancelled",
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { lte: now } }],
      },
      take: BATCH,
    });

    let released = 0;
    for (const rental of due) {
      try {
        /*
         * הליבה המשותפת עם השחרור הידני של מנהל הפלטפורמה — כישלון
         * שחרור משאיר את השורה כמות שהיא עם השגיאה כתובה עליה,
         * והסבב הבא ינסה שוב.
         */
        const result = await this.rentals.releaseNow(rental.id);
        if (!result.ok) continue;
        await this.rentals.notifyAdmins(
          "מספר שכור שוחרר",
          `השכרת המספר ${formatRentalNumber(rental.number)} הסתיימה והמספר שוחרר מחשבון 015 של הפלטפורמה. ודאו שאין ניתוב ידני שנשאר מאחור.`,
        );
        released += 1;
      } catch (error) {
        this.logger.error(`שחרור השכרה ${rental.id} נכשל: ${String(error)}`);
      }
    }
    if (released > 0) this.logger.log(`שוחררו ${released} מספרים שכורים`);
    return released;
  }

  /**
   * שורות שממתינות לתשלום שלא הגיע — דף תשלום שנפתח וננטש. אחרי
   * שלושה ימים אין תשלום בדרך (דף קארדקום פג הרבה קודם), והשורה
   * רק מסתירה את המספר מהמלאי.
   */
  async purgeStalePending(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await this.prisma.rentedNumber.deleteMany({
      where: { status: "pending", createdAt: { lt: cutoff } },
    });
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
}
