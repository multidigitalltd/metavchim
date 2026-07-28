import { describe, expect, it } from "vitest";
import { parseCsvLine, parsePropertiesCsv, parseShekelsToAgorot } from "./csv-import.js";

describe("parseShekelsToAgorot", () => {
  it("שומר על נקודה עשרונית ומפריד אלפים", () => {
    expect(parseShekelsToAgorot("6,000.00")).toBe(600_000); // 6,000₪
    expect(parseShekelsToAgorot("2,650,000")).toBe(265_000_000);
    expect(parseShekelsToAgorot("₪ 1,234.5")).toBe(123_450);
    expect(parseShekelsToAgorot("2650000")).toBe(265_000_000);
  });

  it("דוחה ערכים לא מספריים או אפס — עדיף לדלג מלייבא סכום שגוי", () => {
    expect(parseShekelsToAgorot("אין")).toBeUndefined();
    expect(parseShekelsToAgorot("0")).toBeUndefined();
    expect(parseShekelsToAgorot("1.234.567")).toBeUndefined();
  });
});

describe("parseCsvLine", () => {
  it("מפרק פסיקים פשוטים", () => {
    expect(parseCsvLine("בני ברק,רבי עקיבא,4")).toEqual(["בני ברק", "רבי עקיבא", "4"]);
  });

  it("תומך בגרשיים עם פסיק בתוך שדה", () => {
    expect(parseCsvLine('"דירה, משופצת",100')).toEqual(["דירה, משופצת", "100"]);
  });
});

describe("parsePropertiesCsv", () => {
  it("ממפה כותרות עבריות ומחלץ נכסים", () => {
    const csv = [
      "עיר,שכונה,רחוב,חדרים,מחיר,סוג",
      "בני ברק,פרדס כץ,רבי עקיבא,4,2650000,דירה",
      "ירושלים,רמות,הרב שך,3.5,3200000,דירת גן",
    ].join("\n");
    const { rows } = parsePropertiesCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fields.city).toBe("בני ברק");
    expect(rows[0]?.fields.rooms).toBe(4);
    expect(rows[0]?.fields.priceAgorot).toBe(265_000_000); // ₪→אגורות
    expect(rows[0]?.fields.propertyType).toBe("apartment");
    expect(rows[0]?.fields.dealType).toBe("sale"); // נגזר מהמחיר
    expect(rows[1]?.fields.rooms).toBe(3.5);
    expect(rows[1]?.fields.propertyType).toBe("garden_apartment");
  });

  it("מדווח על כותרות לא מזוהות", () => {
    const { unmappedHeaders } = parsePropertiesCsv("עיר,בלגן,מחיר\nחיפה,x,100");
    expect(unmappedHeaders).toContain("בלגן");
  });

  it("CSV ריק ⇒ אפס שורות", () => {
    expect(parsePropertiesCsv("").rows).toHaveLength(0);
    expect(parsePropertiesCsv("עיר,מחיר").rows).toHaveLength(0); // רק כותרת
  });

  it("שדות ריקים בשורה מדולגים בלי קריסה", () => {
    const { rows } = parsePropertiesCsv("עיר,חדרים,מחיר\nחיפה,,");
    expect(rows[0]?.fields.city).toBe("חיפה");
    expect(rows[0]?.fields.rooms).toBeUndefined();
  });
});
