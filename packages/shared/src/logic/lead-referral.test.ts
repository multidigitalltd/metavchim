import { describe, expect, it } from "vitest";
import {
  MAX_REFERRAL_PRICE,
  PLATFORM_REFERRAL_FEE_PERCENT,
  describeReferralRating,
  platformReferralFee,
  referralPayout,
  resolveReferralFeePercent,
  referralPriceRejectionReason,
  referralRatingAverage,
  referralRatingRejectionReason,
  referralReasonLabel,
  referralReasonRejectionReason,
  suggestedReferralPrice,
  REFERRAL_TERMS,
  forbiddenReferralWord,
  ratingDimensionsFor,
  overallRatingScore,
  dimensionRatingRejectionReason,
} from "./lead-referral.js";
import { DEFAULT_LEAD_SOURCES } from "./collaboration-cost.js";

describe("suggestedReferralPrice", () => {
  it("מקור מתומחר — ההצעה מהטבלה", () => {
    expect(suggestedReferralPrice("kanko", DEFAULT_LEAD_SOURCES)).toBe(1);
    expect(
      suggestedReferralPrice("facebook", [
        { source: "facebook", label: "פייסבוק", creditsCost: 5 },
      ]),
    ).toBe(5);
  });

  it("מקור חינמי בביקושים אינו חינמי בהפניה — רצפה של קרדיט", () => {
    /*
     * network מתומחר 0 בהצעות על ביקושים (שת"פ בין משרדים חינם),
     * אבל מאחורי הפניה עומד לקוח אמיתי שמישהו מוותר עליו.
     */
    expect(suggestedReferralPrice("network", DEFAULT_LEAD_SOURCES)).toBe(1);
  });

  it("תמחור פגום (שלילי) לא הופך להצעה שלילית", () => {
    expect(suggestedReferralPrice("bad", [{ source: "bad", label: "פגום", creditsCost: -3 }])).toBe(
      1,
    );
  });
});

describe("platformReferralFee", () => {
  it("אחוז מהתמורה, מעוגל", () => {
    expect(platformReferralFee(100)).toBe(15);
    expect(platformReferralFee(20)).toBe(3);
  });

  it("שבר שנופל מתחת לחצי קרדיט — הפלטפורמה מוותרת ולא מעגלת כלפי מעלה", () => {
    // 15% מ-1 ומ-2 הם 0.15 ו-0.3 — עיגול כלפי מעלה היה גובה כאן
    // 100% ו-50% מהתמורה
    expect(platformReferralFee(1)).toBe(0);
    expect(platformReferralFee(2)).toBe(0);
    expect(platformReferralFee(3)).toBe(0);
    expect(platformReferralFee(4)).toBe(1);
  });

  it("המפנה לעולם לא נשאר עם אפס, גם באחוז מנופח", () => {
    expect(platformReferralFee(10, 100)).toBe(9);
    expect(platformReferralFee(10, 250)).toBe(9);
  });

  it("תמורה לא חוקית — בלי עמלה, בלי NaN", () => {
    expect(platformReferralFee(0)).toBe(0);
    expect(platformReferralFee(-5)).toBe(0);
    expect(platformReferralFee(Number.NaN)).toBe(0);
  });
});

describe("referralPayout", () => {
  it("שלושת החלקים מסתדרים תמיד: תמורה = עמלה + זיכוי", () => {
    for (let price = 1; price <= 120; price += 1) {
      const payout = referralPayout(price);
      expect(payout.platformFeeCredits + payout.payoutCredits).toBe(price);
      expect(payout.payoutCredits).toBeGreaterThan(0);
      expect(payout.platformFeeCredits).toBeGreaterThanOrEqual(0);
    }
  });

  it("הפירוק שהמסך מציג הוא זה שהשרת רושם", () => {
    expect(referralPayout(40)).toEqual({
      priceCredits: 40,
      platformFeeCredits: 6,
      payoutCredits: 34,
    });
    expect(PLATFORM_REFERRAL_FEE_PERCENT).toBe(15);
  });
});

describe("referralPriceRejectionReason", () => {
  it("תמורה תקינה עוברת", () => {
    expect(referralPriceRejectionReason(1)).toBeNull();
    expect(referralPriceRejectionReason(MAX_REFERRAL_PRICE)).toBeNull();
  });

  it("אפס, שלילי, שבר או מעל התקרה — נדחים", () => {
    expect(referralPriceRejectionReason(0)).not.toBeNull();
    expect(referralPriceRejectionReason(-3)).not.toBeNull();
    expect(referralPriceRejectionReason(2.5)).not.toBeNull();
    expect(referralPriceRejectionReason(MAX_REFERRAL_PRICE + 1)).not.toBeNull();
  });
});

describe("referralReasonRejectionReason", () => {
  it("סיבה מוכרת עוברת", () => {
    expect(referralReasonRejectionReason("out_of_area")).toBeNull();
    expect(referralReasonRejectionReason("no_capacity", "העומס אצלנו")).toBeNull();
  });

  it("בלי סיבה או עם סיבה מומצאת — נדחה", () => {
    expect(referralReasonRejectionReason("")).not.toBeNull();
    expect(referralReasonRejectionReason("because")).not.toBeNull();
  });

  it("„אחר” בלי פירוט אינו סיבה", () => {
    expect(referralReasonRejectionReason("other")).not.toBeNull();
    expect(referralReasonRejectionReason("other", "  ")).not.toBeNull();
    expect(referralReasonRejectionReason("other", "הלקוח מכר בעצמו")).toBeNull();
  });

  it("פירוט ארוך מדי נדחה", () => {
    expect(referralReasonRejectionReason("other", "א".repeat(201))).not.toBeNull();
  });
});

describe("referralReasonLabel", () => {
  it("הפניה ישנה אומרת בגלוי שלא צוינה סיבה", () => {
    expect(referralReasonLabel("unspecified")).toBe("לא צוינה סיבה");
  });

  it("סיבה מוכרת מתורגמת", () => {
    expect(referralReasonLabel("out_of_area")).toBe("מחוץ לאזור הפעילות שלנו");
  });
});

describe("דירוג", () => {
  it("ציון מחוץ לסקאלה או לא שלם נדחה", () => {
    expect(referralRatingRejectionReason(3)).toBeNull();
    expect(referralRatingRejectionReason(0)).not.toBeNull();
    expect(referralRatingRejectionReason(6)).not.toBeNull();
    expect(referralRatingRejectionReason(4.5)).not.toBeNull();
  });

  it("הערה ארוכה מדי נדחית", () => {
    expect(referralRatingRejectionReason(5, "א".repeat(301))).not.toBeNull();
  });

  it("ממוצע מעוגל לספרה אחת", () => {
    expect(referralRatingAverage(13, 3)).toBe(4.3);
    expect(referralRatingAverage(10, 2)).toBe(5);
  });

  it("משרד בלי דירוגים אינו „0 מתוך 5”", () => {
    expect(referralRatingAverage(0, 0)).toBeNull();
    expect(describeReferralRating(null, 0)).toBe("טרם דורג");
    // מונה 0 עם ממוצע כלשהו הוא נתון סותר — עדיין "טרם דורג"
    expect(describeReferralRating(4, 0)).toBe("טרם דורג");
    expect(describeReferralRating(referralRatingAverage(9, 2), 2)).toBe(
      "4.5 מתוך 5 (2 דירוגים)",
    );
  });
});

describe("אחוז עמלת הפלטפורמה מהגדרות", () => {
  it("ערך תקין מתקבל, כולל אפס", () => {
    expect(resolveReferralFeePercent(20)).toBe(20);
    expect(resolveReferralFeePercent("25")).toBe(25);
    expect(resolveReferralFeePercent(" 8 ")).toBe(8);
    // אפס הוא החלטה לגיטימית — פלטפורמה שלא גובה על הפניות
    expect(resolveReferralFeePercent(0)).toBe(0);
  });

  it("ערך פסול נופל לברירת המחדל ולא לעמלה חסרת משמעות", () => {
    for (const bad of ["", "abc", null, undefined, -5, 300, NaN]) {
      expect(resolveReferralFeePercent(bad)).toBe(PLATFORM_REFERRAL_FEE_PERCENT);
    }
  });

  it("האחוז שנקבע הוא זה שנגבה בפועל", () => {
    const payout = referralPayout(100, resolveReferralFeePercent("30"));
    expect(payout.platformFeeCredits).toBe(30);
    expect(payout.payoutCredits).toBe(70);
  });

  it("גם באפס אחוז המפנה מקבל הכול", () => {
    const payout = referralPayout(10, resolveReferralFeePercent(0));
    expect(payout.platformFeeCredits).toBe(0);
    expect(payout.payoutCredits).toBe(10);
  });
});

describe("שפת ההפניות", () => {
  /*
   * `REFERRAL_TERMS` הובטח בתיעוד מהיום הראשון ומעולם לא נבנה. הכלל
   * היה כתוב, לא היה לו מקום להיאכף בו, והשפה נסחפה חזרה למסחר.
   */
  it("המילון מגדיר עמלה ולא מחיר", () => {
    expect(REFERRAL_TERMS.fee).toBe("עמלת הפניה");
    expect(REFERRAL_TERMS.referrer).toBe("המשרד המפנה");
    expect(REFERRAL_TERMS.receiver).toBe("המשרד הקולט");
  });

  it("מזהה ניסוח של מסחר בלקוחות ומדווח מה נמצא", () => {
    expect(forbiddenReferralWord("כאן מתבצעת מכירת ליד")).toBe("מכירת ליד");
    expect(forbiddenReferralWord("סחר בלידים בין משרדים")).toBe("סחר בלידים");
  });

  it("ניסוח תקין עובר — כסף אינו המילה האסורה", () => {
    expect(forbiddenReferralWord("קליטת הפניה תמורת עמלת הפניה של 5 קרדיטים")).toBeNull();
    expect(forbiddenReferralWord("התשלום על ההפניה נגבה ברגע הקליטה")).toBeNull();
  });

  /*
   * בעברית "ליד" הוא גם מילת יחס. שער שמסמן "תווית מחיר ליד הכפתור"
   * מלמד להתעלם ממנו — וזה הסוף של כל שער.
   */
  it("„ליד” כמילת יחס אינו נחשב הפרה", () => {
    expect(forbiddenReferralWord("תווית מחיר ליד הכפתור")).toBeNull();
  });
});

describe("דירוג רב-ממדי", () => {
  /*
   * ציון יחיד אינו אומר לקולט מה היה חלש ולא אומר למפנה מה לתקן,
   * והוא מערבב דברים שאין ביניהם קשר.
   */
  it("לכל צד ממדים משלו", () => {
    expect(ratingDimensionsFor("receiver").map((d) => d.key)).toContain("accuracy");
    expect(ratingDimensionsFor("referrer").map((d) => d.key)).toContain("speed");
  });

  it("הציון הכולל הוא ממוצע הממדים שדורגו", () => {
    expect(overallRatingScore({ accuracy: 5, responsiveness: 4 })).toBe(4.5);
  });

  /*
   * ממוצע ולא סכום: מספר הממדים שונה בין הצדדים, וסכום היה הופך
   * דירוג של הקולט לגבוה מהותית בלי שאיש התכוון.
   */
  it("ממד שלא דורג אינו נספר", () => {
    expect(overallRatingScore({ accuracy: 5 })).toBe(5);
    expect(overallRatingScore({})).toBeNull();
  });

  it("ממד שאינו בקטלוג של התפקיד נדחה", () => {
    expect(dimensionRatingRejectionReason("receiver", { speed: 5 })).toContain("לא מוכר");
    expect(dimensionRatingRejectionReason("receiver", { accuracy: 5 })).toBeNull();
  });

  it("ציון מחוץ לטווח נדחה", () => {
    expect(dimensionRatingRejectionReason("receiver", { accuracy: 9 })).toContain("בין");
    expect(dimensionRatingRejectionReason("receiver", {})).toContain("לפחות ממד אחד");
  });
});
