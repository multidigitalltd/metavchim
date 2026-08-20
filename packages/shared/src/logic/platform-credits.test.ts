import { describe, expect, it } from "vitest";
import {
  creditPricingWarning,
  platformCreditsNet,
  referralBonusCredits,
  summarizePlatformCredits,
} from "./platform-credits";
import { DEFAULT_CREDIT_ECONOMY, settleReferral } from "./credit-economy";

describe("summarizePlatformCredits", () => {
  it("ספר ריק אינו יתרה שלילית ואינו הכנסה", () => {
    expect(summarizePlatformCredits([], 500)).toEqual({
      balanceCredits: 0,
      accruedCredits: 0,
      burnedCredits: 0,
      recognizedAgorot: 0,
      balanceValueAgorot: 0,
    });
  });

  it("זקיפה ומחיקה חלקית — היתרה היא ההפרש, וההכנסה רק מהמחיקה", () => {
    const summary = summarizePlatformCredits(
      [
        { kind: "referral_fee", amount: 2, recognizedAgorot: 0 },
        { kind: "referral_fee", amount: 5, recognizedAgorot: 0 },
        { kind: "burn", amount: -4, recognizedAgorot: 2_000 },
      ],
      500,
    );
    expect(summary.accruedCredits).toBe(7);
    expect(summary.burnedCredits).toBe(4);
    expect(summary.balanceCredits).toBe(3);
    expect(summary.recognizedAgorot).toBe(2_000);
    expect(summary.balanceValueAgorot).toBe(1_500);
  });

  /*
   * שווי היתרה הוא הערכה במחיר הנוכחי, וההכנסה נקראת מהשורות. שינוי
   * מחיר מזיז את ההערכה ולא נוגע במה שכבר הוכר — אחרת כל עדכון
   * תמחור היה משכתב את הדוח למפרע.
   */
  it("שינוי מחיר הקרדיט מזיז את ההערכה בלבד", () => {
    const entries = [
      { kind: "referral_fee", amount: 10, recognizedAgorot: 0 },
      { kind: "burn", amount: -4, recognizedAgorot: 2_000 },
    ];
    expect(summarizePlatformCredits(entries, 500).balanceValueAgorot).toBe(3_000);
    expect(summarizePlatformCredits(entries, 900).balanceValueAgorot).toBe(5_400);
    expect(summarizePlatformCredits(entries, 900).recognizedAgorot).toBe(2_000);
  });
});

describe("referralBonusCredits", () => {
  it("מסלול כסף — אין בונוס", () => {
    expect(
      referralBonusCredits({ priceCredits: 20, platformFeeCredits: 5, payoutCredits: 0 }),
    ).toBe(0);
  });

  it("הבונוס הוא מה שמעבר לנטו", () => {
    expect(
      referralBonusCredits({ priceCredits: 20, platformFeeCredits: 2, payoutCredits: 22 }),
    ).toBe(4);
  });

  /* שורה שפורסמה לפני שהתמורה צולמה נושאת 0 — ולא בונוס שלילי */
  it("תמורה ישנה שלא צולמה אינה מייצרת בונוס שלילי", () => {
    expect(
      referralBonusCredits({ priceCredits: 20, platformFeeCredits: 2, payoutCredits: 10 }),
    ).toBe(0);
  });

  it("נגזר נכון מהחישוב האמיתי של המערכת", () => {
    const settlement = settleReferral(20, "credits", DEFAULT_CREDIT_ECONOMY);
    expect(referralBonusCredits(settlement)).toBe(3); // ceil(15 × 20%)
  });
});

describe("platformCreditsNet", () => {
  /*
   * הבדיקה המרכזית: ברירות המחדל של המערכת חייבות להיות **רווחיות**.
   *
   * עד עכשיו הן לא היו — עמלה 10% מול בונוס 20% הפיקו 10 ₪ מול 20 ₪
   * התחייבות חדשה, כלומר הפסד בכל הפניה. הבדיקה הזו היא מה שימנע
   * חזרה לשם בטעות.
   */
  it("מסלול קרדיטים בברירות המחדל — חיובי", () => {
    const settlement = settleReferral(20, "credits", DEFAULT_CREDIT_ECONOMY);
    const net = platformCreditsNet({
      recognizedAgorot: settlement.platformFeeCredits * DEFAULT_CREDIT_ECONOMY.unitPriceAgorot,
      bonusCreditsIssued: referralBonusCredits(settlement),
      unitPriceAgorot: DEFAULT_CREDIT_ECONOMY.unitPriceAgorot,
    });
    // עמלה 5 קרדיט (25 ₪) מול בונוס 3 קרדיט (15 ₪)
    expect(net).toBe(1_000);
  });

  it("הצירוף שהיה קודם — עמלה 10% מול בונוס 20% — עדיין מפסיד", () => {
    const economy = { ...DEFAULT_CREDIT_ECONOMY, feeCreditsPercent: 10 };
    const settlement = settleReferral(20, "credits", economy);
    const net = platformCreditsNet({
      recognizedAgorot: settlement.platformFeeCredits * economy.unitPriceAgorot,
      bonusCreditsIssued: referralBonusCredits(settlement),
      unitPriceAgorot: economy.unitPriceAgorot,
    });
    expect(net).toBe(-1_000);
  });

  it("מסלול כסף בברירות המחדל — 25 ₪ לכל 100 ₪", () => {
    const settlement = settleReferral(20, "cash", DEFAULT_CREDIT_ECONOMY);
    expect(settlement.payoutAgorot).toBe(7_500);
    const net = platformCreditsNet({
      recognizedAgorot: settlement.platformFeeCredits * DEFAULT_CREDIT_ECONOMY.unitPriceAgorot,
      bonusCreditsIssued: referralBonusCredits(settlement),
      unitPriceAgorot: DEFAULT_CREDIT_ECONOMY.unitPriceAgorot,
    });
    expect(net).toBe(2_500);
  });

  it("הורדת העמלה מתחת לנקודת האיזון מחזירה את ההפסד", () => {
    const economy = {
      ...DEFAULT_CREDIT_ECONOMY,
      feeCreditsPercent: 30,
      creditBonusPercent: 10,
    };
    const settlement = settleReferral(20, "credits", economy);
    const net = platformCreditsNet({
      recognizedAgorot: settlement.platformFeeCredits * economy.unitPriceAgorot,
      bonusCreditsIssued: referralBonusCredits(settlement),
      unitPriceAgorot: economy.unitPriceAgorot,
    });
    expect(net).toBeGreaterThan(0);
  });

  it("בלי מחיקה אין הכנסה — רק ההתחייבות נרשמת", () => {
    expect(
      platformCreditsNet({
        recognizedAgorot: 0,
        bonusCreditsIssued: 4,
        unitPriceAgorot: 500,
      }),
    ).toBe(-2_000);
  });
});

describe("creditPricingWarning", () => {
  it("ברירות המחדל אינן מייצרות אזהרה", () => {
    expect(creditPricingWarning(DEFAULT_CREDIT_ECONOMY)).toBeNull();
  });

  /*
   * זו הבדיקה שמגדירה את הכלל: העמלה חייבת לעבור את
   * ‎bonus / (1 + bonus)‎, שהוא 16.67% מול בונוס של 20% — כלומר 17%
   * באחוזים שלמים.
   */
  it("16% מול בונוס 20% מזהיר, 17% כבר לא", () => {
    const at16 = creditPricingWarning({ feeCreditsPercent: 16, creditBonusPercent: 20 });
    expect(at16).not.toBeNull();
    expect(at16).toContain("17%");
    expect(creditPricingWarning({ feeCreditsPercent: 17, creditBonusPercent: 20 })).toBeNull();
  });

  it("הצירוף הישן — 10% מול 20% — מזהיר", () => {
    expect(creditPricingWarning({ feeCreditsPercent: 10, creditBonusPercent: 20 })).not.toBeNull();
  });

  /* בלי בונוס אין מה לאזן — כל עמלה חיובית מרוויחה */
  it("בונוס אפס אינו מזהיר גם בעמלה נמוכה", () => {
    expect(creditPricingWarning({ feeCreditsPercent: 1, creditBonusPercent: 0 })).toBeNull();
  });
});
