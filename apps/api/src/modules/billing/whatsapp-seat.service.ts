import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  billingAnchorDay,
  formatJerusalemDate,
  nextPeriodEnd,
  whatsappAgentSeats,
  whatsappSeatOffer,
  type WhatsappSeatOffer,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CardcomService } from "../../core/cardcom.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService } from "../../core/prisma.service";
import { whatsappSeatQuotaWhere } from "../../core/whatsapp-seat-quota";
import { VatService } from "../../core/vat.service";

/**
 * מקום נוסף לסוכן הוואטסאפ — **מנוי חודשי, לא רכישה לצמיתות.**
 *
 * מקום אחד כלול בכל מסלול שכולל את הסוכן; כל נוסף נרכש כאן ומחויב
 * מדי חודש בכרטיס השמור. אותו דפוס בדיוק כמו השכרת המספרים, ומאותן
 * סיבות: תשלום חודש מראש, הפעלה בוובהוק **בתוך הטרנזקציה שתפסה את
 * התשלום** (וכך אידמפוטנטית), ועוגן יום לחיוב.
 *
 * ## למה שורה למקום, ולא מונה על המשרד
 *
 * המונה `whatsappAgentSeatsExtra` נשאר — הוא מה שבעל הפלטפורמה
 * **מעניק** ידנית (עסקה, פיילוט, פיצוי). המקומות שנרכשו הם שורות,
 * כי ביטול של מקום בודד, תאריך סיום שונה לכל אחד, וחשבונית לכל
 * חיוב — כולם דורשים שורה. השניים נספרים יחד ואינם מחליפים זה את
 * זה: הענקה שהייתה נבלעת ברגע שהמשרד קונה היא בדיוק הבאג שגורם לו
 * לשלם על מה שכבר קיבל.
 *
 * ## המחיר מגיע מהמסלול, ולעולם לא מהדפדפן
 *
 * ‎`whatsappSeatMonthlyAgorot` יושב על המסלול: מסלול בסיסי יכול
 * בכוונה לא למכור מקומות נוספים (`null` = „פנו אלינו”), וגבוה יכול
 * למכור בזול. הסכום נצרב על השורה ברגע הרכישה — שינוי מחיר חל על
 * רכישות חדשות בלבד, ומשרד שקנה במחיר ישן ממשיך בו.
 */

export interface SeatRow {
  id: string;
  monthlyAgorot: number;
  status: string;
  statusLabel: string;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתין לתשלום",
  active: "פעיל",
  past_due: "החיוב נכשל",
  cancelled: "בוטל — פעיל עד תום התקופה",
  released: "הסתיים",
};

@Injectable()
export class WhatsappSeatService {
  private readonly logger = new Logger(WhatsappSeatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cardcom: CardcomService,
    private readonly plans: PlanCatalogService,
    private readonly vat: VatService,
  ) {}

  /** המצב במסך: כמה מקומות יש, כמה תפוסים, ומה אפשר לקנות. */
  async offering(tenantId: string): Promise<{
    seats: number;
    used: number;
    offer: WhatsappSeatOffer;
    checkoutAvailable: boolean;
    rows: SeatRow[];
  }> {
    const [plan, granted, paid, used, rows] = await Promise.all([
      this.plans.forTenant(tenantId),
      this.prisma.tenant
        .findUnique({ where: { id: tenantId }, select: { whatsappAgentSeatsExtra: true } })
        .then((t) => t?.whatsappAgentSeatsExtra ?? 0),
      this.paidCount(tenantId),
      this.prisma.withTenant((tx) =>
        tx.user.count({ where: { tenantId, isActive: true, whatsappAccess: true } }),
      ),
      this.prisma.whatsappSeat.findMany({
        where: { tenantId, status: { not: "released" } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      seats: whatsappAgentSeats({
        planHasAgent: await this.plans.tenantHasFeature(tenantId, "voice_intake"),
        granted,
        paid,
      }),
      used,
      offer: whatsappSeatOffer(plan?.whatsappSeatMonthlyAgorot ?? null),
      checkoutAvailable: await this.cardcom.isConfigured(),
      rows: rows.map((row) => ({
        id: row.id,
        monthlyAgorot: row.monthlyAgorot,
        status: row.status,
        statusLabel: STATUS_LABEL[row.status] ?? row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelledAt: row.cancelledAt,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * פתיחת דף תשלום למקום אחד — חודש ראשון מראש.
   *
   * ‎**המסלול נבדק כאן ולא רק במסך.** מסלול שאינו כולל את הסוכן כלל
   * אינו יכול לקנות לו מקום נוסף: זו לא הגבלה טכנית אלא המוצר —
   * „מקום **נוסף**” מניח שיש ראשון.
   */
  async startCheckout(input: {
    tenantId: string;
    userId: string;
  }): Promise<{ url: string; paymentId: string }> {
    if (!(await this.plans.tenantHasFeature(input.tenantId, "voice_intake"))) {
      throw new BadRequestException("הסוכן החכם אינו כלול במסלול של המשרד.");
    }
    const plan = await this.plans.forTenant(input.tenantId);
    const offer = whatsappSeatOffer(plan?.whatsappSeatMonthlyAgorot ?? null);
    if (offer.kind !== "purchase") {
      throw new BadRequestException(
        "המסלול הנוכחי אינו כולל מקומות נוספים לרכישה — פנו אלינו ונתאים.",
      );
    }
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }

    /*
     * שורה ממתינה נוצרת פעם אחת גם אם דף התשלום נפתח שוב: מי שנטש
     * דף וחזר אינו אמור להשאיר שובל שורות ממתינות שתופסות מכסה
     * מדומה. שורה ממתינה **אינה** נספרת במכסה עד שתשולם.
     */
    const existing = await this.prisma.whatsappSeat.findFirst({
      where: { tenantId: input.tenantId, status: "pending" },
      select: { id: true },
    });
    const seatId = existing?.id ?? ulid();
    if (existing === null) {
      await this.prisma.whatsappSeat.create({
        data: {
          id: seatId,
          tenantId: input.tenantId,
          monthlyAgorot: offer.monthlyAgorot,
          status: "pending",
          createdBy: input.userId,
        },
      });
    } else {
      /*
       * ‎**המחיר על שורה ממתינה שנעשה בה שימוש חוזר מתרענן.**
       *
       * דף שננטש יכול להיפתח שוב אחרי שהמשרד שינה מסלול או אחרי
       * שהמחיר במסלול השתנה. בלי העדכון החיוב הראשון נגבה במחיר
       * הנוכחי (הוא נגזר מ-`offer`) בעוד **כל החידושים** נגבים
       * מהמחיר הישן שנשמר על השורה — כלומר סכום חודשי שונה מזה
       * שהוצג, בשקט, לנצח (ביקורת Codex).
       */
      await this.prisma.whatsappSeat.update({
        where: { id: seatId },
        data: { monthlyAgorot: offer.monthlyAgorot },
      });
    }

    /*
     * דף תשלום קודם על אותו מקום מוחלף ולא מוכפל: בלי זה חזרה לדף
     * פעמיים משאירה שני דפים חיים אצל קארדקום, ותשלום בשניהם מאריך
     * את אותו מקום חודשיים. `superseded` ולא `failed` — הדף הישן
     * עדיין ניתן לחיוב אצל הסולק, ואם ישולם, `apply` רשאי לתפוס אותו.
     */
    await this.prisma.payment.updateMany({
      where: { seatId, status: "pending" },
      data: { status: "superseded", failureReason: "נפתח דף תשלום חדש במקומו" },
    });

    /*
     * המחיר במסלול נקוב **נטו**, וכך הוא מוצג. הסכום שנשלח לסולק
     * הוא מה שבאמת יירד מהכרטיס, ולכן המע"מ נוסף כאן.
     */
    const { amountAgorot, vatPercent } = await this.vat.charge(offer.monthlyAgorot);

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: input.tenantId,
        purpose: "whatsapp_seat",
        seatId,
        amountAgorot,
        vatPercent,
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
        productName: "מקום נוסף לסוכן הוואטסאפ — חודש",
        successUrl: `${origin}/settings/billing/return?payment=${paymentId}`,
        failureUrl: `${origin}/settings/billing/return?payment=${paymentId}&failed=1`,
        webhookUrl: `${origin}/api/v1/webhooks/cardcom`,
        // טוקן נשמר — החיוב החודשי המתחדש רץ בכרטיס הזה
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
   * ביטול חידוש — המקום נשאר עד סוף התקופה ששולמה, בלי החזר יחסי.
   *
   * השחרור בפועל (וירידת המכסה) קורה בסורק, כשהתקופה נגמרת. מקום
   * שממתין לתשלום נסגר מיד — אבל **נסגר ולא נמחק**: אם דף התשלום
   * שנשאר פתוח ישולם בכל זאת, התשלום ייתפס מול שורה קיימת ולא
   * ייעלם בשקט.
   */
  async cancel(tenantId: string, seatId: string): Promise<void> {
    const seat = await this.prisma.whatsappSeat.findFirst({ where: { id: seatId, tenantId } });
    if (seat === null) throw new BadRequestException("המקום לא נמצא");
    if (seat.status === "pending") {
      await this.prisma.whatsappSeat.update({
        where: { id: seatId },
        data: { status: "released", cancelledAt: new Date(), releasedAt: new Date() },
      });
      return;
    }
    if (seat.status !== "active" && seat.status !== "past_due") {
      throw new BadRequestException("המקום כבר בוטל");
    }
    await this.prisma.whatsappSeat.update({
      where: { id: seatId },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
  }

  /**
   * הפעלת המקום — **בתוך הטרנזקציה שתפסה את התשלום**, ולכן
   * אידמפוטנטית מאותה סיבה כמו זיכוי הקרדיטים: רק מי שהעביר
   * `pending ⟵ paid` מאריך תקופה.
   */
  async activateWithin(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    seatId: string,
    now: Date,
  ): Promise<{ tenantId: string; periodEnd: Date } | null> {
    const seat = await tx.whatsappSeat.findUnique({ where: { id: seatId } });
    /*
     * ‎`released` אינו קם לתחייה — הקורא מדווח על תשלום בלי מקום חי.
     * ביטול שטרם שוחרר כן מתחדש: הלקוח שילם, המקום שלו.
     */
    if (seat === null || seat.status === "released") return null;
    const anchorDay = seat.billingAnchorDay ?? billingAnchorDay(now);
    const periodEnd = nextPeriodEnd(seat.currentPeriodEnd, now, "monthly", anchorDay);
    await tx.whatsappSeat.update({
      where: { id: seatId },
      data: {
        status: "active",
        billingAnchorDay: anchorDay,
        currentPeriodEnd: periodEnd,
        // תשלום אחרי ביטול מחיה את המקום — הביטול כבר אינו רלוונטי
        cancelledAt: null,
      },
    });
    return { tenantId: seat.tenantId, periodEnd };
  }

  /**
   * ‎**תשלום שנתפס בלי מקום חי** — כסף בלי שירות.
   *
   * קורה כשדף תשלום נשאר פתוח אחרי שהמקום שוחרר. שתיקה כאן היא
   * בדיוק המקרה שבו לקוח מחויב ולא מקבל דבר, ואיש אינו יודע.
   */
  async reportOrphanPayment(paymentId: string, seatId: string | null): Promise<void> {
    const seat =
      seatId === null
        ? null
        : await this.prisma.whatsappSeat.findUnique({ where: { id: seatId } });
    if (seat !== null && seat.status !== "released") return;
    this.logger.error(
      `תשלום ${paymentId} על מקום לסוכן הוואטסאפ נתפס אך המקום ${seatId ?? "(חסר)"} אינו חי — נדרש החזר או הפעלה ידנית`,
    );
  }

  /** מקומות בתשלום שתופסים מכסה — כולל מקום שהחיוב עליו נכשל. */
  private async paidCount(tenantId: string): Promise<number> {
    return this.prisma.whatsappSeat.count({
      where: whatsappSeatQuotaWhere(tenantId, new Date()),
    });
  }

  /**
   * המכסה ירדה — ומישהו חייב לרדת איתה.
   *
   * ‎**זו ההכרעה הקשה כאן, והיא מכוונת.** הזכאות בזמן ריצה קוראת את
   * הדגל של המשתמש ואת המסלול, לא את המכסה — ולכן מקום שהסתיים לא
   * מנתק איש מעצמו, והמשרד היה ממשיך לעבוד מעל מה ששילם ללא הגבלת
   * זמן. הורדה ידנית של המכסה **נדחית** במסך הפלטפורמה, כי שם יש
   * אדם שיכול לבחור; מקום שפג אינו יכול להידחות — הכסף פשוט הפסיק.
   *
   * מי יורד: ‎**המצטרפים האחרונים, ולעולם לא בעל המשרד.** הוא מחזיק
   * במקום שכלול במסלול, וניתוק שלו היה משאיר את המשרד בלי אף אחד.
   * הכלל דטרמיניסטי כדי שהתשובה לשאלה „למה דווקא הוא” תהיה אותה
   * תשובה בכל פעם, והמשרד מקבל התראה כדי שיוכל להקצות מחדש.
   */
  async revokeOverQuota(tenantId: string, now = new Date()): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${tenantId}`}))`;
      const seats = whatsappAgentSeats({
        planHasAgent: await this.plans.tenantHasFeature(tenantId, "voice_intake", tx),
        granted:
          (
            await tx.tenant.findUnique({
              where: { id: tenantId },
              select: { whatsappAgentSeatsExtra: true },
            })
          )?.whatsappAgentSeatsExtra ?? 0,
        paid: await tx.whatsappSeat.count({ where: whatsappSeatQuotaWhere(tenantId, now) }),
      });
      const holders = await tx.user.findMany({
        where: { tenantId, isActive: true, whatsappAccess: true },
        select: { id: true, role: true },
        // האחרון שהצטרף יורד ראשון; בעל המשרד אחרון בכל מקרה
        orderBy: { createdAt: "desc" },
      });
      const excess = holders.length - seats;
      if (excess <= 0) return 0;

      const victims = holders.filter((h) => h.role !== "owner").slice(0, excess);
      if (victims.length === 0) return 0;
      await tx.user.updateMany({
        where: { id: { in: victims.map((v) => v.id) } },
        data: { whatsappAccess: false },
      });
      this.logger.warn(
        `משרד ${tenantId}: המכסה ירדה ל-${seats}, ${victims.length} הקצאות בוטלו אוטומטית`,
      );
      return victims.length;
    });
  }

  /** תיאור התקופה למייל ולמסך — תאריך אחד, בשעון ירושלים. */
  periodText(periodEnd: Date | null): string {
    return periodEnd === null ? "" : formatJerusalemDate(periodEnd);
  }

  private async payer(
    tenantId: string,
    userId: string,
  ): Promise<{ name: string; email: string; phone?: string }> {
    const [tenant, owner, actor] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
      this.prisma.user.findFirst({
        where: { tenantId, role: "owner", isActive: true },
        select: { email: true, phone: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } }),
    ]);
    const contact = owner ?? actor;
    return {
      name: tenant?.name ?? "לקוח",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
    };
  }
}
