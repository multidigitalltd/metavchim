import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ulid } from "ulid";
import {
  billingAnchorDay,
  canonicalVirtualNumber,
  describeRentalStatus,
  formatJerusalemDate,
  formatRentalNumber,
  isRentedNumberStatus,
  nextPeriodEnd,
  rentalCheckoutRejection,
  type RentedNumberStatus,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { CardcomService } from "../../core/cardcom.service";
import { EmailService } from "../../core/email.service";
import { Pbx015NumbersService } from "../../core/pbx015-numbers.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * השכרת מספרים וירטואליים — מחשבון 015 של הפלטפורמה, בחיוב חודשי.
 *
 * הזרימה: המשרד רואה את המספרים הפנויים במלאי הפלטפורמה ⟵ בוחר
 * מספר ומשלם חודש מראש בדף קארדקום ⟵ התשלום שמאושר (בוובהוק, דרך
 * `BillingService.apply`) מפעיל את ההשכרה **ותופס את המספר אצל 015
 * אוטומטית** ⟵ מנהלי הפלטפורמה מקבלים מייל, כי הניתוב הסופי אצל
 * הספק הוא עדיין עבודה ידנית.
 *
 * **חלק מחודש מחויב כחודש מלא**: התקופה נמדדת חודש קדימה מרגע
 * התשלום (עם עוגן יום, כמו במנוי), ביטול משאיר את המספר עד סוף
 * התקופה ששולמה, ואין החזר יחסי.
 *
 * החיוב החודשי המתחדש רץ ב-`NumberRentalRenewalService`, בכרטיס
 * השמור של המשרד.
 */

export interface RentalRow {
  id: string;
  number: string;
  numberDisplay: string;
  monthlyAgorot: number;
  status: RentedNumberStatus;
  statusLabel: string;
  currentPeriodEnd: Date | null;
  /** המספר נתפס בפועל אצל 015; false אחרי תשלום = בטיפול ידני. */
  provisioned: boolean;
  createdAt: Date;
}

@Injectable()
export class NumberRentalService {
  private readonly logger = new Logger(NumberRentalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pbx015: Pbx015NumbersService,
    private readonly cardcom: CardcomService,
    private readonly email: EmailService,
  ) {}

  private toRow(row: {
    id: string;
    number: string;
    monthlyAgorot: number;
    status: string;
    currentPeriodEnd: Date | null;
    providerPurchasedAt: Date | null;
    createdAt: Date;
  }): RentalRow {
    const status: RentedNumberStatus = isRentedNumberStatus(row.status) ? row.status : "pending";
    return {
      id: row.id,
      number: row.number,
      numberDisplay: formatRentalNumber(row.number),
      monthlyAgorot: row.monthlyAgorot,
      status,
      statusLabel: describeRentalStatus(status),
      currentPeriodEnd: row.currentPeriodEnd,
      provisioned: row.providerPurchasedAt !== null,
      createdAt: row.createdAt,
    };
  }

  /**
   * מה שמסך ההשכרה של המשרד מציג: המחיר, המספרים הפנויים, ומה
   * שכבר שכור. `configured=false` ⇒ המסך מציג "טרם הופעל" ולא טופס.
   */
  async offering(tenantId: string): Promise<{
    configured: boolean;
    checkoutAvailable: boolean;
    monthlyAgorot: number | null;
    available: string[];
    rentals: RentalRow[];
  }> {
    const configured = await this.pbx015.isConfigured();
    const rentals = await this.prisma.rentedNumber.findMany({
      where: { tenantId, status: { not: "released" } },
      orderBy: { createdAt: "desc" },
    });
    return {
      configured,
      checkoutAvailable: await this.cardcom.isConfigured(),
      monthlyAgorot: await this.pbx015.monthlyPriceAgorot(),
      available: configured ? await this.pbx015.availableNumbers(20) : [],
      rentals: rentals.map((row) => this.toRow(row)),
    };
  }

  /**
   * פתיחת תשלום על השכרה — חודש ראשון מראש, בדף קארדקום.
   *
   * הסכום נקבע בשרת מהגדרת הפלטפורמה; **המספר בלבד** מגיע מהדפדפן,
   * והזמינות שלו נבדקת מול 015 גם כאן וגם ברגע התפיסה — בין שני
   * הרגעים עוברות דקות, ומספר יכול להילקח בינתיים.
   */
  async startCheckout(input: {
    tenantId: string;
    userId: string;
    number: string;
  }): Promise<{ url: string; paymentId: string }> {
    const monthlyAgorot = await this.pbx015.monthlyPriceAgorot();
    const rejection = rentalCheckoutRejection({ monthlyAgorot, number: input.number });
    if (rejection !== null) throw new BadRequestException(rejection);
    if (!(await this.pbx015.isConfigured())) {
      throw new BadRequestException("השכרת מספרים טרם הופעלה — פנו אלינו");
    }
    if (!(await this.cardcom.isConfigured())) {
      throw new BadRequestException("הסליקה טרם הופעלה במערכת — פנו אלינו");
    }

    /*
     * מספר ששכור אצלנו — לכל משרד שהוא — אינו מוצע שוב. הבדיקה
     * במסד לפני הבדיקה אצל הספק: מספר שנתפס עבור משרד אחר כבר אינו
     * "פנוי" גם אם 015 עוד לא עודכן.
     */
    const taken = await this.prisma.rentedNumber.findFirst({
      where: { number: input.number, status: { in: ["active", "past_due", "cancelled"] } },
      select: { id: true },
    });
    if (taken !== null) throw new BadRequestException("המספר הזה כבר שכור — בחרו מספר אחר");
    if (!(await this.pbx015.isNumberAvailable(input.number))) {
      throw new BadRequestException("המספר כבר אינו פנוי אצל הספק — בחרו מספר אחר");
    }

    /*
     * שורת השכרה ממתינה — נוצרת פעם אחת גם אם דף התשלום נפתח שוב:
     * מי שנטש דף תשלום וחזר אינו אמור להשאיר שובל שורות ממתינות.
     */
    const existing = await this.prisma.rentedNumber.findFirst({
      where: { tenantId: input.tenantId, number: input.number, status: "pending" },
      select: { id: true },
    });
    const rentalId = existing?.id ?? ulid();
    if (existing === null) {
      await this.prisma.rentedNumber.create({
        data: {
          id: rentalId,
          tenantId: input.tenantId,
          number: input.number,
          monthlyAgorot: monthlyAgorot!,
          status: "pending",
          createdBy: input.userId,
        },
      });
    }

    const paymentId = ulid();
    await this.prisma.payment.create({
      data: {
        id: paymentId,
        tenantId: input.tenantId,
        purpose: "number_rental",
        rentalId,
        amountAgorot: monthlyAgorot!,
        status: "pending",
        lowProfileId: paymentId,
        createdBy: input.userId,
      },
    });

    const origin = loadEnv().WEB_ORIGIN;
    try {
      const page = await this.cardcom.createPaymentPage({
        reference: paymentId,
        amountAgorot: monthlyAgorot!,
        productName: `השכרת מספר וירטואלי ${formatRentalNumber(input.number)} — חודש`,
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
   * ביטול חידוש — המספר נשאר פעיל עד סוף התקופה ששולמה, בלי החזר
   * יחסי (חלק מחודש מחויב כחודש). השחרור בפועל אצל 015 קורה בסורק,
   * כשהתקופה נגמרת. השכרה שממתינה לתשלום פשוט נמחקת.
   */
  async cancel(tenantId: string, rentalId: string): Promise<void> {
    const rental = await this.prisma.rentedNumber.findFirst({
      where: { id: rentalId, tenantId },
    });
    if (rental === null) throw new BadRequestException("ההשכרה לא נמצאה");
    if (rental.status === "pending") {
      await this.prisma.rentedNumber.delete({ where: { id: rentalId } });
      return;
    }
    if (rental.status !== "active" && rental.status !== "past_due") {
      throw new BadRequestException("ההשכרה כבר בוטלה");
    }
    await this.prisma.rentedNumber.update({
      where: { id: rentalId },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
    await this.notifyAdmins(
      "בוטלה השכרת מספר וירטואלי",
      [
        `משרד ביטל את השכרת המספר ${formatRentalNumber(rental.number)}.`,
        rental.currentPeriodEnd !== null
          ? `המספר יישאר פעיל עד ${formatJerusalemDate(rental.currentPeriodEnd)} וישוחרר אוטומטית אצל 015 בתום התקופה.`
          : "המספר ישוחרר אוטומטית אצל 015 בסבב הסורק הבא.",
      ].join(" "),
    );
  }

  /**
   * הפעלת ההשכרה — **בתוך הטרנזקציה שתפסה את התשלום**, ולכן
   * אידמפוטנטית מאותה סיבה כמו זיכוי הקרדיטים: רק מי שהעביר
   * `pending ⟵ paid` מאריך תקופה.
   *
   * מחזירה את פרטי ההשכרה כדי שהקורא יריץ, אחרי הטרנזקציה, את
   * התפיסה אצל 015 — קריאת רשת אסור לה לשבת בתוך טרנזקציית מסד.
   */
  async activateWithin(
    tx: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
    rentalId: string,
    now: Date,
  ): Promise<{ number: string; tenantId: string; periodEnd: Date } | null> {
    const rental = await tx.rentedNumber.findUnique({ where: { id: rentalId } });
    if (rental === null) return null;
    const anchorDay = rental.billingAnchorDay ?? billingAnchorDay(now);
    const periodEnd = nextPeriodEnd(rental.currentPeriodEnd, now, "monthly", anchorDay);
    await tx.rentedNumber.update({
      where: { id: rentalId },
      data: {
        status: "active",
        billingAnchorDay: anchorDay,
        currentPeriodEnd: periodEnd,
      },
    });
    return { number: rental.number, tenantId: rental.tenantId, periodEnd };
  }

  /**
   * מה שקורה **אחרי** שהתשלום נתפס: תפיסת המספר אצל 015, כתיבת שם
   * המשרד על המספר, יצירת שורת הניתוב אצל המשרד, והמייל למנהלים.
   *
   * כולו עטוף — כישלון בכל שלב כאן אינו מפיל את הוובהוק (התשלום
   * כבר נתפס, וניסיון חוזר של קארדקום ממילא ייעצר על `paid`).
   * כישלון תפיסה אינו נבלע: הוא נכתב על השורה ומגיע למייל המנהלים,
   * כי מכאן זה טיפול ידני.
   */
  async provisionAfterPayment(rentalId: string): Promise<void> {
    try {
      const rental = await this.prisma.rentedNumber.findUnique({ where: { id: rentalId } });
      if (rental === null) return;
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: rental.tenantId },
        select: { name: true },
      });
      const tenantName = tenant?.name ?? rental.tenantId;

      // חידוש חודשי של מספר שכבר נתפס — אין מה לתפוס שוב
      if (rental.providerPurchasedAt !== null) return;

      const purchase = await this.pbx015.purchase(rental.number);
      if (purchase.ok) {
        await this.prisma.rentedNumber.update({
          where: { id: rentalId },
          data: { providerPurchasedAt: new Date(), providerError: null },
        });
        // שם המשרד על המספר אצל 015 — מיטבי מאמץ, למען הטיפול הידני
        await this.pbx015.setDescription(rental.number, tenantName);
        await this.createRoutingRow(rental.tenantId, rental.number);
        await this.notifyAdmins(
          "נשכר מספר וירטואלי חדש — נדרש טיפול ידני",
          [
            `המשרד "${tenantName}" שכר את המספר ${formatRentalNumber(rental.number)} ושילם חודש מראש.`,
            "המספר נתפס אוטומטית בחשבון 015 של הפלטפורמה.",
            "נותר להשלים ידנית את הניתוב אצל 015 (יעד השיחות של המשרד) ולוודא שהמספר מחובר למרכזייה שלו.",
          ].join(" "),
        );
      } else {
        await this.prisma.rentedNumber.update({
          where: { id: rentalId },
          data: {
            providerError: `תפיסת המספר נכשלה: ${purchase.code} ${purchase.message}`.slice(0, 300),
          },
        });
        await this.notifyAdmins(
          "השכרת מספר שולמה אך התפיסה אצל 015 נכשלה — נדרש טיפול מיידי",
          [
            `המשרד "${tenantName}" שילם על השכרת המספר ${formatRentalNumber(rental.number)},`,
            `אך תפיסת המספר בחשבון 015 נכשלה (${purchase.code || "רשת"}: ${purchase.message}).`,
            "יש לתפוס את המספר ידנית, או לתפוס מספר אחר ולעדכן את המשרד — הכסף כבר נגבה.",
          ].join(" "),
        );
      }
    } catch (error) {
      this.logger.error(`הקצאת השכרה ${rentalId} נכשלה: ${String(error)}`);
    }
  }

  /**
   * שחרור המספר — עכשיו, לא בסוף תקופה.
   *
   * משמש את הסורק (השכרה שבוטלה ותקופתה נגמרה) ואת מנהל הפלטפורמה
   * (טיפול ידני). מספר שנתפס אצל 015 משוחרר שם; 404 מהספק נחשב
   * כשוחרר — המספר כבר אינו בחשבון, וזה בדיוק המצב המבוקש. כישלון
   * אחר משאיר את השורה כמות שהיא, עם השגיאה כתובה עליה.
   */
  async releaseNow(rentalId: string): Promise<{ ok: boolean; message: string }> {
    const rental = await this.prisma.rentedNumber.findUnique({ where: { id: rentalId } });
    if (rental === null) return { ok: false, message: "ההשכרה לא נמצאה" };
    if (rental.status === "released") return { ok: true, message: "כבר שוחרר" };

    if (rental.providerPurchasedAt !== null && rental.providerReleasedAt === null) {
      const result = await this.pbx015.release(rental.number);
      if (!result.ok && result.code !== "404") {
        const message = `שחרור המספר נכשל: ${result.code} ${result.message}`.slice(0, 300);
        await this.prisma.rentedNumber.update({
          where: { id: rentalId },
          data: { providerError: message },
        });
        return { ok: false, message };
      }
    }
    await this.prisma.rentedNumber.update({
      where: { id: rentalId },
      data: {
        status: "released",
        providerReleasedAt: new Date(),
        providerError: null,
        cancelledAt: rental.cancelledAt ?? new Date(),
      },
    });
    await this.deactivateRoutingRow(rental.tenantId, rental.number);
    return { ok: true, message: "" };
  }

  /** כיבוי שורת הניתוב של המשרד — המספר כבר אינו שלו. */
  private async deactivateRoutingRow(tenantId: string, number: string): Promise<void> {
    try {
      const phone = canonicalVirtualNumber(number);
      if (phone === "") return;
      await this.prisma.withExplicitTenant(tenantId, (tx) =>
        tx.virtualNumber.updateMany({
          where: { tenantId, phone },
          data: { isActive: false },
        }),
      );
    } catch (error) {
      this.logger.warn(`כיבוי שורת ניתוב (${tenantId}) נכשל: ${String(error)}`);
    }
  }

  /**
   * שורת מספר וירטואלי אצל המשרד — כדי שהמספר החדש יופיע מיד במסך
   * הניתוב שלו, מוכן לשיוך סוכן או נכס.
   *
   * ‎`withExplicitTenant` כי הטבלה תחת FORCE RLS והקריאה מגיעה
   * מהוובהוק, בלי הקשר דייר. מיטבי מאמץ — משרד שהשורה לא נוצרה לו
   * יוסיף אותה ידנית, והמייל למנהלים ממילא יוצא.
   */
  private async createRoutingRow(tenantId: string, number: string): Promise<void> {
    try {
      const phone = canonicalVirtualNumber(number);
      if (phone === "") return;
      await this.prisma.withExplicitTenant(tenantId, async (tx) => {
        const exists = await tx.virtualNumber.findFirst({
          where: { tenantId, phone },
          select: { id: true },
        });
        if (exists !== null) return;
        await tx.virtualNumber.create({
          data: {
            id: ulid(),
            tenantId,
            phone,
            label: `מספר שכור ${formatRentalNumber(number)}`,
          },
        });
      });
    } catch (error) {
      this.logger.warn(`יצירת שורת ניתוב למספר שכור נכשלה (${tenantId}): ${String(error)}`);
    }
  }

  /**
   * מייל לכל מנהלי הפלטפורמה — הרכישה אוטומטית, אבל הם חייבים
   * לדעת עליה: הניתוב אצל 015 הוא עבודה ידנית.
   *
   * כישלון שליחה אינו מפיל את הזרימה — הוא נרשם ללוג, והמצב ממילא
   * גלוי במסך הפלטפורמה.
   */
  async notifyAdmins(subject: string, text: string): Promise<void> {
    const admins = loadEnv().PLATFORM_ADMIN_EMAILS;
    for (const admin of admins) {
      try {
        await this.email.send(admin, subject, {
          heading: subject,
          paragraphs: [text],
          button: { label: "למסך הפלטפורמה", url: `${loadEnv().WEB_ORIGIN}/platform` },
        });
      } catch (error) {
        this.logger.warn(`מייל למנהל ${admin} נכשל: ${String(error)}`);
      }
    }
  }

  /** מי משלם — אותה הכרעה כמו במנוי: בעל/ת המשרד, לחשבונית. */
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
