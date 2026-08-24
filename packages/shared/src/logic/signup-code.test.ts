import { describe, expect, it } from "vitest";
import { normalizeSignupCode, SIGNUP_CODE_LENGTH } from "./signup-code";

/**
 * מה שנבדק כאן הוא **שקוד נכון שהודבק אינו נדחה.**
 *
 * הדחייה הזו אינה נראית כמו באג: המשתמש רואה „קוד שגוי” על קוד
 * שהוא מעתיק מול העיניים, מנסה שוב, שורף ניסיונות ונוטש. לכן
 * הבדיקות כאן עוסקות בעיקר במה שנדבק לקוד בדרך מתיבת הדואר.
 */

describe("normalizeSignupCode", () => {
  it("קוד נקי עובר כמות שהוא", () => {
    expect(normalizeSignupCode("123456")).toBe("123456");
  });

  it("רווחים ומקפים שהמשתמש הוסיף אינם פוסלים", () => {
    expect(normalizeSignupCode(" 123 456 ")).toBe("123456");
    expect(normalizeSignupCode("123-456")).toBe("123456");
  });

  it("סימני כיווניות בלתי-נראים מהעתקה מדואר בעברית מוסרים", () => {
    /*
     * זה המקרה שאי אפשר לאבחן מהמסך: המשתמש רואה שש ספרות, השרת
     * מקבל שמונה תווים. ה-RLM נדבק כמעט תמיד להעתקה של ספרות
     * מתוך פסקה בעברית.
     */
    expect(normalizeSignupCode("\u200f123456\u200e")).toBe("123456");
    expect(normalizeSignupCode("\u2066123456\u2069")).toBe("123456");
  });

  it("אורך שגוי נדחה", () => {
    expect(normalizeSignupCode("12345")).toBeNull();
    expect(normalizeSignupCode("1234567")).toBeNull();
  });

  it("מחרוזת ריקה אינה קוד", () => {
    /*
     * הבחנה חשובה: קוד ריק שנשלח לשרת נראה שם כמו ניסיון אמיתי,
     * ושורף אחד מחמשת הניסיונות של המשתמש.
     */
    expect(normalizeSignupCode("")).toBeNull();
    expect(normalizeSignupCode("      ")).toBeNull();
  });

  it("תווים שאינם ספרות נדחים ולא „מנוקים”", () => {
    expect(normalizeSignupCode("12345a")).toBeNull();
    expect(normalizeSignupCode("١٢٣٤٥٦")).toBeNull();
  });

  it("האורך המוצהר הוא זה שנאכף", () => {
    expect(normalizeSignupCode("9".repeat(SIGNUP_CODE_LENGTH))).toBe(
      "9".repeat(SIGNUP_CODE_LENGTH),
    );
  });
});
