import { describe, expect, it } from "vitest";
import type { PlanDefinition } from "./plans.js";
import {
  describeOfferPrice,
  describeOfferRejection,
  offerAmountAgorot,
  offerCreationRejection,
  offerLineItemsTotalAgorot,
  offerRejection,
  sanitizeOfferLineItems,
  type OfferDraft,
  type SubscriptionOfferDefinition,
} from "./subscription-offer.js";

const NOW = new Date("2026-08-26T09:00:00.000Z");

function plan(overrides: Partial<PlanDefinition> = {}): PlanDefinition {
  return {
    code: "pro",
    name: "מקצועי",
    description: "",
    monthlyPriceAgorot: 19_900,
    yearlyPriceAgorot: 199_000,
    maxUsers: null,
    maxProperties: null,
    maxAutomations: null,
    maxNetworkListings: null,
    maxNetworkDemands: null,
    features: ["analytics"],
    trialDays: 14,
    priceOnRequest: false,
    isPublic: true,
    sortOrder: 1,
    ...overrides,
  };
}

function offer(
  overrides: Partial<SubscriptionOfferDefinition> = {},
): SubscriptionOfferDefinition {
  return {
    id: "01OFFER",
    token: "tok",
    kind: "custom",
    tenantId: "01TENANT",
    planCode: "pro",
    billingCycle: "monthly",
    priceAgorot: 24_900,
    lineItems: [{ label: "2 מספרי טלפון", amountAgorot: 5_000 }],
    featureGrants: ["telephony"],
    note: "",
    maxRedemptions: 1,
    redemptions: 0,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("offerRejection", () => {
  const ctx = { tenantId: "01TENANT", now: NOW };

  it("הצעה תקינה מתקבלת", () => {
    expect(offerRejection(offer(), ctx)).toBeNull();
  });

  it("לינק שאינו קיים", () => {
    expect(offerRejection(null, ctx)).toBe("not_found");
  });

  it("הצעה שבוטלה", () => {
    expect(offerRejection(offer({ revokedAt: NOW }), ctx)).toBe("revoked");
  });

  it("תוקף שפג — כולל בדיוק ברגע התפוגה", () => {
    expect(offerRejection(offer({ expiresAt: NOW }), ctx)).toBe("expired");
    expect(
      offerRejection(offer({ expiresAt: new Date(NOW.getTime() + 1) }), ctx),
    ).toBeNull();
  });

  it("מכסת מימושים שנוצלה", () => {
    expect(offerRejection(offer({ maxRedemptions: 1, redemptions: 1 }), ctx)).toBe(
      "exhausted",
    );
  });

  it("בלי מגבלה — מימושים אינם חוסמים", () => {
    expect(
      offerRejection(offer({ maxRedemptions: null, redemptions: 500 }), ctx),
    ).toBeNull();
  });

  it("הצעה אישית של משרד אחר נדחית", () => {
    expect(offerRejection(offer({ tenantId: "01OTHER" }), ctx)).toBe("wrong_tenant");
  });

  /*
   * זר אינו לומד דבר על הצעה שאינה שלו — **גם לא את מצבה.** נוסח
   * זהה ל-`not_found` אינו מגן אם בדיקה מוקדמת יותר עונה קודם:
   * „ההצעה בוטלה” כבר מאשרת שהטוקן שייך להצעה אמיתית.
   */
  it("משרד אחר אינו לומד את מצב ההצעה — לא ביטול, לא תפוגה, לא מיצוי", () => {
    for (const state of [
      { revokedAt: NOW },
      { expiresAt: NOW },
      { maxRedemptions: 1, redemptions: 1 },
    ]) {
      expect(offerRejection(offer({ tenantId: "01OTHER", ...state }), ctx)).toBe("wrong_tenant");
    }
  });

  it("לינק מכירה פתוח לכל משרד", () => {
    expect(
      offerRejection(offer({ kind: "plan_link", tenantId: null, maxRedemptions: null }), ctx),
    ).toBeNull();
  });

  it("משרד זר אינו לומד שההצעה קיימת — אותו נוסח כמו לינק שגוי", () => {
    expect(describeOfferRejection("wrong_tenant")).toBe(
      describeOfferRejection("not_found"),
    );
  });
});

describe("offerAmountAgorot", () => {
  it("מחיר סופי בהצעה גובר על הכול", () => {
    expect(
      offerAmountAgorot(offer({ priceAgorot: 24_900 }), plan(), {
        monthlyAgorot: 10_000,
        yearlyAgorot: null,
      }),
    ).toBe(24_900);
  });

  it("בלי מחיר בהצעה — המחיר המוסכם של המשרד, כמו בחידוש", () => {
    expect(
      offerAmountAgorot(offer({ priceAgorot: null }), plan(), {
        monthlyAgorot: 10_000,
        yearlyAgorot: null,
      }),
    ).toBe(10_000);
  });

  it("בלי מחיר בהצעה ובלי חריגה — מחיר המסלול", () => {
    expect(offerAmountAgorot(offer({ priceAgorot: null }), plan())).toBe(19_900);
  });

  it("מסלול בלי מחיר במחזור ובלי מחיר בהצעה — אין מה לגבות", () => {
    expect(
      offerAmountAgorot(
        offer({ priceAgorot: null, billingCycle: "yearly" }),
        plan({ yearlyPriceAgorot: null }),
      ),
    ).toBeNull();
  });

  it("מסלול שנעלם מהקטלוג — אין מה לגבות, לא ניחוש", () => {
    expect(offerAmountAgorot(offer({ priceAgorot: null }), undefined)).toBeNull();
  });
});

describe("offerCreationRejection", () => {
  const CTX = { now: NOW };

  function draft(overrides: Partial<OfferDraft> = {}): OfferDraft {
    return {
      kind: "custom",
      tenantId: "01TENANT",
      planCode: "pro",
      billingCycle: "monthly",
      priceAgorot: 24_900,
      expiresAt: null,
      lineItems: [],
      maxRedemptions: 1,
      ...overrides,
    };
  }

  it("הצעה תקינה עוברת", () => {
    expect(offerCreationRejection(draft(), plan(), CTX)).toBeNull();
  });

  it("מסלול שאינו קיים נדחה", () => {
    expect(offerCreationRejection(draft(), undefined, CTX)).toContain("אינו קיים");
  });

  it("הצעה אישית בלי משרד יעד נדחית", () => {
    expect(offerCreationRejection(draft({ tenantId: null }), plan(), CTX)).toContain("משרד");
  });

  it("מחיר אפס אינו מחיר — דף תשלום על אפס נדחה בסולק", () => {
    expect(offerCreationRejection(draft({ priceAgorot: 0 }), plan(), CTX)).toContain("חיובי");
  });

  it("בלי מחיר סופי, מסלול חינמי אינו נמכר בלינק", () => {
    expect(
      offerCreationRejection(
        draft({ priceAgorot: null }),
        plan({ monthlyPriceAgorot: 0 }),
        CTX,
      ),
    ).toContain("מחיר");
  });

  /*
   * השער חייב לשאול את אותה שאלה שהמימוש ישאל. מסלול „לפי הצעה”
   * שהמחיר היחיד שלו הוא זה שסוכם עם המשרד הוא בדיוק המקרה שהמנגנון
   * נועד לו — ושער שמסתכל רק במחירון היה חוסם אותו.
   */
  it("מחיר מוסכם למשרד היעד מכשיר הצעה שהמחירון לבדו היה דוחה", () => {
    expect(
      offerCreationRejection(
        draft({ priceAgorot: null }),
        plan({ monthlyPriceAgorot: 0 }),
        { override: { monthlyAgorot: 9_900, yearlyAgorot: null }, now: NOW },
      ),
    ).toBeNull();
  });

  it("מחיר מוסכם במחזור אחר אינו מכשיר את המחזור המבוקש", () => {
    expect(
      offerCreationRejection(
        draft({ priceAgorot: null }),
        plan({ monthlyPriceAgorot: 0 }),
        { override: { monthlyAgorot: null, yearlyAgorot: 99_000 }, now: NOW },
      ),
    ).toContain("מחיר");
  });

  it("לינק מכירה אינו נהנה ממחיר מוסכם — אין לו משרד יעד", () => {
    expect(
      offerCreationRejection(
        draft({ kind: "plan_link", tenantId: null, priceAgorot: null, maxRedemptions: null }),
        plan({ monthlyPriceAgorot: 0 }),
        CTX,
      ),
    ).toContain("מחיר");
  });

  /*
   * תפוגה שכבר עברה נעצרת ביצירה ולא בלחיצה: `offerRejection` דוחה
   * אותה במימוש, ולכן בלעדיה נוצר לינק שנראה תקין ונשלח ללקוח.
   */
  it("תאריך תפוגה שכבר עבר נדחה — כולל בדיוק ברגע התפוגה", () => {
    expect(offerCreationRejection(draft({ expiresAt: NOW }), plan(), CTX)).toContain("תפוגה");
    expect(
      offerCreationRejection(
        draft({ expiresAt: new Date(NOW.getTime() - 1) }),
        plan(),
        CTX,
      ),
    ).toContain("תפוגה");
    expect(
      offerCreationRejection(
        draft({ expiresAt: new Date(NOW.getTime() + 1) }),
        plan(),
        CTX,
      ),
    ).toBeNull();
  });

  it("לינק לחבילה במחיר המסלול — תקין", () => {
    expect(
      offerCreationRejection(
        draft({ kind: "plan_link", tenantId: null, priceAgorot: null, maxRedemptions: null }),
        plan(),
        CTX,
      ),
    ).toBeNull();
  });
});

describe("sanitizeOfferLineItems", () => {
  it("שורות תקינות נשמרות, שבורות נזרקות", () => {
    expect(
      sanitizeOfferLineItems([
        { label: "  2 מספרי טלפון ", amountAgorot: 5_000 },
        { label: "", amountAgorot: 100 },
        { label: "שבר", amountAgorot: 10.5 },
        { label: "שלילי", amountAgorot: -1 },
        { label: "כלול במחיר", amountAgorot: 0 },
        "לא אובייקט",
      ]),
    ).toEqual([
      { label: "2 מספרי טלפון", amountAgorot: 5_000 },
      { label: "כלול במחיר", amountAgorot: 0 },
    ]);
  });

  it("קלט שאינו רשימה — רשימה ריקה", () => {
    expect(sanitizeOfferLineItems(null)).toEqual([]);
    expect(sanitizeOfferLineItems("[]")).toEqual([]);
  });

  it("סכימת התוספות", () => {
    expect(
      offerLineItemsTotalAgorot([
        { label: "א", amountAgorot: 1_000 },
        { label: "ב", amountAgorot: 250 },
      ]),
    ).toBe(1_250);
  });
});

describe("describeOfferPrice", () => {
  it("סכום עגול בלי אגורות, חודשי ושנתי", () => {
    expect(describeOfferPrice(24_900, "monthly")).toBe("249 ₪ לחודש");
    expect(describeOfferPrice(199_000, "yearly")).toBe("1,990 ₪ לשנה");
  });

  it("אגורות מוצגות רק כשהן קיימות", () => {
    expect(describeOfferPrice(24_950, "monthly")).toBe("249.5 ₪ לחודש");
  });
});
