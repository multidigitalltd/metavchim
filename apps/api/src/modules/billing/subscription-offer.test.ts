import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import type { PrismaService } from "../../core/prisma.service";
import { SubscriptionOfferService } from "./subscription-offer.service";

/**
 * הבטחת המחיר של הצעה בלינק: הסכום שנפתח בו דף התשלום הוא בדיוק
 * הסכום שההצעה קבעה — והוא זה שיהפוך למחיר המתחדש. הבדיקות כאן הן
 * על סדר העדיפויות (הצעה ⟵ מחיר מוסכם ⟵ מחירון) ועל שערי הדחייה,
 * כי טעות בכל אחד מהם היא חיוב שגוי של לקוח.
 */

const NOW = new Date("2026-08-26T09:00:00.000Z");

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
  const prisma = {
    plan: { findMany: async () => input.plans ?? [planRow("offer_test")] },
    subscriptionOffer: { findUnique: async () => input.offer },
    tenant: {
      findUnique: async () => ({
        priceOverrideMonthlyAgorot: input.priceOverride?.monthly ?? null,
        priceOverrideYearlyAgorot: input.priceOverride?.yearly ?? null,
      }),
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
