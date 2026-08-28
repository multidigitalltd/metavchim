import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAT_PERCENT,
  INVOICE_MAX_ATTEMPTS,
  invoiceLineDescription,
  invoiceRejectionReason,
  invoiceRetryDelayMs,
  grossFromNet,
  linetNoResults,
  vatSplitFromGross,
  vatSplitFromNet,
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

describe("vatSplitFromNet", () => {
  it("מוסיף מע\"מ מעל מחיר המחירון", () => {
    // 149 ₪ במחירון ⟵ 175.82 ₪ לחיוב
    expect(vatSplitFromNet(14_900, 18)).toEqual({
      netAgorot: 14_900,
      vatAgorot: 2_682,
      grossAgorot: 17_582,
    });
  });

  it("הנטו נשאר בדיוק המספר שהוצג", () => {
    /*
     * ‎`Math.round` על **המע"מ** ולא על הנטו: אילו העיגול היה על
     * הנטו, שורת החשבונית הייתה יכולה לצאת 148.99 ₪ על מחירון של
     * 149 — מספר שאיש לא הבטיח ואי אפשר להסביר.
     */
    for (const net of [1, 99, 14_900, 29_900, 59_900, 149_000, 1_234_567]) {
      const split = vatSplitFromNet(net, DEFAULT_VAT_PERCENT);
      expect(split.netAgorot).toBe(net);
      expect(split.netAgorot + split.vatAgorot).toBe(split.grossAgorot);
    }
  });

  it("שיעור אפס מחזיר ברוטו זהה לנטו", () => {
    expect(vatSplitFromNet(5000, 0)).toEqual({
      grossAgorot: 5000,
      netAgorot: 5000,
      vatAgorot: 0,
    });
  });

  it("סכום שלילי ושיעור לא הגיוני נדחים", () => {
    expect(() => vatSplitFromNet(-1, 18)).toThrow();
    expect(() => vatSplitFromNet(100, 101)).toThrow();
  });

  it("grossFromNet הוא הברוטו של אותו פירוק", () => {
    expect(grossFromNet(14_900, 18)).toBe(17_582);
    expect(grossFromNet(0, 18)).toBe(0);
  });
});

describe("המעגל בין המחירון לחשבונית", () => {
  /**
   * ‎**זו הבדיקה שמחזיקה את כל המהלך.**
   *
   * המחיר נקוב נטו, החיוב הוא ברוטו, והמסמך נבנה מהברוטו שנגבה
   * בפועל — ולא מהמחיר המקורי, כי המסמך **חייב** להסתכם בדיוק בסכום
   * שקארדקום גבתה. כלומר הנטו עובר מסלול הלוך-ושוב, ואם הוא חוזר
   * שונה באגורה אחת, שורת החשבונית שונה מהמחיר שהובטח — פער שמתגלה
   * שנה אחרי, בהתאמת הספרים, ואי אפשר לתקן רטרואקטיבית.
   *
   * הבדיקה סורקת טווח רציף ולא דוגמאות: אגורה שנופלת נופלת בערך
   * מסוים, ודוגמאות עגולות הן בדיוק אלה שלא יתפסו אותה.
   */
  /*
   * ‎`expect` בתוך הלולאה היה הופך את הסריקה לשתי שניות; האיסוף
   * ואז טענה אחת גם מהיר וגם נותן הודעת כישלון שימושית — הערך
   * שנפל, ולא רק „ציפינו ל-X”.
   */
  function firstBreak(percent: number, from: number, to: number): number | null {
    for (let net = from; net <= to; net++) {
      const gross = grossFromNet(net, percent);
      const back = vatSplitFromGross(gross, percent);
      if (back.netAgorot !== net || back.vatAgorot !== gross - net) return net;
    }
    return null;
  }

  it("כל נטו חוזר מהברוטו בדיוק — בכל שיעור", () => {
    for (const percent of [0, 17, 18, 25]) {
      expect(
        firstBreak(percent, 0, 20_000),
        `בשיעור ${percent}% יש נטו שאינו חוזר מהברוטו`,
      ).toBeNull();
    }
  });

  it("גם על סכומים גדולים — מנוי שנתי ורכישת קרדיטים", () => {
    // 1,000–1,300 ₪: הטווח של מנוי שנתי וחבילת קרדיטים גדולה
    expect(firstBreak(DEFAULT_VAT_PERCENT, 100_000, 130_000)).toBeNull();
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
