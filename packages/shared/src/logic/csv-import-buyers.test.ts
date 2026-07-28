import { describe, expect, it } from "vitest";
import { normalizeIsraeliPhone, parseBuyersCsv } from "./csv-import-buyers.js";

describe("normalizeIsraeliPhone", () => {
  it("מנרמל פורמטים מקומיים ל-E.164", () => {
    expect(normalizeIsraeliPhone("050-1234567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("050 123 4567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("03-6123456")).toBe("+97236123456");
    expect(normalizeIsraeliPhone("972501234567")).toBe("+972501234567");
    expect(normalizeIsraeliPhone("+972501234567")).toBe("+972501234567");
  });

  it("דוחה מספרים לא ישראליים או קצרים מדי", () => {
    expect(normalizeIsraeliPhone("12345")).toBeUndefined();
    expect(normalizeIsraeliPhone("+14155551234")).toBeUndefined();
    expect(normalizeIsraeliPhone("01-1234567")).toBeUndefined(); // קידומת 1 לא קיימת
  });
});

describe("parseBuyersCsv", () => {
  it("ממפה כותרות עבריות ומחלץ קונים", () => {
    const csv = [
      "שם,טלפון,ערים,סוג עסקה,תקציב,חדרים,בשלות,מימון",
      'ישראל ישראלי,050-1234567,"תל אביב; רמת גן",קנייה,2500000,3.5,חם,אישור עקרוני',
      "דנה כהן,052-7654321,חיפה,השכרה,6000,2,מתעניין,מזומן",
    ].join("\n");
    const { rows, unmappedHeaders } = parseBuyersCsv(csv);
    expect(unmappedHeaders).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe("ישראל ישראלי");
    expect(rows[0]?.phone).toBe("+972501234567");
    expect(rows[0]?.cities).toEqual(["תל אביב", "רמת גן"]);
    expect(rows[0]?.dealType).toBe("sale");
    expect(rows[0]?.budgetMaxAgorot).toBe(250_000_000); // ₪→אגורות
    expect(rows[0]?.roomsMin).toBe(3.5);
    expect(rows[0]?.maturity).toBe("hot");
    expect(rows[0]?.financing).toBe("pre_approved");
    expect(rows[1]?.dealType).toBe("rent");
    expect(rows[1]?.financing).toBe("cash");
  });

  it("ברירת מחדל: עסקת מכירה אם לא צוין", () => {
    const { rows } = parseBuyersCsv("שם,טלפון,עיר,תקציב\nרון,050-1111111,אשדוד,1800000");
    expect(rows[0]?.dealType).toBe("sale");
  });

  it("טלפון שלא ניתן לנרמל נשאר כמו שהוא — השרת ידחה עם שגיאה ברורה", () => {
    const { rows } = parseBuyersCsv("שם,טלפון,עיר,תקציב\nרון,אין,אשדוד,1800000");
    expect(rows[0]?.phone).toBe("אין");
  });

  it("מדווח כותרות לא מזוהות ו-CSV ריק", () => {
    expect(parseBuyersCsv("שם,שטויות\nא,ב").unmappedHeaders).toContain("שטויות");
    expect(parseBuyersCsv("").rows).toHaveLength(0);
  });
});
