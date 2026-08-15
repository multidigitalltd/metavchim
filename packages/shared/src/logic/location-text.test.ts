import { describe, expect, it } from "vitest";
import {
  bestLocationMatch,
  locationNameScore,
  locationNameVariants,
  normalizeLocationName,
} from "./location-text.js";

describe("normalizeLocationName", () => {
  it("מקף ורווח כפול אינם הבדל", () => {
    expect(normalizeLocationName("רמת-גן")).toBe(normalizeLocationName("רמת  גן"));
  });

  it("גרשיים נעלמים", () => {
    expect(normalizeLocationName('באר שבע')).toBe(normalizeLocationName("באר שבע"));
    expect(normalizeLocationName("ת״א")).toBe("תל אביב יפו");
  });

  it("נקודה בקיצור הופכת לרווח ולא נבלעת", () => {
    expect(normalizeLocationName("ק. גת")).toBe("ק גת");
  });

  it("כתיב מלא וחסר", () => {
    expect(normalizeLocationName("קריית אונו")).toBe("קרית אונו");
    expect(normalizeLocationName("פתח תקוה")).toBe("פתח תקווה");
  });

  it("שם חלופי מתכנס לקנוני", () => {
    expect(normalizeLocationName("תל אביב")).toBe("תל אביב יפו");
    expect(normalizeLocationName("תל אביב-יפו")).toBe("תל אביב יפו");
  });

  it("רווחים בקצוות", () => {
    expect(normalizeLocationName("  חיפה  ")).toBe("חיפה");
  });

  it("קלט ריק אינו מפיל", () => {
    expect(normalizeLocationName("")).toBe("");
    expect(normalizeLocationName("   ")).toBe("");
  });
});

describe("locationNameScore", () => {
  it("זהה אחרי נרמול — ניקוד מלא", () => {
    expect(locationNameScore("רמת גן", "רמת-גן")).toBe(1);
    expect(locationNameScore("תל אביב", "תל אביב יפו")).toBe(1);
    expect(locationNameScore("קריית אונו", "קרית אונו")).toBe(1);
  });

  it("ערים שונות — אפס", () => {
    expect(locationNameScore("רמת גן", "רמת השרון")).toBe(0);
    expect(locationNameScore("חיפה", "חדרה")).toBe(0);
  });

  it("הכלה מנקדת פחות מזהות — כדי שהמדויק יעלה מעליה", () => {
    const partial = locationNameScore("גן יבנה", "יבנה");
    expect(partial).toBe(0.85);
    expect(partial).toBeLessThan(locationNameScore("יבנה", "יבנה"));
  });

  it("מילה קצרה מדי אינה 'מוכלת' בכל דבר", () => {
    // "גן" מוכל טכנית ב"גן יבנה", אבל שתי אותיות הן רעש ולא שם
    expect(locationNameScore("גן", "גן יבנה")).toBe(0);
  });

  it("צד ריק אינו מתאים לכלום", () => {
    expect(locationNameScore("", "חיפה")).toBe(0);
    expect(locationNameScore("חיפה", "  ")).toBe(0);
  });
});

describe("bestLocationMatch", () => {
  it("בוחר את הטוב ביותר מהרשימה", () => {
    const out = bestLocationMatch("תל אביב יפו", ["חיפה", "ת״א", "רמת גן"]);
    expect(out.score).toBe(1);
    expect(out.matched).toBe("ת״א");
  });

  it("מחזיר את מה שהמשתמש הקליד ולא את הצורה הקנונית", () => {
    // ההסבר נקרא בידי אדם — הוא צריך לראות את המילים שלו
    expect(bestLocationMatch("רמת גן", ["רמת-גן"]).matched).toBe("רמת-גן");
  });

  it("מעדיף זהות על הכלה גם כשההכלה מופיעה ראשונה", () => {
    const out = bestLocationMatch("יבנה", ["גן יבנה", "יבנה"]);
    expect(out.score).toBe(1);
    expect(out.matched).toBe("יבנה");
  });

  it("רשימה ריקה — אין התאמה ואין שדה matched", () => {
    expect(bestLocationMatch("חיפה", [])).toEqual({ score: 0 });
  });

  it("אף מועמד אינו מתאים", () => {
    expect(bestLocationMatch("חיפה", ["אילת", "דימונה"])).toEqual({ score: 0 });
  });
});

describe("locationNameVariants", () => {
  it("כולל את הקנוני, את המקורי ואת הצורה עם מקף", () => {
    const out = locationNameVariants("רמת גן");
    expect(out).toContain("רמת גן");
    expect(out).toContain("רמת-גן");
  });

  it("מרחיב שם חלופי לכל הכתיבים שמתכנסים אליו", () => {
    // שורה ישנה שנשמרה כ"תל אביב" חייבת להימצא בשאילתה על הקנוני
    const out = locationNameVariants("תל אביב יפו");
    expect(out).toContain("תל אביב");
    expect(out).toContain("תא");
  });

  it("שם ריק — רשימה ריקה ולא שאילתה על הכל", () => {
    expect(locationNameVariants("  ")).toEqual([]);
  });
});
