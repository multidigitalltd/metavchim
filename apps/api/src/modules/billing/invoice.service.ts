import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  DEFAULT_VAT_PERCENT,
  INVOICE_MAX_ATTEMPTS,
  invoiceLineDescription,
  invoiceRejectionReason,
  invoiceRetryDelayMs,
  vatSplitFromGross,
  type InvoicePurpose,
} from "@metavchim/shared";
import { LinetService } from "../../core/linet.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * חשבונית מס קבלה על כל תשלום שנגבה.
 *
 * ## למה שירות ולא קריאה ישירה מהוובהוק
 *
 * הפקת המסמך **אינה חלק מהגבייה**. אם לינט אינה זמינה, התשלום עדיין
 * נגבה, המנוי עדיין מופעל, והמשרד עדיין מקבל שירות — מה שחסר הוא
 * מסמך, וזה חוב שאפשר להשלים מאוחר יותר. לכן הקריאה ללינט אינה
 * יושבת בתוך הטרנזקציה של התשלום ואינה יכולה להפיל אותה: נרשמת שורה
 * `pending`, והסורק משלים אותה.
 *
 * ## הכשל שהמבנה הזה נבנה למנוע
 *
 * **מסמך כפול.** הוובהוק של קארדקום מגיע יותר מפעם אחת, הסורק רץ
 * במקביל, ובמסך הפלטפורמה יש כפתור "הפק שוב". שלוש דרכים לאותה
 * שורה. שלוש שכבות מגינות:
 * 1. `payment_id` ייחודי בטבלה — שתי שורות על אותו תשלום פשוט
 *    אינן אפשריות.
 * 2. תפיסה מותנית (`updateMany` עם סטטוס בתנאי) לפני כל קריאה
 *    ללינט — רק מי שהעביר את השורה ל-`issuing` מדבר עם הספק.
 * 3. חיפוש לפי `refnum_ext` לפני הפקה חוזרת של שורה שנתקעה
 *    ב-`issuing` — כדי לאמץ מסמך שנוצר בניסיון שנקטע, במקום ליצור
 *    שני.
 */

/** כמה זמן שורה יכולה להיות "בהפקה" לפני שמניחים שהתהליך נפל. */
const STUCK_ISSUING_MS = 10 * 60 * 1000;

/**
 * הסורק רץ כל חמש דקות.
 *
 * מסמך אינו דחוף לשנייה — הוא דחוף ל**יום**: הלקוח מצפה לחשבונית
 * אחרי שחויב, ורואה החשבון מצפה לה בסוף החודש. חמש דקות נותנות
 * השלמה מהירה אחרי תקלה רגעית בלי להעמיס על לינט.
 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** שתי דקות אחרי העלייה — אחרי המיגרציות וההגדרות, כמו שאר הסורקים. */
const FIRST_SWEEP_DELAY_MS = 2 * 60 * 1000;

@Injectable()
export class InvoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  /** סבב שעוד רץ — שני סבבים במקביל היו נלחמים על אותן שורות. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly linet: LinetService,
    private readonly plans: PlanCatalogService,
    private readonly settings: PlatformSettingsService,
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
      const result = await this.issueDue();
      if (result.issued > 0 || result.failed > 0) {
        this.logger.log(`חשבוניות: ${result.issued} הופקו, ${result.failed} נכשלו`);
      }
    } catch (error) {
      this.logger.error(`סבב החשבוניות נכשל: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async vatPercent(): Promise<number> {
    const raw = await this.settings.get("vatPercent");
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_VAT_PERCENT;
  }

  /**
   * רישום חוב מסמך על תשלום שנגבה — **לא מפיק, רק רושם**.
   *
   * נקרא מיד אחרי שהתשלום סומן כשולם. אינו זורק לעולם: הקורא כבר
   * גבה כסף, וחריגה כאן הייתה מבטלת את הפעלת המנוי בגלל תקלת רישום.
   */
  async queueForPayment(paymentId: string): Promise<void> {
    try {
      const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) return;
      const rejection = invoiceRejectionReason(payment);
      if (rejection !== null) return;

      const vatPercent = await this.vatPercent();
      const split = vatSplitFromGross(payment.amountAgorot, vatPercent);
      const description = await this.describe(payment);

      await this.prisma.invoice.create({
        data: {
          id: ulid(),
          tenantId: payment.tenantId,
          paymentId: payment.id,
          status: "pending",
          grossAgorot: split.grossAgorot,
          netAgorot: split.netAgorot,
          vatAgorot: split.vatAgorot,
          vatPercent,
          description,
          nextAttemptAt: new Date(),
        },
      });
    } catch (error) {
      /*
       * שורה שכבר קיימת (P2002) היא המצב התקין בוובהוק שחוזר — לא
       * תקלה. כל שאר הכשלים נרשמים ולא נזרקים: הסורק ידווח עליהם
       * שוב, והמסך מציג תשלום בלי מסמך.
       */
      const code = (error as { code?: string }).code;
      if (code !== "P2002") {
        this.logger.error(`רישום חשבונית לתשלום ${paymentId} נכשל: ${String(error)}`);
      }
    }
  }

  /** תיאור שורת המסמך — שם המסלול בעברית ולא הקוד. */
  private async describe(payment: {
    purpose: string;
    planCode: string | null;
    billingCycle: string | null;
    creditsPurchased: number | null;
  }): Promise<string> {
    const purpose: InvoicePurpose =
      payment.purpose === "credits"
        ? "credits"
        : payment.purpose === "number_rental"
          ? "number_rental"
          : "subscription";
    let planLabel: string | undefined;
    if (purpose === "subscription" && payment.planCode) {
      const plan = (await this.plans.all()).find((item) => item.code === payment.planCode);
      planLabel = plan?.name ?? payment.planCode;
    }
    return invoiceLineDescription({
      purpose,
      planLabel,
      billingCycle: payment.billingCycle === "yearly" ? "yearly" : "monthly",
      credits: payment.creditsPurchased ?? undefined,
    }).slice(0, 200);
  }

  /**
   * הסורק — מפיק את מה שממתין.
   *
   * מוגבל למכסה בכל סבב: תור שהצטבר אחרי נפילה ארוכה של לינט לא
   * אמור להישפך עליה בבת אחת ברגע שחזרה.
   */
  async issueDue(limit = 20): Promise<{ issued: number; failed: number }> {
    if (!(await this.linet.isConfigured())) return { issued: 0, failed: 0 };
    const now = new Date();
    const due = await this.prisma.invoice.findMany({
      where: {
        OR: [
          {
            status: { in: ["pending", "failed"] },
            attempts: { lt: INVOICE_MAX_ATTEMPTS },
            nextAttemptAt: { lte: now },
          },
          // שורה שנתקעה "בהפקה" — התהליך שתפס אותה נפל
          { status: "issuing", nextAttemptAt: { lte: new Date(now.getTime() - STUCK_ISSUING_MS) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: { id: true },
    });

    let issued = 0;
    let failed = 0;
    for (const row of due) {
      const result = await this.issueOne(row.id);
      if (result.ok) issued += 1;
      else failed += 1;
    }
    return { issued, failed };
  }

  /**
   * הפקה של שורה אחת — גם מהסורק וגם מכפתור "הפק שוב" במסך.
   *
   * מחזירה תוצאה ולא זורקת: שני הקוראים צריכים להציג את מה שלינט
   * אמרה, ולא "משהו נכשל".
   */
  async issueOne(invoiceId: string): Promise<{ ok: boolean; error?: string }> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException("חשבונית לא נמצאה");
    if (invoice.status === "issued") return { ok: true };

    const missing = await this.linet.missingSettings();
    if (missing.length > 0) {
      return { ok: false, error: `הגדרות לינט חסרות: ${missing.join(", ")}` };
    }

    /*
     * התפיסה — רק מי שהצליח להעביר את השורה ל-`issuing` ממשיך.
     * `nextAttemptAt` נדחף קדימה כאן ומשמש גם כשעון ההשתחררות של
     * שורה שנתקעה.
     */
    const claimed = await this.prisma.invoice.updateMany({
      where: {
        id: invoice.id,
        OR: [
          { status: { in: ["pending", "failed"] } },
          {
            status: "issuing",
            nextAttemptAt: { lte: new Date(Date.now() - STUCK_ISSUING_MS) },
          },
        ],
      },
      data: {
        status: "issuing",
        attempts: { increment: 1 },
        nextAttemptAt: new Date(Date.now() + STUCK_ISSUING_MS),
      },
    });
    if (claimed.count === 0) return { ok: true }; // מישהו אחר מפיק אותה כרגע

    /*
     * **כל ניסיון שאינו הראשון מחפש קודם.**
     *
     * לא רק שורה שנתקעה ב-`issuing`: יצירה שהצליחה בלינט ושהתשובה
     * עליה לא הגיעה (timeout, ניתוק) מסומנת כאן `failed` — ואז
     * הניסיון הבא היה יוצר מסמך שני על אותו תשלום. הכישלון
     * ה"ודאי" והכישלון הדו-משמעי נראים זהים מבחוץ, ולכן ההנחה
     * חייבת להיות המחמירה (ביקורת Codex).
     */
    const isRetry = invoice.attempts > 0 || invoice.status === "issuing";
    try {
      const customer = await this.customerFor(invoice.tenantId);

      /*
       * ניסיון חוזר אחרי נפילה — קודם בודקים אם המסמך כבר נוצר.
       * זה ההבדל בין "השלמנו מסמך חסר" לבין "הוצאנו ללקוח שתי
       * חשבוניות על אותו חיוב".
       */
      let documentId: string | null = isRetry
        ? await this.linet.findDocumentByExternalRef(invoice.paymentId)
        : null;
      let pdfUrl: string | null = null;
      /*
       * מספר ההקצאה הוא מה שמופיע בספרים, אבל **הוא אינו פותח את
       * המסמך** — לכך משמש `documentId`. השניים נשמרים בנפרד.
       */
      let allocationNumber: string | null = null;

      if (documentId === null) {
        const document = await this.linet.issueTaxInvoiceReceipt({
          customer,
          description: invoice.description,
          grossAgorot: invoice.grossAgorot,
          externalRef: invoice.paymentId,
          // לינט שולחת את המסמך ללקוח במייל
          sendEmail: true,
        });
        documentId = document.documentId;
        pdfUrl = document.pdfUrl;
        allocationNumber = document.allocationNumber;
      } else {
        pdfUrl = await this.linet.documentPdfUrl(documentId).catch(() => null);
      }

      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "issued",
          documentId: documentId.slice(0, 60),
          documentNumber: (allocationNumber ?? documentId).slice(0, 40),
          documentUrl: pdfUrl?.slice(0, 500) ?? null,
          issuedAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = invoice.attempts + 1;
      await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "failed",
          lastError: message.slice(0, 300),
          // מוצו הניסיונות ⟵ מחכה לאדם, לא לשעון
          nextAttemptAt:
            attempts >= INVOICE_MAX_ATTEMPTS
              ? null
              : new Date(Date.now() + invoiceRetryDelayMs(attempts)),
        },
      });
      this.logger.error(`הפקת חשבונית ${invoice.id} נכשלה: ${message}`);
      return { ok: false, error: message.slice(0, 300) };
    }
  }

  /**
   * מי מקבל את המסמך — המשרד, ולא המשתמש שלחץ.
   *
   * שם המשרד ואימייל הקשר שלו הם מה שמופיע על החשבונית. בהיעדר
   * אימייל על המשרד נופלים לבעלים: מסמך שיוצא בלי כתובת לא יישלח,
   * ולינט תדחה אותו.
   */
  private async customerFor(
    tenantId: string,
  ): Promise<{ name: string; email: string; phone?: string | undefined }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    if (!tenant) throw new Error("המשרד שעליו נרשם התשלום אינו קיים");

    /*
     * האימייל הוא של **בעל המשרד** ולא של מי שלחץ: החשבונית היא
     * מסמך של העסק, והיא נשלחת למי שאחראי עליו. משתמש שעזב אינו
     * אמור להמשיך לקבל את החשבוניות של המשרד.
     */
    const owner = await this.prisma.user.findFirst({
      where: { tenantId, role: "owner", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    const email = owner?.email ?? "";
    if (email === "") throw new Error("למשרד אין בעלים פעיל עם כתובת אימייל לחשבונית");

    const settings = (tenant.settings ?? {}) as Record<string, unknown>;
    const phone = typeof settings["officePhone"] === "string" ? settings["officePhone"] : "";
    return {
      name: tenant.name,
      email,
      phone: phone === "" ? undefined : phone,
    };
  }

  /**
   * קישור להורדת המסמך — **נמשך מחדש בכל הורדה.**
   *
   * הקישור שלינט מחזירה אינו נצחי, וקישור שמור שפג היה נראה למשרד
   * כמו חשבונית שנעלמה. הקישור השמור הוא נפילה לאחור בלבד.
   */
  async downloadUrl(invoiceId: string, tenantId: string): Promise<string> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { documentId: true, documentUrl: true, status: true },
    });
    if (!invoice || invoice.status !== "issued") throw new NotFoundException("חשבונית לא נמצאה");
    // המזהה של הספק ולא מספר ההקצאה — רק הוא פותח את המסמך
    const fresh =
      invoice.documentId !== null
        ? await this.linet.documentPdfUrl(invoice.documentId).catch(() => null)
        : null;
    const url = fresh ?? invoice.documentUrl;
    if (url === null) throw new NotFoundException("הקישור למסמך אינו זמין כרגע");
    return url;
  }
}
