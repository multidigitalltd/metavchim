import { describe, expect, it } from "vitest";
import type { LinetService } from "../../core/linet.service";
import type { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PrismaService } from "../../core/prisma.service";
import type { VatService } from "../../core/vat.service";
import { InvoiceService } from "./invoice.service";

/**
 * ‎**המסמך מפרק את הסכום בשיעור שבו הוא הורכב, לא בשיעור של היום.**
 *
 * ## מה שובר את זה
 *
 * המחירון נקוב נטו; הסכום שנגבה הוא נטו ועוד מע"מ; והמסמך נבנה
 * **מהברוטו שנגבה בפועל**, כי הוא חייב להסתכם בדיוק בשקל שקארדקום
 * גבתה. כלומר הנטו עובר הלוך-ושוב, והמעגל סגור רק כששני הכיוונים
 * משתמשים באותו שיעור.
 *
 * ‎`queueForPayment` קרא את השיעור **העדכני** בעת ההפקה. זה זהה כל
 * עוד הוא לא השתנה בין הגבייה למסמך — ונשבר בדיוק ביום שהוא משתנה
 * בחקיקה, על כל התשלומים שהיו באוויר באותו רגע (ביקורת Codex):
 * 100 ₪ נטו שנגבו כ-118 ₪ ב-18%, ומפורקים ב-19%, נרשמים כנטו של
 * 99.16 ₪ — שורת חשבונית שאינה המחיר שהובטח, ואי אפשר לתקן אותה
 * רטרואקטיבית.
 *
 * החלון אינו תיאורטי: דף תשלום שנשאר פתוח, סבב חידושים שרץ, וסורק
 * החשבוניות שעובר כל חמש דקות — שלושתם מפרידים בין הרגע שהסכום
 * נקבע לרגע שהמסמך נוצר.
 *
 * ## למה בדיקת ריצה ולא קריאת מקור
 *
 * הטענה היא על **הערך שנשמר**, לא על צורת הקוד: בדיקה שסורקת את
 * הקובץ הייתה עוברת גם על `payment.vatPercent ?? current` שנכתב
 * בסדר הפוך.
 */

const PAYMENT = {
  id: "01PAY00000000000000000000",
  tenantId: "01TENANT000000000000000000",
  purpose: "subscription",
  planCode: "basic",
  billingCycle: "monthly",
  creditsPurchased: null,
  status: "paid",
  /** 100 ₪ נטו שנגבו בשיעור 18%. */
  amountAgorot: 11_800,
};

function service(input: {
  /** מה שנצרב על התשלום. `null` = שורה שקדמה לשדה. */
  stamped: number | null;
  /** מה שההגדרה אומרת **עכשיו** — אחרי שינוי חקיקה. */
  current: number;
}): { svc: InvoiceService; created: Record<string, unknown>[] } {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    payment: {
      findUnique: async () => ({ ...PAYMENT, vatPercent: input.stamped }),
    },
    invoice: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
    },
  } as unknown as PrismaService;
  const linet = {} as unknown as LinetService;
  const plans = { all: async () => [{ code: "basic", name: "בסיסי" }] } as unknown as PlanCatalogService;
  const vat = { percent: async () => input.current } as unknown as VatService;
  return { svc: new InvoiceService(prisma, linet, plans, vat), created };
}

describe("שיעור המע\"מ של המסמך", () => {
  it("משתמש בשיעור שנצרב על התשלום, גם כשההגדרה השתנתה", async () => {
    const { svc, created } = service({ stamped: 18, current: 19 });
    const result = await svc.queueForPayment(PAYMENT.id);

    expect(result.ok).toBe(true);
    expect(created.length).toBe(1);
    expect(created[0]?.["vatPercent"]).toBe(18);
    // הנטו חוזר **בדיוק** למחיר שהובטח, ולא ל-99.16 ₪
    expect(created[0]?.["netAgorot"]).toBe(10_000);
    expect(created[0]?.["vatAgorot"]).toBe(1_800);
    expect(created[0]?.["grossAgorot"]).toBe(11_800);
  });

  it("בלי שיעור צרוב — השיעור הנוכחי, כמו שהיה תמיד", async () => {
    /*
     * שורות שקדמו לשדה. אין לנו מה לצרוב עליהן, ולכן הן שומרות
     * בדיוק את ההתנהגות שהייתה להן — ולא מקבלות ערך משוער שטוען
     * עובדה שאיננו יודעים.
     */
    const { svc, created } = service({ stamped: null, current: 19 });
    await svc.queueForPayment(PAYMENT.id);
    expect(created[0]?.["vatPercent"]).toBe(19);
  });

  it("החלקים תמיד מסתכמים בסכום שנגבה", async () => {
    for (const stamped of [0, 17, 18, 25]) {
      const { svc, created } = service({ stamped, current: 18 });
      await svc.queueForPayment(PAYMENT.id);
      const row = created[0] ?? {};
      expect(Number(row["netAgorot"]) + Number(row["vatAgorot"])).toBe(PAYMENT.amountAgorot);
    }
  });
});
