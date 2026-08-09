import { describe, expect, it } from "vitest";
import { hebrewDateFull, hebrewDateParts, hebrewDateShort, hebrewNumeral } from "./hebrew-date.js";

describe("hebrewNumeral", () => {
  it("יחידות", () => {
    expect(hebrewNumeral(1)).toBe("א׳");
    expect(hebrewNumeral(9)).toBe("ט׳");
  });

  it("עשרות ויחידות עם גרשיים", () => {
    expect(hebrewNumeral(12)).toBe("י״ב");
    expect(hebrewNumeral(29)).toBe("כ״ט");
  });

  it("עשר עגול", () => {
    expect(hebrewNumeral(10)).toBe("י׳");
    expect(hebrewNumeral(20)).toBe("כ׳");
  });

  it("ט״ו וט״ז ולא י״ה/י״ו — צירוף שם ה׳", () => {
    // זה לא קישוט: י״ה נראה שגוי לכל קורא עברית
    expect(hebrewNumeral(15)).toBe("ט״ו");
    expect(hebrewNumeral(16)).toBe("ט״ז");
  });

  it("שנה עברית", () => {
    expect(hebrewNumeral(786)).toBe("תשפ״ו");
    expect(hebrewNumeral(785)).toBe("תשפ״ה");
  });

  it("מאות מרובות", () => {
    expect(hebrewNumeral(800)).toBe("ת״ת");
  });

  it("ערך לא תקין מוחזר כמות שהוא ולא מתרסק", () => {
    expect(hebrewNumeral(0)).toBe("0");
    expect(hebrewNumeral(-3)).toBe("-3");
    expect(hebrewNumeral(Number.NaN)).toBe("NaN");
  });
});

describe("hebrewDateParts", () => {
  it("ממיר תאריך לועזי", () => {
    // 2026-08-09 הוא כ״ה באב תשפ״ו
    const parts = hebrewDateParts(new Date("2026-08-09T09:00:00Z"));
    expect(parts).not.toBeNull();
    expect(parts?.month).toBe("אב");
    expect(parts?.year).toBe(5786);
  });

  it("שם החודש בעברית ולא באנגלית", () => {
    const parts = hebrewDateParts(new Date("2026-10-01T09:00:00Z"));
    expect(parts?.month).toMatch(/^[֐-׿]/u);
  });

  it("תאריך לא תקין מחזיר null ולא זורק", () => {
    expect(hebrewDateParts(new Date("לא תאריך"))).toBeNull();
  });
});

describe("hebrewDateShort", () => {
  it("יום וחודש עם גרשיים", () => {
    const text = hebrewDateShort(new Date("2026-08-09T09:00:00Z"));
    expect(text).toContain("אב");
    expect(text).toMatch(/[׳״]/u);
  });

  it("תאריך לא תקין מחזיר מחרוזת ריקה ולא null", () => {
    // כדי שהקורא יוכל לשרשר בלי לבדוק
    expect(hebrewDateShort(new Date("---"))).toBe("");
  });
});

describe("hebrewDateFull", () => {
  it("כולל שנה בלי האלף", () => {
    const text = hebrewDateFull(new Date("2026-08-09T09:00:00Z"));
    expect(text).toContain("תשפ״ו");
    expect(text).not.toContain("ה׳תשפ״ו");
  });

  it("תאריך לא תקין מחזיר ריק", () => {
    expect(hebrewDateFull(new Date("---"))).toBe("");
  });

  it("חוצה חודש נכון סביב חצות ירושלים", () => {
    // שתי נקודות זמן ביום לועזי אחד חייבות לתת אותו יום עברי, כי
    // ההמרה מעוגנת לאזור הזמן של ישראל ולא ל-UTC
    const morning = hebrewDateFull(new Date("2026-08-09T06:00:00+03:00"));
    const evening = hebrewDateFull(new Date("2026-08-09T17:00:00+03:00"));
    expect(morning).toBe(evening);
  });
});
