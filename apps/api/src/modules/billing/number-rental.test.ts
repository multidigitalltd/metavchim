import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { grossFromNet } from "@metavchim/shared";
import type { CardcomService } from "../../core/cardcom.service";
import type { EmailService } from "../../core/email.service";
import type { Pbx015NumbersService } from "../../core/pbx015-numbers.service";
import type { PrismaService } from "../../core/prisma.service";
import type { VatService } from "../../core/vat.service";
import { NumberRentalService } from "./number-rental.service";

/**
 * שערי ההשכרה: מי שמנסה לשכור מספר תפוס, מספר שאינו פנוי אצל 015,
 * או כשאין מחיר מוגדר — נעצר לפני שנפתח דף תשלום. וההפעלה: חודש
 * קדימה עם עוגן יום, כי חלק מחודש מחויב כחודש מלא.
 */

const NOW = new Date("2026-08-26T09:00:00.000Z");

/*
 * אותו נימוק כמו בבדיקות ההצעות: `loadEnv` מאמת את הסביבה כולה,
 * והבדיקות רצות בלי ‎.env. הערכים נכתבים תמיד ומוחזרים בסיום.
 */
const BASE_ENV: Record<string, string> = {
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
  PLATFORM_ADMIN_EMAILS: "admin@example.test",
};
const previousEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const [key, value] of Object.entries(BASE_ENV)) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  previousEnv.clear();
});

const TENANT = "01TENANT000000000000000000";

interface Fakes {
  monthlyAgorot?: number | null;
  configured?: boolean;
  numberAvailable?: boolean;
  /** מה שמאותר לפי מזהה — `cancel`, `releaseNow`, תשלום יתום. */
  existingRental?: Record<string, unknown> | null;
  /** מה שבדיקת התפוס חוצת-המשרדים מוצאת. */
  takenRental?: Record<string, unknown> | null;
  /** שורת ה-pending של המשרד עצמו — נתיב השימוש החוזר. */
  pendingRental?: Record<string, unknown> | null;
  orphanPayment?: Record<string, unknown> | null;
  cardcomConfigured?: boolean;
}

/** השירות מעל תלויות מזויפות — בלי מסד, בלי סולק, בלי 015. */
function service(fakes: Fakes = {}): {
  svc: NumberRentalService;
  sentEmails: { to: string; subject: string }[];
  updates: Record<string, unknown>[];
  paymentBatchUpdates: Record<string, unknown>[];
  releaseCalls: string[];
} {
  const sentEmails: { to: string; subject: string }[] = [];
  const updates: Record<string, unknown>[] = [];
  const paymentBatchUpdates: Record<string, unknown>[] = [];
  const releaseCalls: string[] = [];
  /** מה נשלח לסליקה, ומה נשמר בשורת התשלום — שניהם חייבים להיות הברוטו. */
  const charged: number[] = [];
  const payments: number[] = [];
  /** השיעור שנצרב על שורת התשלום. */
  const rates: (number | undefined)[] = [];
  const prisma = {
    rentedNumber: {
      /*
       * שלוש שאילתות שונות עוברות כאן, וההבחנה לפי צורת ה-where:
       * לפי מזהה (cancel), עם NOT (בדיקת תפוס), או לפי מספר+pending
       * (איתור שורה לשימוש חוזר).
       */
      findFirst: async (args: { where: Record<string, unknown> }) => {
        if ("id" in args.where) return fakes.existingRental ?? null;
        if ("NOT" in args.where) return fakes.takenRental ?? null;
        return fakes.pendingRental ?? null;
      },
      findUnique: async () => fakes.existingRental ?? null,
      findMany: async () => [],
      create: async (args: { data: Record<string, unknown> }) => args.data,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return args.data;
      },
      delete: async () => ({}),
    },
    payment: {
      create: async (args: { data: { amountAgorot?: number; vatPercent?: number } }) => {
        if (typeof args.data.amountAgorot === "number") {
          payments.push(args.data.amountAgorot);
          rates.push(args.data.vatPercent);
        }
        return args.data;
      },
      update: async () => ({}),
      updateMany: async (args: { data: Record<string, unknown> }) => {
        paymentBatchUpdates.push(args.data);
        return { count: 1 };
      },
      findUnique: async () => fakes.orphanPayment ?? null,
    },
    tenant: { findUnique: async () => ({ name: "משרד הבדיקה" }) },
    user: { findFirst: async () => null, findUnique: async () => null },
    withExplicitTenant: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        virtualNumber: {
          updateMany: async () => ({ count: 0 }),
          findFirst: async () => null,
          create: async () => ({}),
        },
      }),
  } as unknown as PrismaService;
  const pbx015 = {
    // `=== undefined` ולא `??`: `null` כאן הוא ערך הבדיקה, לא חוסר
    monthlyPriceAgorot: async () =>
      fakes.monthlyAgorot === undefined ? 5_000 : fakes.monthlyAgorot,
    isConfigured: async () => fakes.configured ?? true,
    isNumberAvailable: async () => fakes.numberAvailable ?? true,
    availableNumbers: async () => ["0722776123"],
    purchase: async () => ({ ok: true, code: "204", message: "OK" }),
    release: async (number: string) => {
      releaseCalls.push(number);
      return { ok: true, code: "204", message: "OK" };
    },
    setDescription: async () => undefined,
  } as unknown as Pbx015NumbersService;
  const cardcom = {
    isConfigured: async () => fakes.cardcomConfigured ?? true,
    createPaymentPage: async (args: { amountAgorot: number }) => {
      charged.push(args.amountAgorot);
      return { url: "https://pay.example.test", lowProfileId: "lp1" };
    },
  } as unknown as CardcomService;
  const email = {
    send: async (to: string, subject: string) => {
      sentEmails.push({ to, subject });
    },
  } as unknown as EmailService;
  /*
   * מחיר המחירון נטו, והחיוב הוא הוא ועוד מע"מ. ה-double נוקב
   * בשיעור מפורש ולא קורא הגדרה — כדי שהבדיקה תיפול אם מישהו
   * יחזיר את החיוב לנטו.
   */
  const vat = {
    percent: async () => 18,
    gross: async (net: number) => grossFromNet(net, 18),
    // הסכום **והשיעור שלפיו נבנה** — השיעור נצרב על שורת התשלום
    charge: async (net: number) => ({ amountAgorot: grossFromNet(net, 18), vatPercent: 18 }),
  } as unknown as VatService;
  return {
    svc: new NumberRentalService(prisma, pbx015, cardcom, email, vat),
    charged,
    payments,
    rates,
    sentEmails,
    updates,
    paymentBatchUpdates,
    releaseCalls,
  };
}

describe("שערי פתיחת ההשכרה", () => {
  it("בלי מחיר מוגדר — אין דף תשלום", async () => {
    const { svc } = service({ monthlyAgorot: null });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("מספר שכבר שכור אצלנו — לכל משרד שהוא — נדחה", async () => {
    const { svc } = service({
      takenRental: { id: "01R", status: "active" },
    });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(/כבר שכור/u);
  });

  it("גם הזמנה פתוחה של משרד אחר חוסמת — pending הוא שריון", async () => {
    const { svc } = service({
      takenRental: { id: "01R", tenantId: "01OTHER", status: "pending" },
    });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(/כבר שכור/u);
  });

  it("פתיחה חוזרת מחליפה את דף התשלום הקודם, לא מכפילה אותו", async () => {
    const { svc, paymentBatchUpdates } = service({
      pendingRental: { id: "01R", status: "pending" },
    });
    await svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" });
    // הדף הישן עדיין ניתן לחיוב אצל קארדקום — ולכן superseded, לא failed
    expect(paymentBatchUpdates).toContainEqual(
      expect.objectContaining({ status: "superseded" }),
    );
  });

  it("מספר שאינו פנוי אצל 015 נדחה — הזמינות נבדקת מול הספק", async () => {
    const { svc } = service({ numberAvailable: false });
    await expect(
      svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" }),
    ).rejects.toThrow(/אינו פנוי/u);
  });

  it("קלט תקין פותח דף תשלום", async () => {
    const { svc } = service();
    const result = await svc.startCheckout({
      tenantId: TENANT,
      userId: "01U",
      number: "0722776123",
    });
    expect(result.url).toBe("https://pay.example.test");
  });

  it("הסכום לסולק הוא מחיר המחירון ועוד מע\"מ", async () => {
    /*
     * המחירון נוקב 50 ₪ לחודש לפני מע"מ — כך זה מוצג במסך ובעמוד
     * המחירים. מה שנשלח לסליקה, ומה שנשמר בשורת התשלום, חייב
     * להיות מה שבאמת יירד מהכרטיס: 59 ₪.
     */
    const { svc, charged, payments, rates } = service({ monthlyAgorot: 5_000 });
    await svc.startCheckout({ tenantId: TENANT, userId: "01U", number: "0722776123" });
    expect(charged.at(-1)).toBe(grossFromNet(5_000, 18));
    expect(payments.at(-1)).toBe(grossFromNet(5_000, 18));
    /*
     * והשיעור נצרב על השורה: המסמך ייבנה מהברוטו הזה, ופירוק בשיעור
     * שהשתנה מאז היה מחזיר נטו שאינו המחיר שהובטח (ביקורת Codex).
     */
    expect(rates.at(-1)).toBe(18);
  });
});

describe("הפעלה — חודש קדימה, עם עוגן", () => {
  it("התקופה הראשונה היא חודש מלא מרגע התשלום", async () => {
    const { svc } = service();
    let saved: Record<string, unknown> | null = null;
    const tx = {
      rentedNumber: {
        findUnique: async () => ({
          id: "01R",
          tenantId: TENANT,
          number: "0722776123",
          billingAnchorDay: null,
          currentPeriodEnd: null,
        }),
        update: async (args: { data: Record<string, unknown> }) => {
          saved = args.data;
          return args.data;
        },
      },
    };
    const activated = await svc.activateWithin(
      tx as never,
      "01R",
      new Date("2026-08-26T09:00:00.000Z"),
    );
    expect(activated?.periodEnd.toISOString()).toBe("2026-09-26T09:00:00.000Z");
    expect(saved).toMatchObject({ status: "active", billingAnchorDay: 26 });
  });

  it("השכרה מ-31 בחודש אינה מתקצרת לצמיתות — העוגן נשמר", async () => {
    const { svc } = service();
    const tx = {
      rentedNumber: {
        findUnique: async () => ({
          id: "01R",
          tenantId: TENANT,
          number: "0722776123",
          billingAnchorDay: 31,
          currentPeriodEnd: new Date("2026-02-28T09:00:00.000Z"),
        }),
        update: async () => ({}),
      },
    };
    const activated = await svc.activateWithin(
      tx as never,
      "01R",
      new Date("2026-02-28T10:00:00.000Z"),
    );
    // מפברואר המקוצר חוזרים ל-31 במרץ, לא נתקעים על 28. השעה היא
    // שעת התשלום — התקופה שחלפה נמדדת מהמאוחר מבין "עכשיו" לסופה.
    expect(activated?.periodEnd.toISOString()).toBe("2026-03-31T10:00:00.000Z");
  });
});

describe("ביטול", () => {
  it("ביטול השכרה פעילה מודיע למנהלי הפלטפורמה", async () => {
    const { svc, sentEmails } = service({
      existingRental: {
        id: "01R",
        tenantId: TENANT,
        number: "0722776123",
        status: "active",
        currentPeriodEnd: NOW,
      },
    });
    await svc.cancel(TENANT, "01R");
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0]!.to).toBe("admin@example.test");
  });

  it("ביטול לפני תשלום סוגר את השורה — בלי מחיקה ובלי פנייה ל-015", async () => {
    const { svc, updates, releaseCalls, sentEmails } = service({
      existingRental: {
        id: "01R",
        tenantId: TENANT,
        number: "0722776123",
        status: "pending",
        providerPurchasedAt: null,
        providerReleasedAt: null,
        cancelledAt: null,
      },
    });
    await svc.cancel(TENANT, "01R");
    /*
     * השורה נסגרת (released) ולא נמחקת: אם דף התשלום שנשאר פתוח
     * ישולם בכל זאת, יש מול מה לזהות את התשלום היתום. המספר מעולם
     * לא נתפס — אז אין מה לשחרר אצל הספק ואין מה להטריד מנהלים.
     */
    expect(updates).toContainEqual(expect.objectContaining({ status: "released" }));
    expect(releaseCalls.length).toBe(0);
    expect(sentEmails.length).toBe(0);
  });
});

describe("תשלום שאיחר את ההשכרה שלו", () => {
  it("השכרה ששוחררה אינה קמה לתחייה מתשלום מאוחר", async () => {
    const { svc } = service();
    const tx = {
      rentedNumber: {
        findUnique: async () => ({ id: "01R", status: "released" }),
        update: async () => {
          throw new Error("released אסור שיתעדכן");
        },
      },
    };
    expect(await svc.activateWithin(tx as never, "01R", NOW)).toBeNull();
  });

  it("תשלום שנתפס בלי השכרה חיה מדווח למנהלים — הכסף לא נעלם בשקט", async () => {
    const { svc, sentEmails } = service({
      orphanPayment: { status: "paid", amountAgorot: 5_000, tenantId: TENANT },
      existingRental: { id: "01R", number: "0722776123", status: "released" },
    });
    await svc.reportOrphanPayment("01P", "01R");
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0]!.subject).toMatch(/טיפול ידני/u);
  });

  it("כשעותק מקביל של הוובהוק כבר הפעיל — שקט, זו כפילות רגילה", async () => {
    const { svc, sentEmails } = service({
      orphanPayment: { status: "paid", amountAgorot: 5_000, tenantId: TENANT },
      existingRental: { id: "01R", number: "0722776123", status: "active" },
    });
    await svc.reportOrphanPayment("01P", "01R");
    expect(sentEmails.length).toBe(0);
  });
});
