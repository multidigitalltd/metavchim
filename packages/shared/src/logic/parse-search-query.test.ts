import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "./parse-search-query.js";

describe("parseSearchQuery", () => {
  it("מפרק את השאילתה שהמתווך באמת מקליד", () => {
    const parsed = parseSearchQuery("קונים 4 חדרים בני ברק");
    expect(parsed.entity).toBe("buyers");
    expect(parsed.dealType).toBe("sale");
    expect(parsed.rooms).toEqual({ min: 4, max: 4 });
    expect(parsed.city).toBe("בני ברק");
    expect(parsed.structured).toBe(true);
    // לא נשאר זבל שיצמצם את התוצאות בחיפוש הטקסטואלי
    expect(parsed.rest).toBe("");
  });

  it("שוכרים מצמצם לשכירות ולא למכירה", () => {
    const parsed = parseSearchQuery("שוכרים 3 חדרים ירושלים");
    expect(parsed.entity).toBe("buyers");
    expect(parsed.dealType).toBe("rent");
    expect(parsed.city).toBe("ירושלים");
  });

  it("מזהה נכסים ולא קונים", () => {
    expect(parseSearchQuery("דירות 5 חדרים אשדוד").entity).toBe("properties");
    expect(parseSearchQuery("לידים חיפה").entity).toBe("leads");
  });

  it("תקרת תקציב לא נקראת כמספר חדרים", () => {
    const parsed = parseSearchQuery("קונים עד 2 מיליון תל אביב");
    expect(parsed.budget).toEqual({ maxAgorot: 200_000_000 });
    expect(parsed.rooms).toBeUndefined();
    expect(parsed.city).toBe("תל אביב");
  });

  it("טווח מחיר משני צדדים", () => {
    const parsed = parseSearchQuery("קונים בין 1 ל-2 מיליון");
    expect(parsed.budget).toEqual({ minAgorot: 100_000_000, maxAgorot: 200_000_000 });
  });

  it("רצפת תקציב", () => {
    expect(parseSearchQuery("נכסים מעל 850 אלף").budget).toEqual({ minAgorot: 85_000_000 });
  });

  it("סכום עירום עם יחידה נקרא כתקרה", () => {
    expect(parseSearchQuery("קונים 2 מיליון").budget).toEqual({ maxAgorot: 200_000_000 });
  });

  it("מספר בלי יחידה אינו סכום — הוא חדרים", () => {
    const parsed = parseSearchQuery("קונים 4 חדרים");
    expect(parsed.budget).toBeUndefined();
    expect(parsed.rooms).toEqual({ min: 4, max: 4 });
  });

  it("טווח חדרים וגבולות", () => {
    expect(parseSearchQuery("דירות 3-4 חדרים").rooms).toEqual({ min: 3, max: 4 });
    expect(parseSearchQuery("קונים מ-4 חדרים").rooms).toEqual({ min: 4 });
    expect(parseSearchQuery("קונים עד 3 חדרים").rooms).toEqual({ max: 3 });
  });

  it("חצאי חדרים ומילים בעברית", () => {
    expect(parseSearchQuery("דירה 3.5 חדרים").rooms).toEqual({ min: 3.5, max: 3.5 });
    expect(parseSearchQuery("דירה 3 וחצי חדרים").rooms).toEqual({ min: 3.5, max: 3.5 });
    expect(parseSearchQuery("ארבעה חדרים").rooms).toEqual({ min: 4, max: 4 });
  });

  it("עיר דו-מילית מנצחת חלק ממנה", () => {
    expect(parseSearchQuery("קונים מודיעין עילית").city).toBe("מודיעין עילית");
  });

  it("שם לקוח נשאר בשארית וממשיך לחיפוש הרגיל", () => {
    const parsed = parseSearchQuery("קונים כהן בני ברק");
    expect(parsed.entity).toBe("buyers");
    expect(parsed.city).toBe("בני ברק");
    expect(parsed.rest).toBe("כהן");
  });

  it("טקסט חופשי רגיל אינו מסומן כמובְנה", () => {
    const parsed = parseSearchQuery("דוד לוי");
    expect(parsed.structured).toBe(false);
    expect(parsed.rest).toBe("דוד לוי");
  });

  it("שאילתה ריקה אינה מפילה כלום", () => {
    expect(parseSearchQuery("   ")).toEqual({ rest: "", structured: false });
  });
});
