import { describe, expect, it } from "vitest";
import {
  describeFilters,
  freeTextTerms,
  matchesFreeText,
  normalizeRange,
  priceRangeAgorot,
  rangesOverlap,
} from "./list-filters.js";

describe("normalizeRange", () => {
  it("טווח תקין עובר כמות שהוא", () => {
    expect(normalizeRange(2, 5)).toEqual({ min: 2, max: 5 });
  });

  it("צד אחד בלבד", () => {
    expect(normalizeRange(3, undefined)).toEqual({ min: 3 });
    expect(normalizeRange(undefined, 4)).toEqual({ max: 4 });
  });

  it("מינימום גדול ממקסימום מוחלף — אפס תוצאות נראה כמו מערכת שבורה", () => {
    expect(normalizeRange(5, 2)).toEqual({ min: 2, max: 5 });
  });

  it("ערך שלילי נזרק", () => {
    expect(normalizeRange(-1, 5)).toEqual({ max: 5 });
  });

  it("אפס הוא ערך תקין ולא נזרק", () => {
    expect(normalizeRange(0, 5)).toEqual({ min: 0, max: 5 });
  });

  it("NaN ואינסוף נזרקים", () => {
    expect(normalizeRange(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({});
  });

  it("בלי כלום מחזיר טווח ריק", () => {
    expect(normalizeRange(undefined, undefined)).toEqual({});
  });
});

describe("priceRangeAgorot", () => {
  it("ממיר שקלים לאגורות", () => {
    expect(priceRangeAgorot(1_000_000, 2_400_000)).toEqual({
      min: 100_000_000,
      max: 240_000_000,
    });
  });

  it("מחליף גם אחרי ההמרה", () => {
    expect(priceRangeAgorot(2_400_000, 1_000_000)).toEqual({
      min: 100_000_000,
      max: 240_000_000,
    });
  });

  it("מעגל שברי שקל ולא קוטע אותם", () => {
    // 1.6 ₪ = 160 אגורות; קטיעה הייתה נותנת 160 גם ל-1.69
    expect(priceRangeAgorot(1.6, undefined).min).toBe(160);
    expect(priceRangeAgorot(1.69, undefined).min).toBe(169);
  });
});

describe("freeTextTerms", () => {
  it("מפרק לפי רווחים", () => {
    expect(freeTextTerms("פנטהאוז רמת גן")).toEqual(["פנטהאוז", "רמת", "גן"]);
  });

  it("מוריד כפילויות", () => {
    expect(freeTextTerms("גן גן")).toEqual(["גן"]);
  });

  it("מונח בן תו אחד נזרק — הוא מתאים לכל דבר", () => {
    expect(freeTextTerms("א דירה")).toEqual(["דירה"]);
  });

  it("ריק או רווחים בלבד", () => {
    expect(freeTextTerms("")).toEqual([]);
    expect(freeTextTerms("   ")).toEqual([]);
    expect(freeTextTerms(undefined)).toEqual([]);
  });

  it("חוסם שאילתה עם עשרות מונחים", () => {
    expect(freeTextTerms("אא בב גג דד הה וו זז חח").length).toBe(6);
  });
});

describe("matchesFreeText", () => {
  const property = ["פנטהאוז", "רמת גן", "מרפסת שמש ענקית", null];

  it("כל המונחים חייבים להתאים — אבל כל אחד בשדה אחר", () => {
    // זו ההחלטה המרכזית: "פנטהאוז רמת גן" הם שני מונחים בשני שדות
    expect(matchesFreeText(property, ["פנטהאוז", "רמת"])).toBe(true);
  });

  it("מונח שלא נמצא בשום שדה פוסל", () => {
    expect(matchesFreeText(property, ["פנטהאוז", "חיפה"])).toBe(false);
  });

  it("מוצא גם באמצע מחרוזת", () => {
    expect(matchesFreeText(property, ["שמש"])).toBe(true);
  });

  it("בלי מונחים הכול תואם", () => {
    expect(matchesFreeText(property, [])).toBe(true);
  });

  it("שדות ריקים או null לא מפילים", () => {
    expect(matchesFreeText([null, undefined, ""], ["משהו"])).toBe(false);
  });

  it("לא רגיש לאותיות גדולות", () => {
    expect(matchesFreeText(["Penthouse"], ["penthouse"])).toBe(true);
  });
});

describe("describeFilters", () => {
  it("טווח מלא", () => {
    expect(describeFilters({ price: { min: 1000000, max: 2000000 } })).toContain("–");
  });

  it("מינימום בלבד", () => {
    expect(describeFilters({ rooms: { min: 3 } })).toBe("מ-3 חד׳");
  });

  it("מקסימום בלבד", () => {
    expect(describeFilters({ rooms: { max: 5 } })).toBe("עד 5 חד׳");
  });

  it("מחבר את כל החלקים", () => {
    const text = describeFilters({ terms: ["גן"], rooms: { min: 3 }, price: { max: 2000000 } });
    expect(text).toContain("גן");
    expect(text).toContain("3 חד׳");
    expect(text).toContain("·");
  });

  it("בלי סינון מחזיר ריק", () => {
    expect(describeFilters({})).toBe("");
  });
});

describe("rangesOverlap", () => {
  it("טווחים שנחתכים", () => {
    // קונה עם תקציב 1.5–2.5 רלוונטי לחיפוש 1–2
    expect(rangesOverlap({ min: 1.5, max: 2.5 }, { min: 1, max: 2 })).toBe(true);
  });

  it("טווחים זרים", () => {
    expect(rangesOverlap({ min: 3, max: 4 }, { min: 1, max: 2 })).toBe(false);
  });

  it("נגיעה בקצה נחשבת חפיפה — הקונים שבגבול הם המעניינים", () => {
    expect(rangesOverlap({ min: 2, max: 3 }, { min: 1, max: 2 })).toBe(true);
  });

  it("טווח פתוח מצד אחד", () => {
    expect(rangesOverlap({ min: 5 }, { max: 10 })).toBe(true);
    expect(rangesOverlap({ min: 5 }, { max: 3 })).toBe(false);
  });

  it("שני טווחים פתוחים תמיד נחתכים", () => {
    expect(rangesOverlap({}, {})).toBe(true);
  });
});
