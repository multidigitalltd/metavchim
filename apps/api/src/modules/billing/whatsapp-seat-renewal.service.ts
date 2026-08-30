import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ulid } from "ulid";
import { billingAnchorDay, nextPeriodEnd } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CardcomService } from "../../core/cardcom.service";
import { CryptoService } from "../../core/crypto.service";
import { EmailService } from "../../core/email.service";
import { PrismaService } from "../../core/prisma.service";
import { VatService } from "../../core/vat.service";
import { InvoiceService } from "./invoice.service";
import { WhatsappSeatService } from "./whatsapp-seat.service";

/**
 * הסורק החודשי של המקומות הנוספים לסוכן — חיוב, וסגירה.
 *
 * אותו דפוס בדיוק כמו סורק השכרות המספרים, ומאותן סיבות: החיוב
 * בטוקן השמור הוא קריאה סינכרונית, התפיסה נעשית בעדכון מותנה על
 * ‎`currentPeriodEnd` **לפני** הפנייה לסולק (שני עותקי API לא יחייבו
 * פעמיים), וכישלון מחזיר את התקופה לקדמותה.
 *
 * ## מה שונה כאן: הסגירה מנתקת מישהו
 *
 * שחרור מספר טלפון הוא נזק בלתי הפיך, ולכן שם ההכרעה נשארת אנושית.
 * מקום לסוכן הוא הפיך לחלוטין — הוא נפתח מחדש ברגע שמשלמים. לכן
 * מקום **שבוטל** ותקופתו נגמרה נסגר אוטומטית, והמכסה יורדת.
 *
 * וכשהמכסה יורדת מתחת למספר המחזיקים, מישהו חייב לרדת איתה: הזכאות
 * בזמן ריצה קוראת את הדגל של המשתמש, לא את המכסה, ולכן בלי הניתוק
 * המשרד היה ממשיך לעבוד מעל מה ששילם ללא הגבלת זמן. הכלל
 * דטרמיניסטי ובעל המשרד לעולם אינו הקורבן — ראו `revokeOverQuota`.
 *
 * ‎**חיוב שנכשל אינו סוגר את המקום.** ניתוק סוכן באמצע יום עבודה
 * על סירוב חד-פעמי או כרטיס שפג הוא תגובה חריפה מדי לתקלה שנפתרת
 * בניסיון הבא; המקום עובר ל-`past_due`, ממשיך לתפוס מכסה, והמשרד
 * מקבל מייל.
 */

/** כל שעה, כמו שאר הסורקים — תקופה נמדדת בחודשים. */
const TICK_MS = 60 * 60 * 1000;
const BATCH = 25;

@Injectable()
export class WhatsappSeatRenewalService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappSeatRenewalService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
    private readonly cardcom: CardcomService,
    private readonly crypto: CryptoService,
    private readonly email: EmailService,
    private readonly seats: WhatsappSeatService,
    private readonly vat: VatService,
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
    } catch (error) {
      this.logger.error(`סבב מקומות הוואטסאפ נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** מקומות פעילים שתקופתם נגמרה — חיוב חודש נוסף בכרטיס השמור. */
  async renewDue(now = new Date()): Promise<{ renewed: number; failed: number }> {
    if (!(await this.cardcom.isConfigured())) return { renewed: 0, failed: 0 };

    const due = await this.prisma.whatsappSeat.findMany({
      where: { status: "active", currentPeriodEnd: { not: null, lte: now } },
      orderBy: { currentPeriodEnd: "asc" },
      take: BATCH,
    });

    let renewed = 0;
    let failed = 0;
    for (const seat of due) {
      try {
        if (await this.renewOne(seat.id, now)) renewed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`חידוש מקום ${seat.id} נכשל: ${String(error)}`);
      }
    }
    if (renewed > 0 || failed > 0) {
      this.logger.log(`סבב מקומות וואטסאפ: ${renewed} חודשו, ${failed} נכשלו`);
    }
    return { renewed, failed };
  }

  private async renewOne(seatId: string, now: Date): Promise<boolean> {
    const seat = await this.prisma.whatsappSeat.findUnique({ where: { id: seatId } });
    if (seat === null || seat.status !== "active") return false;

    /*
     * הכרטיס השמור יושב על שורת המנוי — אמצעי תשלום אחד למשרד, לא
     * אחד לכל שירות. בלעדיו אין את מי לחייב.
     */
    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId: seat.tenantId },
    });
    if (
      subscription?.cardTokenEncrypted === null ||
      subscription?.cardTokenEncrypted === undefined ||
      subscription.cardMonth === null ||
      subscription.cardYear === null
    ) {
      await this.markPastDue(seat.id, seat.tenantId, "אין כרטיס שמור לחיוב");
      return false;
    }

    const anchorDay = seat.billingAnchorDay ?? billingAnchorDay(now);
    const periodEnd = nextPeriodEnd(seat.currentPeriodEnd, now, "monthly", anchorDay);

    // תפיסה מותנית לפני הפנייה לסולק — בדיוק כמו בחידוש המנוי
    const claimed = await this.prisma.whatsappSeat.updateMany({
      where: { id: seat.id, currentPeriodEnd: seat.currentPeriodEnd, status: "active" },
      data: { currentPeriodEnd: periodEnd },
    });
    if (claimed.count === 0) return false;

    /*
     * מכאן ועד סימון התשלום השורה מחזיקה תקופה שטרם שולמה. חריגה
     * באמצע בלי טיפול הייתה משאירה אותה כך לצמיתות — הסבב הבא מדלג
     * כי התקופה „בעתיד”, והמשרד קיבל חודש חינם. לכן הכול עטוף:
     * חריגה מחזירה את התקופה ועוצרת ניסיונות חוזרים (`past_due` ולא
     * `active`, כי אולי החיוב דווקא נקלט אצל הסולק).
     */
    const paymentId = ulid();
    try {
      // המחיר על השורה הוא נטו, כמו בחיוב הראשון — אותו סכום בדיוק
      const { amountAgorot, vatPercent } = await this.vat.charge(seat.monthlyAgorot);
      await this.prisma.payment.create({
        data: {
          id: paymentId,
          tenantId: seat.tenantId,
          purpose: "whatsapp_seat",
          seatId: seat.id,
          amountAgorot,
          vatPercent,
          status: "pending",
          lowProfileId: paymentId,
        },
      });

      const result = await this.cardcom.chargeToken({
        token: this.crypto.decrypt(subscription.cardTokenEncrypted),
        amountAgorot,
        cardMonth: subscription.cardMonth,
        cardYear: subscription.cardYear,
        cardOwnerIdentity: subscription.cardOwnerIdEncrypted
          ? this.crypto.decrypt(subscription.cardOwnerIdEncrypted)
          : null,
        productName: "מקום נוסף לסוכן הוואטסאפ — חידוש חודשי",
        payer: await this.payer(seat.tenantId),
      });

      if (!result.paid) {
        // החזרת התקופה לקדמותה — התפיסה הייתה אופטימית והחיוב לא עבר
        await this.prisma.whatsappSeat.updateMany({
          where: { id: seat.id, currentPeriodEnd: periodEnd },
          data: { currentPeriodEnd: seat.currentPeriodEnd },
        });
        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { status: "failed", failureReason: result.message.slice(0, 300) || "החיוב נדחה" },
        });
        await this.markPastDue(seat.id, seat.tenantId, result.message);
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
      await this.invoices.queueForPayment(paymentId);
      this.logger.log(
        `מקום וואטסאפ חודש: ${seat.id} של ${seat.tenantId} עד ${periodEnd.toISOString()}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`חידוש מקום ${seat.id} קרס באמצע: ${String(error)}`);
      await this.prisma.whatsappSeat.updateMany({
        where: { id: seat.id, currentPeriodEnd: periodEnd },
        data: { currentPeriodEnd: seat.currentPeriodEnd },
      });
      // updateMany — ייתכן שהחריגה קדמה ליצירת שורת התשלום
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: "pending" },
        data: {
          status: "failed",
          failureReason: `תקלה טכנית בחידוש: ${String(error)}`.slice(0, 300),
        },
      });
      await this.markPastDue(
        seat.id,
        seat.tenantId,
        "תקלה טכנית באמצע החיוב — ייתכן שהחיוב כן נקלט אצל קארדקום; יש לבדוק שם לפני גבייה חוזרת",
      );
      return false;
    }
  }

  /**
   * חיוב שנכשל — `past_due`, מייל למשרד, **ובלי ניתוק**.
   *
   * המקום ממשיך לתפוס מכסה: ניתוק סוכן באמצע יום עבודה על סירוב
   * שנפתר בניסיון הבא הוא תגובה חריפה מדי, והכסף ממילא ייגבה.
   */
  private async markPastDue(seatId: string, tenantId: string, reason: string): Promise<void> {
    await this.prisma.whatsappSeat.update({
      where: { id: seatId },
      data: { status: "past_due" },
    });
    const payer = await this.payer(tenantId);
    if (payer.email) {
      try {
        await this.email.send(payer.email, "חיוב המקום הנוסף לסוכן הוואטסאפ נכשל", {
          heading: "החיוב החודשי לא עבר",
          paragraphs: [
            "החיוב החודשי עבור מקום נוסף לסוכן הוואטסאפ נדחה. הסיבה הנפוצה היא כרטיס שתוקפו פג.",
            "המקום ממשיך לפעול בינתיים; עדכנו אמצעי תשלום במסך המנוי כדי שהחיוב הבא יעבור.",
          ],
          button: { label: "למסך המנוי", url: `${loadEnv().WEB_ORIGIN}/settings/billing` },
        });
      } catch (error) {
        this.logger.warn(`מייל כישלון חיוב מקום למשרד ${tenantId} נכשל: ${String(error)}`);
      }
    }
    this.logger.warn(`מקום ${seatId} של ${tenantId} עבר ל-past_due: ${reason.slice(0, 120)}`);
  }

  /**
   * מקומות שבוטלו ותקופתם ששולמה נגמרה — סגירה, וירידת מכסה.
   *
   * ההשהיה עד סוף התקופה אינה נדיבות: המשרד שילם על החודש הזה
   * במלואו (חלק מחודש מחויב כחודש), והמקום שלו עד סופו.
   */
  async releaseDue(now = new Date()): Promise<number> {
    const due = await this.prisma.whatsappSeat.findMany({
      where: {
        status: "cancelled",
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { lte: now } }],
      },
      take: BATCH,
    });

    let released = 0;
    for (const seat of due) {
      try {
        /*
         * הסגירה מותנית בסטטוס: תשלום שנתפס בין השליפה לכאן החזיר
         * את המקום ל-`active`, וסגירה שלו הייתה מוחקת חודש ששולם.
         */
        const closed = await this.prisma.whatsappSeat.updateMany({
          where: { id: seat.id, status: "cancelled" },
          data: { status: "released", releasedAt: now },
        });
        if (closed.count === 0) continue;
        released += 1;

        /*
         * ‎**המכסה ירדה — ומישהו חייב לרדת איתה.** בלי זה המחזיקים
         * ממשיכים לעבוד מעל מה ששולם, כי הזכאות קוראת את הדגל ולא
         * את המכסה.
         */
        const revoked = await this.seats.revokeOverQuota(seat.tenantId);
        if (revoked > 0) await this.notifyRevoked(seat.tenantId, revoked);
      } catch (error) {
        this.logger.error(`סגירת מקום ${seat.id} נכשלה: ${String(error)}`);
      }
    }
    if (released > 0) this.logger.log(`סבב מקומות וואטסאפ: ${released} נסגרו`);
    return released;
  }

  /**
   * ‎**הניתוק נאמר, ואינו מתגלה.**
   *
   * סוכן שהפסיק לקבל תשובות בוואטסאפ בלי הודעה מדווח על תקלה, ובעל
   * המשרד מחפש אותה — במקום לדעת שהמקום פשוט הסתיים ולהחליט למי
   * להקצות את מה שנשאר.
   */
  private async notifyRevoked(tenantId: string, count: number): Promise<void> {
    const payer = await this.payer(tenantId);
    if (!payer.email) return;
    try {
      await this.email.send(payer.email, "מקום לסוכן הוואטסאפ הסתיים", {
        heading: "ההקצאה עודכנה",
        paragraphs: [
          `מקום נוסף לסוכן הוואטסאפ הסתיים, ולכן ${count === 1 ? "הקצאה אחת בוטלה" : `${count} הקצאות בוטלו`} אוטומטית — לפי סדר ההצטרפות, מהאחרון.`,
          "אפשר להקצות מחדש את המקומות שנותרו במסך ניהול משרד ← סוכני המשרד, או לרכוש מקום נוסף.",
        ],
        button: { label: "לניהול הצוות", url: `${loadEnv().WEB_ORIGIN}/settings` },
      });
    } catch (error) {
      this.logger.warn(`מייל ביטול הקצאה למשרד ${tenantId} נכשל: ${String(error)}`);
    }
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
