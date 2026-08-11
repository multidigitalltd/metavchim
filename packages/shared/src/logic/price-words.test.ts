import { describe, expect, it } from "vitest";
import { priceInWords, priceInWordsWithCurrency } from "./price-words.js";

describe("priceInWords", () => {
  it("המקרה שבגללו זה נבנה — ספרה אחת עודפת נשמעת אחרת לגמרי", () => {
    expect(priceInWords(1_900_000)).toBe("מיליון ותשע מאות אלף");
    expect(priceInWords(19_000_000)).toBe("תשעה עשר מיליון");
  });

  it("מיליונים עגולים", () => {
    expect(priceInWords(1_000_000)).toBe("מיליון");
    expect(priceInWords(2_000_000)).toBe("שני מיליון");
    expect(priceInWords(3_000_000)).toBe("שלושה מיליון");
    expect(priceInWords(10_000_000)).toBe("עשרה מיליון");
  });

  it("אלפים — צורות הסמיכות", () => {
    expect(priceInWords(1_000)).toBe("אלף");
    expect(priceInWords(2_000)).toBe("אלפיים");
    expect(priceInWords(3_000)).toBe("שלושת אלפים");
    expect(priceInWords(5_000)).toBe("חמשת אלפים");
    expect(priceInWords(10_000)).toBe("עשרת אלפים");
  });

  it("אלפים מעל עשרה — צורה רגילה", () => {
    expect(priceInWords(20_000)).toBe("עשרים אלף");
    expect(priceInWords(100_000)).toBe("מאה אלף");
    expect(priceInWords(850_000)).toBe("שמונה מאות וחמישים אלף");
  });

  it("שכירות — סכומים קטנים", () => {
    expect(priceInWords(4_500)).toBe("ארבעת אלפים וחמש מאות");
    expect(priceInWords(7_800)).toBe("שבעת אלפים ושמונה מאות");
  });

  it("צירוף של שלושה חלקים", () => {
    expect(priceInWords(2_350_000)).toBe("שני מיליון ושלוש מאות וחמישים אלף");
  });

  it("עשרה עד עשרים — צורות מיוחדות", () => {
    expect(priceInWords(15_000)).toBe("חמישה עשר אלף");
    expect(priceInWords(12_000_000)).toBe("שנים עשר מיליון");
  });

  it("שדה ריק או ערך לא תקין אינו מציג דבר", () => {
    expect(priceInWords(0)).toBe("");
    expect(priceInWords(-5)).toBe("");
    expect(priceInWords(Number.NaN)).toBe("");
  });

  it("מעל התקרה — אין טעם במילים", () => {
    expect(priceInWords(1_000_000_000)).toBe("");
  });

  it("הגרסה עם המטבע", () => {
    expect(priceInWordsWithCurrency(1_900_000)).toBe("מיליון ותשע מאות אלף ₪");
    expect(priceInWordsWithCurrency(0)).toBe("");
  });
});
