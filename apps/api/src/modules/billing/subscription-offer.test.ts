import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PrismaService } from "../../core/prisma.service";
import { SubscriptionOfferService } from "./subscription-offer.service";

/*
 * ‎`list` בונה את כתובת הלינק מ-`WEB_ORIGIN`, ו-`loadEnv` מאמת את
 * הסביבה כולה — כלומר בדיקות שקוראות ל-`list` נופלות בסביבת CI
 * שאין בה ‎.env, על משתנים שאין להם שום תפקיד בבדיקה. הערכים כאן
 * סינתטיים, אינם מגיעים לשום רשת, ו-`??=` משאיר סביבה אמיתית
 * כשהיא קיימת. vitest מריץ כל קובץ בתהליך מבודד, ולכן ההזרקה
 * אינה מדליפה לקבצים אחרים.
 */
process.env["WEB_ORIGIN"] ??= "https://test.invalid";
process.env["DATABASE_URL"] ??= "postgresql://test:test@localhost:5432/test";
process.env["REDIS_URL"] ??= "redis://localhost:6379";
process.env["DATA_ENCRYPTION_KEY"] ??= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env["PHONE_HASH_KEY"] ??= "test-phone-hash-key-not-a-real-secret-0000";

/**
 * הבטחת המחיר של הצעה בלינק: הסכום שנפתח בו דף התשלום הוא בדיוק
 * הסכום שההצעה קבעה — והוא זה שיהפוך למחיר המתחדש. הבדיקות כאן הן
 * על סדר העדיפויות (הצעה ⟵ מחיר מוסכם ⟵ מחירון) ועל שערי הדחייה,
 * כי טעות בכל אחד מהם היא חיוב שגוי של לקוח.
 */

const NOW = new Date("2026-08-26T09:00:00.000Z");

/*
 * ‎`list` בונה גם את הלינק, ולכן היא נוגעת ב-`loadEnv` — בעוד
 * שמסלול פתיחת התשלום אינו נוגע בו כלל.
 *
 * הערכים נכתבים כאן **תמיד**, ולא רק כשהם חסרים. Vite טוען `.env`
 * מהשורש לתוך `process.env`, וכך בדיקה שנשענת על הסביבה עוברת
 * במכונת פיתוח ונופלת ב-CI — בדיוק מה שקרה כאן. בדיקת יחידה
 * שהתוצאה שלה תלויה במה שמותקן מסביבה אינה בדיקה: `vitest.config.ts`
 * אומר „בלי תשתית, ולכן תמיד רצות”, וסביבה היא תשתית.
 *
 * הערכים מזויפים ומינימליים — אף אחד מהם אינו נבדק כאן לגופו.
 */
const BASE_ENV: Record<string, string> = {
  WEB_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  PHONE_HASH_KEY: "x".repeat(32),
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

/** שורת מסלול מלאה, כפי ש-Prisma מחזירה. */
function planRow(code: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code,
    name: `מסלול ${code}`,
    description: "",
    monthlyPriceAgorot: 19_900,
    yearlyPriceAgorot: null,
    maxUsers: null,
    maxProperties: null,
    maxAutomations: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: ["analytics"],
    trialDays: 14,
    isPublic: true,
    priceOnRequest: false,
    sortOrder: 1,
    retiredAt: null,
    ...overrides,
  };
}

/** שורת הצעה מלאה, כפי ש-Prisma מחזירה. */
function offerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "01OFFER0000000000000000000",
    token: "test-token",
    kind: "custom",
    tenantId: "01TENANT000000000000000000",
    planCode: "offer_test",
    billingCycle: "monthly",
    priceAgorot: 24_900,
    lineItems: [{ label: "2 מספרי טלפון", amountAgorot: 5_000 }],
    featureGrants: ["telephony"],
    note: "",
    maxRedemptions: 1,
    redemptions: 0,
    expiresAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** השירות מעל Prisma מזויף — בלי מסד, בלי סולק. */
function service(input: {
  offer: Record<string, unknown> | null;
  plans?: Record<string, unknown>[];
  priceOverride?: { monthly: number | null; yearly: number | null };
}): SubscriptionOfferService {
  const tenantRow = {
    id: (input.offer?.["tenantId"] as string | null) ?? "01TENANT000000000000000000",
    name: "משרד היעד",
    priceOverrideMonthlyAgorot: input.priceOverride?.monthly ?? null,
    priceOverrideYearlyAgorot: input.priceOverride?.yearly ?? null,
  };
  const prisma = {
    plan: { findMany: async () => input.plans ?? [planRow("offer_test")] },
    subscriptionOffer: {
      findUnique: async () => input.offer,
      findMany: async () => (input.offer === null ? [] : [input.offer]),
    },
    tenant: {
      findUnique: async () => tenantRow,
      findMany: async () => [tenantRow],
    },
  } as unknown as PrismaService;
  return new SubscriptionOfferService(prisma, new PlanCatalogService(prisma));
}

const TENANT = "01TENANT000000000000000000";

describe("מחיר ההצעה בפתיחת תשלום", () => {
  it("מחיר סופי בהצעה גובר גם על מחיר מוסכם קיים", async () => {
    const svc = service({
      offer: offerRow({ priceAgorot: 24_900 }),
      priceOverride: { monthly: 9_900, yearly: null },
    });
    const resolved = await svc.resolveForCheckout("test-token", TENANT, NOW);
    expect(resolved.amountAgorot).toBe(24_900);
  });

  it("בלי מחיר בהצעה — המחיר המוסכם של המשרד, כמו בחידוש", async () => {
    const svc = service({
      offer: offerRow({ priceAgorot: null }),
      priceOverride: { monthly: 9_900, yearly: null },
    });
    const resolved = await svc.resolveForCheckout("test-token", TENANT, NOW);
    expect(resolved.amountAgorot).toBe(9_900);
  });

  it("בלי מחיר בהצעה ובלי מחיר מוסכם — מחיר המסלול", async () => {
    const svc = service({ offer: offerRow({ priceAgorot: null }) });
    const resolved = await svc.resolveForCheckout("test-token", TENANT, NOW);
    expect(resolved.amountAgorot).toBe(19_900);
  });

  it("מסלול שנעלם מהקטלוג — ההצעה נדחית ולא מנחשת סכום", async () => {
    const svc = service({ offer: offerRow(), plans: [planRow("other")] });
    await expect(svc.resolveForCheckout("test-token", TENANT, NOW)).rejects.toThrow(
      BadRequestException,
    );
  });
});

/*
 * הסכום שהמפעיל רואה ברשימה הוא הסכום שהוא מצטט כשהוא שולח את
 * הלינק. שורה שחישבה אותו אחרת מ-`resolve` הפכה את המסך למקור
 * שני לאמת — ומקור שני נבדל מהראשון ביום שמישהו סוכם מחיר.
 */
describe("הסכום ברשימת הפלטפורמה", () => {
  it("הצעה אישית ללא מחיר — הרשימה מציגה את המחיר המוסכם, כמו הלקוח", async () => {
    const svc = service({
      offer: offerRow({ priceAgorot: null }),
      priceOverride: { monthly: 9_900, yearly: null },
    });
    const [row] = await svc.list();
    const resolved = await svc.resolveForCheckout("test-token", TENANT, NOW);
    expect(row!.amountAgorot).toBe(9_900);
    expect(row!.amountAgorot).toBe(resolved.amountAgorot);
  });

  it("מחיר סופי בהצעה גובר גם ברשימה", async () => {
    const svc = service({
      offer: offerRow({ priceAgorot: 24_900 }),
      priceOverride: { monthly: 9_900, yearly: null },
    });
    const [row] = await svc.list();
    expect(row!.amountAgorot).toBe(24_900);
  });

  it("לינק מכירה — מחיר המחירון, כי אין משרד יעד שיש לו מחיר מוסכם", async () => {
    const svc = service({
      offer: offerRow({ kind: "plan_link", tenantId: null, priceAgorot: null }),
      priceOverride: { monthly: 9_900, yearly: null },
    });
    const [row] = await svc.list();
    expect(row!.amountAgorot).toBe(19_900);
  });
});

describe("שערי הדחייה", () => {
  it("הצעה אישית של משרד אחר נדחית — ובאותו נוסח כמו לינק שגוי", async () => {
    const svc = service({ offer: offerRow() });
    const view = await svc.view("test-token", "01OTHER0000000000000000000");
    expect(view.valid).toBe(false);
    if (!view.valid) expect(view.message).toContain("אינו תקף");
  });

  it("הצעה שבוטלה מוסברת ככזו", async () => {
    const svc = service({ offer: offerRow({ revokedAt: NOW }) });
    const view = await svc.view("test-token", TENANT);
    expect(view.valid).toBe(false);
    if (!view.valid) expect(view.message).toContain("בוטלה");
  });

  it("מכסה שנוצלה סוגרת את הלינק", async () => {
    const svc = service({ offer: offerRow({ maxRedemptions: 1, redemptions: 1 }) });
    await expect(svc.resolveForCheckout("test-token", TENANT, NOW)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("לינק מכירה פתוח לכל משרד ובלי מגבלה", async () => {
    const svc = service({
      offer: offerRow({
        kind: "plan_link",
        tenantId: null,
        priceAgorot: null,
        maxRedemptions: null,
        redemptions: 12,
      }),
    });
    const resolved = await svc.resolveForCheckout("test-token", "01ANY000000000000000000000", NOW);
    expect(resolved.amountAgorot).toBe(19_900);
  });
});

describe("דף ההצעה", () => {
  it("תכונה שההצעה מוסיפה מסומנת כתוספת רק כשאינה במסלול ממילא", async () => {
    const svc = service({
      offer: offerRow({ featureGrants: ["analytics", "telephony"] }),
    });
    const view = await svc.view("test-token", TENANT);
    expect(view.valid).toBe(true);
    if (view.valid) {
      // analytics כבר במסלול — הצגתה כ"תוספת" הייתה שקר שיווקי
      expect(view.offer.extraFeatures).toEqual(["telephony"]);
      expect(view.offer.planFeatures).toContain("analytics");
    }
  });

  it("שורות התוספת מגיעות לדף כפי שנשמרו", async () => {
    const svc = service({ offer: offerRow() });
    const view = await svc.view("test-token", TENANT);
    expect(view.valid).toBe(true);
    if (view.valid) {
      expect(view.offer.lineItems).toEqual([{ label: "2 מספרי טלפון", amountAgorot: 5_000 }]);
    }
  });
});
