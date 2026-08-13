import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREDIT_ECONOMY,
  creditPackageRejectionReason,
  packageDiscountPercent,
  packageUnitPriceAgorot,
  resolveNumericSetting,
  settleReferral,
  type CreditEconomy,
} from "./credit-economy.js";

const economy: CreditEconomy = {
  ...DEFAULT_CREDIT_ECONOMY,
  unitPriceAgorot: 1000,
  creditBonusPercent: 20,
  feeCreditsPercent: 10,
  feeCashPercent: 30,
};

describe("resolveNumericSetting", () => {
  it("קורא מספר מטקסט, ומקבל אפס כהחלטה לגיטימית", () => {
    expect(resolveNumericSetting("25", 5, { max: 100 })).toBe(25);
    expect(resolveNumericSetting(" 8 ", 5, { max: 100 })).toBe(8);
    expect(resolveNumericSetting(0, 5, { max: 100 })).toBe(0);
  });

  it('שדה שנוקה הוא "לא נקבע" ולא אפס', () => {
    // Number("") הוא 0 — קריאה תמימה הייתה מאפסת מחיר בשקט
    expect(resolveNumericSetting("", 500, { max: 100_000 })).toBe(500);
    expect(resolveNumericSetting("   ", 500, { max: 100_000 })).toBe(500);
    expect(resolveNumericSetting(null, 500, { max: 100_000 })).toBe(500);
    expect(resolveNumericSetting(undefined, 500, { max: 100_000 })).toBe(500);
  });

  it("ערך פסול או מחוץ לתחום נופל לברירת המחדל", () => {
    expect(resolveNumericSetting("abc", 12, { max: 100 })).toBe(12);
    expect(resolveNumericSetting(-1, 12, { max: 100 })).toBe(12);
    expect(resolveNumericSetting(101, 12, { max: 100 })).toBe(12);
    expect(resolveNumericSetting(1.5, 12, { max: 100 })).toBe(12);
    expect(resolveNumericSetting(1.5, 12, { max: 100, integer: false })).toBe(1.5);
  });
});

describe("creditPackageRejectionReason", () => {
  it("חבילה תקינה עוברת", () => {
    expect(creditPackageRejectionReason({ credits: 50, priceAgorot: 40_000 })).toBeNull();
  });

  it("כמות או מחיר לא חוקיים נדחים", () => {
    expect(creditPackageRejectionReason({ credits: 0, priceAgorot: 100 })).not.toBeNull();
    expect(creditPackageRejectionReason({ credits: 2.5, priceAgorot: 100 })).not.toBeNull();
    expect(creditPackageRejectionReason({ credits: 10, priceAgorot: 0 })).not.toBeNull();
  });
});

describe("תמחור חבילה", () => {
  it("מחיר ליחידה והנחה מול מחיר הבסיס", () => {
    const pkg = { credits: 100, priceAgorot: 80_000 };
    expect(packageUnitPriceAgorot(pkg)).toBe(800);
    expect(packageDiscountPercent(pkg, 1000)).toBe(20);
  });

  it("חבילה יקרה ממחיר היחידה מוצגת כשלילית ולא מוסתרת", () => {
    expect(packageDiscountPercent({ credits: 10, priceAgorot: 12_000 }, 1000)).toBe(-20);
  });
});

describe("settleReferral", () => {
  it("מסלול קרדיטים: עמלה נמוכה ובונוס על מה שנשאר במערכת", () => {
    const s = settleReferral(100, "credits", economy);
    expect(s.platformFeeCredits).toBe(10);
    // 90 נטו + 20% בונוס
    expect(s.payoutCredits).toBe(108);
    expect(s.payoutAgorot).toBe(0);
  });

  it("מסלול כסף: עמלה גבוהה יותר, והתמורה באגורות", () => {
    const s = settleReferral(100, "cash", economy);
    expect(s.platformFeeCredits).toBe(30);
    expect(s.payoutCredits).toBe(0);
    expect(s.payoutAgorot).toBe(70 * 1000);
  });

  it("הקונה משלם אותו דבר בשני המסלולים", () => {
    expect(settleReferral(100, "credits", economy).priceCredits).toBe(
      settleReferral(100, "cash", economy).priceCredits,
    );
  });

  it("העיגול לטובת המשרד המפנה ולא לטובת הפלטפורמה", () => {
    // 10% מ-15 הוא 1.5 — העמלה יורדת ל-1, והמוכר מקבל את השבר
    const s = settleReferral(15, "credits", { ...economy, creditBonusPercent: 0 });
    expect(s.platformFeeCredits).toBe(1);
    expect(s.payoutCredits).toBe(14);
  });

  it("עמלה של 100% לא מייצרת תמורה שלילית", () => {
    const s = settleReferral(10, "cash", { ...economy, feeCashPercent: 100 });
    expect(s.payoutAgorot).toBe(0);
  });
});
