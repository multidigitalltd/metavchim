import { describe, expect, it } from "vitest";
import {
  BILLING_GRACE_DAYS,
  accessUntil,
  billingAnchorDay,
  checkoutRejectionReason,
  cyclePriceAgorot,
  effectiveCyclePriceAgorot,
  describeCycle,
  describeCyclePrice,
  describeSubscription,
  isBillingCycle,
  nextPeriodEnd,
  periodDaysLeft,
  subscriptionGrantsAccess,
} from "./billing.js";
import type { PlanDefinition } from "./plans.js";

const plan = (over: Partial<PlanDefinition> = {}): PlanDefinition => ({
  code: "pro",
  name: "מקצועי",
  description: "",
  monthlyPriceAgorot: 19_900,
  yearlyPriceAgorot: 199_000,
  maxUsers: 5,
  maxProperties: null,
  maxNetworkListings: null,
  maxNetworkDemands: null,
  features: [],
  trialDays: 14,
  priceOnRequest: false,
  isPublic: true,
  sortOrder: 1,
  ...over,
});

const NOW = new Date("2026-08-09T10:00:00Z");

describe("isBillingCycle", () => {
  it("מקבל את השניים הנמכרים בלבד", () => {
    expect(isBillingCycle("monthly")).toBe(true);
    expect(isBillingCycle("yearly")).toBe(true);
    expect(isBillingCycle("weekly")).toBe(false);
  });
});

describe("cyclePriceAgorot", () => {
  it("חודשי ושנתי", () => {
    expect(cyclePriceAgorot(plan(), "monthly")).toBe(19_900);
    expect(cyclePriceAgorot(plan(), "yearly")).toBe(199_000);
  });

  it("בלי מחיר שנתי מחזיר null — ולא אפס", () => {
    // אפס היה עובר כתשלום חינם; null מוביל לדחייה
    expect(cyclePriceAgorot(plan({ yearlyPriceAgorot: null }), "yearly")).toBeNull();
  });

  it("מסלול בלי מחיר חודשי — null", () => {
    expect(cyclePriceAgorot(plan({ monthlyPriceAgorot: 0 }), "monthly")).toBeNull();
  });
});

describe("nextPeriodEnd", () => {
  it("חודש קדימה כשאין תקופה קיימת", () => {
    expect(nextPeriodEnd(null, NOW, "monthly").toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  it("שנה קדימה", () => {
    expect(nextPeriodEnd(null, NOW, "yearly").toISOString()).toBe("2027-08-09T10:00:00.000Z");
  });

  it("תשלום מוקדם מאריך מסוף התקופה הקיימת ולא מהיום", () => {
    // מי שמשלם שבוע לפני הסוף לא מוותר על השבוע ההוא
    const end = new Date("2026-08-16T10:00:00Z");
    expect(nextPeriodEnd(end, NOW, "monthly").toISOString()).toBe("2026-09-16T10:00:00.000Z");
  });

  it("תקופה שכבר חלפה מתחילה מהיום ולא ממנה", () => {
    // אחרת חידוש אחרי חודשיים היה נותן תקופה שכבר נגמרה
    const stale = new Date("2026-06-01T10:00:00Z");
    expect(nextPeriodEnd(stale, NOW, "monthly").toISOString()).toBe("2026-09-09T10:00:00.000Z");
  });

  it("31 בינואר ועוד חודש הוא סוף פברואר ולא 3 במרץ", () => {
    // הגלישה הנאיבית מזיזה את יום החיוב לתמיד, בכל חידוש עוד קצת
    const jan31 = new Date("2026-01-31T08:00:00Z");
    expect(nextPeriodEnd(jan31, new Date("2026-01-30T08:00:00Z"), "monthly").toISOString()).toBe(
      "2026-02-28T08:00:00.000Z",
    );
  });

  it("29 בפברואר בשנה מעוברת ועוד שנה הוא 28 בפברואר", () => {
    const leap = new Date("2028-02-29T08:00:00Z");
    expect(nextPeriodEnd(leap, new Date("2028-02-28T08:00:00Z"), "yearly").toISOString()).toBe(
      "2029-02-28T08:00:00.000Z",
    );
  });

  it("דצמבר גולש לשנה הבאה", () => {
    const dec = new Date("2026-12-15T08:00:00Z");
    expect(nextPeriodEnd(dec, new Date("2026-12-14T08:00:00Z"), "monthly").toISOString()).toBe(
      "2027-01-15T08:00:00.000Z",
    );
  });

  it("תאריך פגום נקרא כאילו אין תקופה", () => {
    expect(nextPeriodEnd(new Date("לא תאריך"), NOW, "monthly").toISOString()).toBe(
      "2026-09-09T10:00:00.000Z",
    );
  });

  describe("עוגן יום החיוב", () => {
    it("חוזר ל-31 אחרי שפברואר קיצר ל-28 — ולא נשאר ב-28", () => {
      // בלי העוגן הקיצור החד-פעמי היה הופך לקבוע: 3 ימים בכל חודש,
      // לתמיד (ביקורת Codex)
      const feb28 = new Date("2026-02-28T08:00:00Z");
      expect(
        nextPeriodEnd(feb28, new Date("2026-02-20T08:00:00Z"), "monthly", 31).toISOString(),
      ).toBe("2026-03-31T08:00:00.000Z");
    });

    it("ומשם שוב לאפריל, שיש בו 30", () => {
      const mar31 = new Date("2026-03-31T08:00:00Z");
      expect(
        nextPeriodEnd(mar31, new Date("2026-03-20T08:00:00Z"), "monthly", 31).toISOString(),
      ).toBe("2026-04-30T08:00:00.000Z");
    });

    it("עוגן 28 אמיתי נשאר 28 ולא קופץ לסוף החודש", () => {
      // ההבחנה שדורשת עוגן שמור: 28 בפברואר יכול להיות 31 מקוצר או
      // 28 אמיתי, ואי אפשר להסיק זאת מהתאריך עצמו
      const feb28 = new Date("2026-02-28T08:00:00Z");
      expect(
        nextPeriodEnd(feb28, new Date("2026-02-20T08:00:00Z"), "monthly", 28).toISOString(),
      ).toBe("2026-03-28T08:00:00.000Z");
    });

    it("עוגן לא תקין מדולג ולא מפיל את החישוב", () => {
      const end = new Date("2026-08-16T10:00:00Z");
      expect(nextPeriodEnd(end, NOW, "monthly", 0).toISOString()).toBe("2026-09-16T10:00:00.000Z");
      expect(nextPeriodEnd(end, NOW, "monthly", 99).toISOString()).toBe("2026-09-16T10:00:00.000Z");
      expect(nextPeriodEnd(end, NOW, "monthly", null).toISOString()).toBe(
        "2026-09-16T10:00:00.000Z",
      );
    });

    it("שנתי מכבד גם הוא את העוגן", () => {
      const feb28 = new Date("2027-02-28T08:00:00Z");
      expect(
        nextPeriodEnd(feb28, new Date("2027-02-20T08:00:00Z"), "yearly", 31).toISOString(),
      ).toBe("2028-02-29T08:00:00.000Z");
    });
  });
});

describe("billingAnchorDay", () => {
  it("היום בחודש של תחילת המנוי", () => {
    expect(billingAnchorDay(new Date("2026-01-31T08:00:00Z"))).toBe(31);
    expect(billingAnchorDay(new Date("2026-08-09T10:00:00Z"))).toBe(9);
  });
});

describe("subscriptionGrantsAccess", () => {
  const future = new Date("2026-09-01T10:00:00Z");
  const past = new Date("2026-07-01T10:00:00Z");

  it("ניסיון תמיד מקנה גישה — התפוגה שלו נבדקת במקום אחר", () => {
    expect(subscriptionGrantsAccess("trial", null, NOW)).toBe(true);
  });

  it("פעיל בתוך התקופה", () => {
    expect(subscriptionGrantsAccess("active", future, NOW)).toBe(true);
  });

  it("פעיל אחרי שהתקופה חלפה — אין גישה", () => {
    expect(subscriptionGrantsAccess("active", past, NOW)).toBe(false);
  });

  it("מבוטל עדיין עובד עד סוף התקופה ששולמה", () => {
    // זה מה שכתוב בתנאי השימוש, והמשרד שילם על התקופה הזו
    expect(subscriptionGrantsAccess("cancelled", future, NOW)).toBe(true);
    expect(subscriptionGrantsAccess("cancelled", past, NOW)).toBe(false);
  });

  it("past_due חסום גם אם התאריך עוד לא עבר", () => {
    expect(subscriptionGrantsAccess("past_due", future, NOW)).toBe(false);
  });

  it("תאריך חסר או פגום אינו נועל משרד משלם", () => {
    // הכיוון הבטוח כאן הפוך: שדה ריק הוא תקלה שלנו
    expect(subscriptionGrantsAccess("active", null, NOW)).toBe(true);
    expect(subscriptionGrantsAccess("active", "---", NOW)).toBe(true);
  });

  it("מקבל מחרוזת ISO — זה מה שמגיע מהשרת", () => {
    expect(subscriptionGrantsAccess("active", future.toISOString(), NOW)).toBe(true);
  });
});

describe("periodDaysLeft", () => {
  it("מעגל כלפי מעלה", () => {
    expect(periodDaysLeft(new Date(NOW.getTime() + 2 * 3_600_000), NOW)).toBe(1);
  });

  it("null כשאין תאריך או שהוא פגום", () => {
    expect(periodDaysLeft(null, NOW)).toBeNull();
    expect(periodDaysLeft("מחר", NOW)).toBeNull();
  });
});

describe("checkoutRejectionReason", () => {
  it("מסלול תקין עובר", () => {
    expect(checkoutRejectionReason(plan(), "monthly")).toBeNull();
    expect(checkoutRejectionReason(plan(), "yearly")).toBeNull();
  });

  it("מסלול שאינו קיים", () => {
    expect(checkoutRejectionReason(undefined, "monthly")).toBe("המסלול אינו קיים");
  });

  it("מחזור לא מוכר נדחה — הוא מגיע מהדפדפן", () => {
    expect(checkoutRejectionReason(plan(), "weekly")).toBe("מחזור חיוב לא מוכר");
  });

  it("מסלול לא ציבורי נדחה גם כשהקוד שלו נשלח ישירות", () => {
    // "לא מוצג במסך" אינו אכיפה
    expect(checkoutRejectionReason(plan({ isPublic: false }), "monthly")).toContain("פנו אלינו");
  });

  it("רכישה שנתית של מסלול בלי מחיר שנתי", () => {
    expect(checkoutRejectionReason(plan({ yearlyPriceAgorot: null }), "yearly")).toBe(
      "המסלול נמכר בחיוב חודשי בלבד",
    );
  });

  it("מסלול בסכום אפס נדחה — אחרת הוא מפעיל מנוי בלי תשלום", () => {
    expect(checkoutRejectionReason(plan({ monthlyPriceAgorot: 0 }), "monthly")).not.toBeNull();
  });
});

describe("describeCyclePrice", () => {
  it("חודשי", () => {
    expect(describeCyclePrice(plan(), "monthly")).toBe("199 ₪ לחודש");
  });

  it("שנתי", () => {
    expect(describeCyclePrice(plan(), "yearly")).toBe("1,990 ₪ לשנה");
  });

  it("null כשאין מחיר — הקורא לא אמור להציג כפתור בכלל", () => {
    expect(describeCyclePrice(plan({ yearlyPriceAgorot: null }), "yearly")).toBeNull();
  });
});

describe("describeCycle", () => {
  it("בעברית", () => {
    expect(describeCycle("monthly")).toBe("חודשי");
    expect(describeCycle("yearly")).toBe("שנתי");
  });
});

describe("describeSubscription", () => {
  it("ניסיון", () => {
    expect(describeSubscription("trial", 5)).toBe("תקופת ניסיון");
  });

  it("פעיל", () => {
    expect(describeSubscription("active", 12)).toContain("12");
  });

  it("מתחדש מחר בצורת יחיד", () => {
    expect(describeSubscription("active", 1)).toBe("מנוי פעיל — מתחדש מחר");
  });

  it("פעיל שתקופתו נגמרה מוצג כדורש חידוש", () => {
    expect(describeSubscription("active", 0)).toContain("נדרש חידוש");
  });

  it("מבוטל עם ימים שנותרו אומר עד מתי", () => {
    expect(describeSubscription("cancelled", 20)).toContain("20");
  });

  it("מבוטל שתקופתו נגמרה", () => {
    expect(describeSubscription("cancelled", 0)).toBe("המנוי בוטל");
  });

  it("past_due", () => {
    expect(describeSubscription("past_due", null)).toContain("נדרש חידוש");
  });
});

describe("accessUntil", () => {
  const end = new Date("2026-09-09T10:00:00Z");

  it("מוסיף את חלון החסד לסוף התקופה", () => {
    expect(accessUntil(end).toISOString()).toBe("2026-09-12T10:00:00.000Z");
  });

  it("החלון גדול מאפס — אחרת סוף התקופה הוא רגע הנעילה", () => {
    /*
     * זו הנקודה: החיוב החוזר נבדק אחרי סוף התקופה, ובלי חלון כל
     * משרד משלם היה נעול בחוץ בכל מחזור עד שהסורק רץ.
     */
    expect(BILLING_GRACE_DAYS).toBeGreaterThan(0);
    expect(accessUntil(end).getTime()).toBeGreaterThan(end.getTime());
  });
});

describe("effectiveCyclePriceAgorot — מחיר מוסכם למשרד", () => {
  const paid = plan({ monthlyPriceAgorot: 29_900, yearlyPriceAgorot: 299_000 });

  it("בלי חריגה — מחיר המסלול", () => {
    expect(effectiveCyclePriceAgorot(paid, "monthly")).toBe(29_900);
    expect(effectiveCyclePriceAgorot(paid, "yearly")).toBe(299_000);
  });

  it("מחיר מוסכם גובר על מחיר המסלול", () => {
    const override = { monthlyAgorot: 19_900, yearlyAgorot: null };
    expect(effectiveCyclePriceAgorot(paid, "monthly", override)).toBe(19_900);
  });

  it("החריגה חלה על המחזור שלה בלבד", () => {
    const override = { monthlyAgorot: 19_900, yearlyAgorot: null };
    expect(effectiveCyclePriceAgorot(paid, "yearly", override)).toBe(299_000);
  });

  /*
   * המקרה שהחריגה נועדה לו: משרד שסוכם איתו מחיר שנתי במסלול
   * שנמכר חודשית בלבד. בלי זה הוא היה נדחה בשער למרות שהמחיר קיים.
   */
  it("מחיר מוסכם פותח מחזור שהמסלול אינו נמכר בו", () => {
    const monthlyOnly = plan({ monthlyPriceAgorot: 29_900, yearlyPriceAgorot: null });
    expect(effectiveCyclePriceAgorot(monthlyOnly, "yearly")).toBeNull();
    expect(
      effectiveCyclePriceAgorot(monthlyOnly, "yearly", { monthlyAgorot: null, yearlyAgorot: 250_000 }),
    ).toBe(250_000);
    expect(
      checkoutRejectionReason(monthlyOnly, "yearly", { monthlyAgorot: null, yearlyAgorot: 250_000 }),
    ).toBeNull();
  });

  it("מסלול לא ציבורי נפתח למי שסוכם איתו מחיר", () => {
    const priv = plan({ monthlyPriceAgorot: 0, yearlyPriceAgorot: null, isPublic: false });
    expect(checkoutRejectionReason(priv, "monthly")).toBe("המסלול אינו נמכר באופן עצמאי — פנו אלינו");
    expect(
      checkoutRejectionReason(priv, "monthly", { monthlyAgorot: 49_900, yearlyAgorot: null }),
    ).toBeNull();
  });
});
