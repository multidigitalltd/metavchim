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
  referralCommentRejectionReason,
  referralReasonLabel,
  referralReasonRejectionReason,
  suggestedReferralPrice,
  REFERRAL_TERMS,
  forbiddenReferralWord,
  CLIENT_RATING_DIMENSIONS,
  overallRatingScore,
  dimensionRatingRejectionReason,
  declarationAccuracy,
  dimensionAccuracies,
} from "./lead-referral.js";
import { DEFAULT_LEAD_SOURCES } from "./collaboration-cost.js";
import { DEFAULT_CREDIT_ECONOMY, settleReferral } from "./credit-economy.js";

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
    expect(platformReferralFee(100)).toBe(25);
    expect(platformReferralFee(20)).toBe(5);
  });

  it("שבר שאינו קרדיט שלם — הפלטפורמה מוותרת ולא מעגלת כלפי מעלה", () => {
    // 25% מ-1 עד 3 הם 0.25–0.75 — עיגול כלפי מעלה היה גובה כאן
    // בין 33% ל-100% מהתמורה
    expect(platformReferralFee(1)).toBe(0);
    expect(platformReferralFee(2)).toBe(0);
    expect(platformReferralFee(3)).toBe(0);
    expect(platformReferralFee(4)).toBe(1);
  });

  /*
   * מה שהמסך מציג הוא מה שהשרת גובה. הפונקציה הזו עיגלה עם
   * `Math.round` בעוד `settleReferral` משתמש ב-`Math.floor`, ולכן
   * בתמורה של 10 המסך הראה 3 והשרת גבה 2.
   */
  it("זהה ל-settleReferral בכל תמורה", () => {
    for (let price = 1; price <= 200; price += 1) {
      const shown = platformReferralFee(price, DEFAULT_CREDIT_ECONOMY.feeCreditsPercent);
      const charged = settleReferral(price, "credits", DEFAULT_CREDIT_ECONOMY)
        .platformFeeCredits;
      expect(shown, `תמורה ${price}`).toBe(charged);
    }
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
      platformFeeCredits: 10,
      payoutCredits: 30,
    });
    /*
     * 25 ולא 15: העמלה חייבת לעבור את נקודת האיזון מול בונוס
     * הקרדיטים, אחרת כל הפניה מנפיקה יותר ממה שהיא גובה. ראו
     * `creditPricingWarning` ב-`platform-credits.ts`.
     */
    expect(PLATFORM_REFERRAL_FEE_PERCENT).toBe(25);
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

describe("מוניטין", () => {
  it("הערה ארוכה מדי נדחית", () => {
    expect(referralCommentRejectionReason("א".repeat(301))).not.toBeNull();
    expect(referralCommentRejectionReason("קצר")).toBeNull();
    expect(referralCommentRejectionReason(undefined)).toBeNull();
  });

  /*
   * הסכום מגיע ב**עשיריות** — ראו `LeadReferralRating.scoreTenths`.
   * 130 עשיריות על שלושה אישורים הם 4.33 כוכבים, כלומר 4.3.
   */
  it("ממוצע מעוגל לספרה אחת", () => {
    expect(referralRatingAverage(130, 3)).toBe(4.3);
    expect(referralRatingAverage(100, 2)).toBe(5);
  });

  it("משרד בלי אישורים אינו „0 מתוך 5”", () => {
    expect(referralRatingAverage(0, 0)).toBeNull();
    expect(describeReferralRating(null, 0)).toBe("טרם אושרו הצהרות");
    // מונה 0 עם ממוצע כלשהו הוא נתון סותר — עדיין "טרם אושרו"
    expect(describeReferralRating(4, 0)).toBe("טרם אושרו הצהרות");
  });

  /*
   * הניסוח אומר **דיוק הצהרות** ולא "דירוג": המספר אינו אומר כמה
   * הלקוחות טובים אלא כמה מה שנאמר עליהם התברר כנכון, וניסוח כללי
   * מוביל בדיוק למסקנה ההפוכה על משרד שמצהיר ביושר.
   */
  it("הניסוח אומר דיוק ולא איכות", () => {
    expect(describeReferralRating(referralRatingAverage(90, 2), 2)).toBe(
      "דיוק ההצהרות 4.5 מתוך 5 (2 אישורים)",
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

describe("הצהרה ואישור", () => {
  /*
   * קטלוג אחד לשני הצדדים הוא מה שמאפשר להשוות הצהרה לאישור.
   * שני קטלוגים היו שני דירוגים שאין ביניהם יחס מספרי.
   */
  it("הממדים הם איכות הלקוח, לא התנהגות המשרדים", () => {
    const keys = CLIENT_RATING_DIMENSIONS.map((d) => d.key);
    expect(keys).toContain("seriousness");
    expect(keys).toContain("budget");
  });

  it("לכל ממד נוסח נפרד למצהיר ולמאשר", () => {
    for (const dimension of CLIENT_RATING_DIMENSIONS) {
      expect(dimension.declareHint).not.toBe(dimension.confirmHint);
    }
  });

  it("הציון הכולל הוא ממוצע הממדים שדורגו", () => {
    expect(overallRatingScore({ seriousness: 5, budget: 4 })).toBe(4.5);
  });

  it("ממד שלא דורג אינו נספר", () => {
    expect(overallRatingScore({ seriousness: 5 })).toBe(5);
    expect(overallRatingScore({})).toBeNull();
  });

  it("ממד שאינו בקטלוג נדחה", () => {
    expect(dimensionRatingRejectionReason({ nope: 5 })).toContain("לא מוכר");
    expect(dimensionRatingRejectionReason({ seriousness: 5 })).toBeNull();
  });

  it("ציון מחוץ לטווח נדחה", () => {
    expect(dimensionRatingRejectionReason({ seriousness: 9 })).toContain("בין");
    expect(dimensionRatingRejectionReason({})).toContain("לפחות ממד אחד");
  });
});

describe("declarationAccuracy", () => {
  /*
   * הלב של המנגנון: המוניטין מודד **דיוק** ולא איכות. משרד שמצהיר
   * "בינוני" ומקבל אישור "בינוני" מקבל חמישה כוכבים, בדיוק כמו מי
   * שהצהיר "מצוין" וצדק.
   */
  it("הצהרה שהתאמה במדויק — חמישה כוכבים, גם על לקוח בינוני", () => {
    expect(declarationAccuracy({ seriousness: 3 }, { seriousness: 3 })).toBe(5);
    expect(declarationAccuracy({ seriousness: 5 }, { seriousness: 5 })).toBe(5);
  });

  it("ניפוח יורד לפי גודל הפער", () => {
    expect(declarationAccuracy({ seriousness: 5 }, { seriousness: 2 })).toBe(2);
  });

  it("הפער המרבי נותן את הציון הנמוך ביותר בסקאלה", () => {
    expect(declarationAccuracy({ seriousness: 5 }, { seriousness: 1 })).toBe(1);
  });

  /*
   * ממד שרק צד אחד נגע בו אינו נספר: אין ממה לגזור פער, וספירה
   * שלו כאילו הפער אפס הייתה מתגמלת הצהרה חלקית.
   */
  it("ממד שרק צד אחד דירג אינו נספר", () => {
    expect(declarationAccuracy({ seriousness: 5, budget: 5 }, { seriousness: 5 })).toBe(5);
  });

  it("בלי ממד משותף אין מדידה — ולא ציון אפס", () => {
    expect(declarationAccuracy({}, { seriousness: 4 })).toBeNull();
    expect(declarationAccuracy({ budget: 4 }, { seriousness: 4 })).toBeNull();
  });

  it("ממוצע הפערים ולא הפער הגרוע ביותר", () => {
    // פערים 0 ו-2 → ממוצע 1 → ‎5-1
    expect(
      declarationAccuracy({ seriousness: 4, budget: 5 }, { seriousness: 4, budget: 3 }),
    ).toBe(4);
  });
});

describe("dimensionAccuracies", () => {
  /*
   * הפירוט הוא מה שהופך את המוניטין לשמיש: ממוצע 3.5 יכול להיות
   * משרד שמעריך גס בכל הממדים, ויכול להיות משרד שמדייק לחלוטין
   * ומנפח בשיטתיות ממד אחד. השני הוא סיכון אחר לגמרי למי שמשלם.
   */
  it("מפריד בין סטייה מפוזרת לניפוח ממוקד — באותו ממוצע", () => {
    const spread = dimensionAccuracies(
      { seriousness: 4, budget: 4, urgency: 4, reachability: 4 },
      { seriousness: 3, budget: 3, urgency: 3, reachability: 3 },
    );
    const focused = dimensionAccuracies(
      { seriousness: 3, budget: 5, urgency: 3, reachability: 3 },
      { seriousness: 3, budget: 1, urgency: 3, reachability: 3 },
    );
    expect(spread).toEqual({
      seriousness: 4,
      budget: 4,
      urgency: 4,
      reachability: 4,
    });
    expect(focused).toEqual({
      seriousness: 5,
      budget: 1,
      urgency: 5,
      reachability: 5,
    });
    // אותו ממוצע בדיוק — ולכן הממוצע לבדו לא היה מבדיל ביניהם
    expect(declarationAccuracy(
      { seriousness: 4, budget: 4, urgency: 4, reachability: 4 },
      { seriousness: 3, budget: 3, urgency: 3, reachability: 3 },
    )).toBe(4);
    expect(declarationAccuracy(
      { seriousness: 3, budget: 5, urgency: 3, reachability: 3 },
      { seriousness: 3, budget: 1, urgency: 3, reachability: 3 },
    )).toBe(4);
  });

  it("ממד שרק צד אחד דירג אינו מופיע כלל", () => {
    expect(
      dimensionAccuracies({ seriousness: 4, budget: 3 }, { seriousness: 4 }),
    ).toEqual({ seriousness: 5 });
  });

  it("בלי ממד משותף — אובייקט ריק, וזה לא ציון אפס", () => {
    expect(dimensionAccuracies({ budget: 3 }, { seriousness: 3 })).toEqual({});
    expect(declarationAccuracy({ budget: 3 }, { seriousness: 3 })).toBeNull();
  });

  it("הממוצע של הפירוט הוא בדיוק הציון המצרפי", () => {
    const declared = { seriousness: 5, budget: 2, urgency: 4 };
    const confirmed = { seriousness: 3, budget: 2, urgency: 1 };
    const values = Object.values(dimensionAccuracies(declared, confirmed));
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.round(mean * 10) / 10).toBe(
      declarationAccuracy(declared, confirmed),
    );
  });

  it("כל ערך שלם בין 1 ל-5 — ולכן נצבר בעשיריות בלי אובדן דיוק", () => {
    for (let declaredValue = 1; declaredValue <= 5; declaredValue += 1) {
      for (let confirmedValue = 1; confirmedValue <= 5; confirmedValue += 1) {
        const value = dimensionAccuracies(
          { seriousness: declaredValue },
          { seriousness: confirmedValue },
        )["seriousness"];
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    }
  });
});
