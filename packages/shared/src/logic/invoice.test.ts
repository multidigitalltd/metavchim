import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAT_PERCENT,
  INVOICE_MAX_ATTEMPTS,
  invoiceLineDescription,
  invoiceRejectionReason,
  invoiceRetryDelayMs,
  linetNoResults,
  vatSplitFromGross,
} from "./invoice.js";

describe("vatSplitFromGross", () => {
  it("מפרק סכום שנגבה כך שהחלקים מסתכמים בו בדיוק", () => {
    for (const gross of [100, 999, 12345, 29900, 1_000_001]) {
      const split = vatSplitFromGross(gross, DEFAULT_VAT_PERCENT);
      expect(split.netAgorot + split.vatAgorot).toBe(gross);
      expect(split.grossAgorot).toBe(gross);
    }
  });

  it("299 ₪ כולל מע\"מ = 253.39 ₪ + 45.61 ₪", () => {
    const split = vatSplitFromGross(29900, 18);
    expect(split.netAgorot).toBe(25339);
    expect(split.vatAgorot).toBe(4561);
  });

  /* שינוי חקיקה מטופל בהגדרה ולא בפריסה — כולל ביטול מוחלט. */
  it("שיעור אפס אינו שגיאה", () => {
    expect(vatSplitFromGross(5000, 0)).toEqual({
      grossAgorot: 5000,
      netAgorot: 5000,
      vatAgorot: 0,
    });
  });

  it("סכום שלילי ושיעור לא הגיוני נדחים", () => {
    expect(() => vatSplitFromGross(-1, 18)).toThrow();
    expect(() => vatSplitFromGross(100, 101)).toThrow();
  });
});

describe("invoiceLineDescription", () => {
  it("מנוי מציין מחזור ומסלול", () => {
    expect(
      invoiceLineDescription({ purpose: "subscription", planLabel: "מקצועי", billingCycle: "yearly" }),
    ).toBe("מנוי שנתי — מסלול מקצועי");
  });

  it("מסלול שלא נמסר אינו מייצר מקף מיותם", () => {
    expect(invoiceLineDescription({ purpose: "subscription" })).toBe("מנוי חודשי");
  });

  it("קרדיטים והשכרת מספר מתוארים לפי מה שנקנה", () => {
    expect(invoiceLineDescription({ purpose: "credits", credits: 50 })).toContain("50 קרדיטים");
    expect(invoiceLineDescription({ purpose: "number_rental", phone: "0731234567" })).toContain(
      "0731234567",
    );
  });
});

describe("invoiceRetryDelayMs", () => {
  it("ההשהיה גדלה ואינה יורדת", () => {
    let previous = 0;
    for (let attempt = 0; attempt < INVOICE_MAX_ATTEMPTS; attempt += 1) {
      const delay = invoiceRetryDelayMs(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });

  it("מספר ניסיונות מעבר למכסה אינו מפיל", () => {
    expect(invoiceRetryDelayMs(99)).toBe(720 * 60 * 1000);
  });
});

describe("invoiceRejectionReason", () => {
  it("תשלום שנגבה מזכה במסמך", () => {
    expect(invoiceRejectionReason({ status: "paid", amountAgorot: 29900 })).toBeNull();
  });

  it("תשלום שלא נגבה ותשלום באפס אינם מזכים", () => {
    expect(invoiceRejectionReason({ status: "pending", amountAgorot: 29900 })).toContain("טרם נגבה");
    expect(invoiceRejectionReason({ status: "paid", amountAgorot: 0 })).toContain("אפס");
  });
});

describe("linetNoResults", () => {
  it("מזהה את הניסוח של לינט — כולל השגיאה ב-where", () => {
    expect(linetNoResults("No items where found for model")).toBe(true);
    expect(linetNoResults("No items were found for model")).toBe(true);
  });

  it("סובלני לרישיות, לרווחים ולצורת היחיד", () => {
    expect(linetNoResults("NO ITEM WHERE FOUND for model account")).toBe(true);
    expect(linetNoResults("no  items   were   found")).toBe(true);
  });

  /*
   * זה החלק שמגן: כשל הזדהות **אינו** תוצאה ריקה, ובליעה שלו הייתה
   * מחזירה „החיבור תקין” על מפתח שגוי — כלומר בדיוק הכישלון השקט
   * שהבדיקה קיימת כדי למנוע.
   */
  it("אינו בולע כישלון אמיתי", () => {
    expect(linetNoResults("Unauthorized")).toBe(false);
    expect(linetNoResults("login_hash: המפתח שגוי")).toBe(false);
    expect(linetNoResults("item_id: no such item")).toBe(false);
    expect(linetNoResults("")).toBe(false);
  });
});
