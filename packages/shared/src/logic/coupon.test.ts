import { describe, expect, it } from "vitest";
import {
  couponDefinitionRejection,
  couponRejection,
  couponRejectionMessage,
  describeCoupon,
  discountedAgorot,
  normalizeCouponCode,
  type CouponDefinition,
} from "./coupon.js";

const NOW = new Date("2026-08-10T09:00:00.000Z");

function coupon(overrides: Partial<CouponDefinition> = {}): CouponDefinition {
  return {
    code: "WELCOME20",
    description: "",
    kind: "percent",
    percentOff: 20,
    freeDays: null,
    planCode: null,
    maxRedemptions: null,
    redemptions: 0,
    expiresAt: null,
    isActive: true,
    ...overrides,
  };
}

describe("normalizeCouponCode", () => {
  it("רווחים, מקפים ואותיות קטנות מובילים לאותו קוד", () => {
    /*
     * המשתמש מדביק את הקוד ממייל וגורר רווח בסוף. בלי נרמול, קופון
     * תקין נדחה — והמשתמש מסיק שהקוד לא בתוקף.
     */
    for (const raw of ["WELCOME20", " welcome20 ", "Welcome-20", "wel come 20"]) {
      expect(normalizeCouponCode(raw)).toBe("WELCOME20");
    }
  });

  it("קוד ריק נשאר ריק ולא הופך למשהו", () => {
    expect(normalizeCouponCode("   ---   ")).toBe("");
  });
});

describe("couponRejection", () => {
  const input = { planCode: "pro", now: NOW };

  it("קופון תקין מתקבל", () => {
    expect(couponRejection(coupon(), input)).toBeNull();
  });

  it("קוד שאינו קיים", () => {
    expect(couponRejection(null, input)).toBe("not_found");
  });

  it("קופון שכובה", () => {
    expect(couponRejection(coupon({ isActive: false }), input)).toBe("inactive");
  });

  it("קופון שפג", () => {
    const expired = coupon({ expiresAt: new Date("2026-08-10T08:59:59.000Z") });
    expect(couponRejection(expired, input)).toBe("expired");
  });

  it("תפוגה בדיוק עכשיו נחשבת פגה", () => {
    // גבול: מי שמקליד בשנייה האחרונה לא אמור לקבל תוצאה אקראית
    expect(couponRejection(coupon({ expiresAt: NOW }), input)).toBe("expired");
  });

  it("קופון שנוצל במלואו", () => {
    expect(couponRejection(coupon({ maxRedemptions: 5, redemptions: 5 }), input)).toBe("exhausted");
  });

  it("שימוש אחרון עדיין תקף", () => {
    expect(couponRejection(coupon({ maxRedemptions: 5, redemptions: 4 }), input)).toBeNull();
  });

  it("קופון שמוגבל למסלול אחר", () => {
    expect(couponRejection(coupon({ planCode: "basic" }), input)).toBe("wrong_plan");
  });

  it("קופון שמוגבל למסלול שנבחר — מתקבל", () => {
    expect(couponRejection(coupon({ planCode: "pro" }), input)).toBeNull();
  });
});

describe("couponRejectionMessage", () => {
  it("כל הסיבות חוץ מ'מסלול' מקבלות הודעה זהה", () => {
    /*
     * מי שמנחש קודים לא אמור ללמוד מהתשובה אם הקוד קיים, פג, או
     * נוצל — שלוש הודעות שונות הן שלושה רמזים.
     */
    const generic = ["not_found", "inactive", "expired", "exhausted"] as const;
    const messages = new Set(generic.map((r) => couponRejectionMessage(r)));
    expect(messages.size).toBe(1);
  });

  it("'מסלול לא מתאים' כן נאמר — זו הסיבה היחידה שהמשתמש יכול לתקן", () => {
    expect(couponRejectionMessage("wrong_plan")).toContain("מסלול");
  });
});

describe("discountedAgorot", () => {
  it("20% על 100 שקל", () => {
    expect(discountedAgorot(10_000, 20)).toBe(8_000);
  });

  it("100% מייצר אפס — מצב תקין שהקורא חייב לטפל בו", () => {
    expect(discountedAgorot(10_000, 100)).toBe(0);
  });

  it("בלי הנחה המחיר לא משתנה", () => {
    expect(discountedAgorot(10_000, null)).toBe(10_000);
    expect(discountedAgorot(10_000, 0)).toBe(10_000);
  });

  it("עיגול כלפי מטה — לא גובים אגורה יותר ממה שהובטח", () => {
    // 33% מ-9999 = 6699.33 ⇒ 6699 ולא 6700
    expect(discountedAgorot(9_999, 33)).toBe(6_699);
  });

  it("אחוז מעל 100 נחסם ואינו מייצר מחיר שלילי", () => {
    // מחיר שלילי היה הופך זיכוי לחיוב אצל הסולק
    expect(discountedAgorot(10_000, 250)).toBe(0);
  });
});

describe("describeCoupon", () => {
  it("אחוז הנחה", () => {
    expect(describeCoupon(coupon({ percentOff: 25 }))).toContain("25%");
  });

  it("30 יום מוצגים כחודש ולא כ-30 ימים", () => {
    const free = coupon({ kind: "free_days", percentOff: null, freeDays: 30 });
    expect(describeCoupon(free)).toBe("חודש נוסף חינם");
  });

  it("90 יום מוצגים כשלושה חודשים", () => {
    const free = coupon({ kind: "free_days", percentOff: null, freeDays: 90 });
    expect(describeCoupon(free)).toBe("3 חודשים נוספים חינם");
  });

  it("מספר שאינו כפולה של 30 נשאר בימים", () => {
    const free = coupon({ kind: "free_days", percentOff: null, freeDays: 45 });
    expect(describeCoupon(free)).toBe("45 ימי ניסיון נוספים");
  });
});

describe("couponDefinitionRejection", () => {
  const base = {
    code: "WELCOME20",
    kind: "percent" as const,
    percentOff: 20,
    freeDays: null,
    maxRedemptions: null,
  };

  it("הגדרה תקינה", () => {
    expect(couponDefinitionRejection(base)).toBeNull();
  });

  it("קוד קצר מדי נדחה גם אם הוא ארוך בתווים שאינם נספרים", () => {
    expect(couponDefinitionRejection({ ...base, code: "a-b" })).not.toBeNull();
  });

  it("קופון אחוז בלי אחוז — קופון שלא נותן דבר", () => {
    expect(couponDefinitionRejection({ ...base, percentOff: null })).not.toBeNull();
    expect(couponDefinitionRejection({ ...base, percentOff: 0 })).not.toBeNull();
    expect(couponDefinitionRejection({ ...base, percentOff: 101 })).not.toBeNull();
  });

  it("קופון ימים בלי ימים", () => {
    const free = { ...base, kind: "free_days" as const, percentOff: null, freeDays: null };
    expect(couponDefinitionRejection(free)).not.toBeNull();
    expect(couponDefinitionRejection({ ...free, freeDays: 30 })).toBeNull();
  });

  it("מגבלת שימושים אפס אינה הגיונית", () => {
    expect(couponDefinitionRejection({ ...base, maxRedemptions: 0 })).not.toBeNull();
    expect(couponDefinitionRejection({ ...base, maxRedemptions: 1 })).toBeNull();
  });
});
