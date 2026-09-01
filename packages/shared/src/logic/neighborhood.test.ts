import { describe, expect, it } from "vitest";
import {
  mergeNeighborhoodUses,
  neighborhoodKey,
  neighborhoodMatches,
  normalizeNeighborhood,
  suggestNeighborhoods,
} from "./neighborhood.js";

describe("normalizeNeighborhood", () => {
  it("מנקה רווחים בקצוות ורווחים כפולים", () => {
    expect(normalizeNeighborhood("  רמת   אהרון ")).toBe("רמת אהרון");
  });

  /*
   * ‎**מה שהוקלד נשמר.** זו ההבחנה שכל הקובץ עומד עליה: הניקוי אינו
   * מתקן כתיב ואינו מוריד גרש — הוא רק מוריד מה שאינו נראה על המסך.
   */
  it("אינו נוגע בגרש, בכתיב או בקידומת", () => {
    expect(normalizeNeighborhood("שכונת שיכון ג'")).toBe("שכונת שיכון ג'");
  });
});

describe("neighborhodKey — ארבע צורות, שכונה אחת", () => {
  /* בדיוק המקרה שהמשתמש תיאר. */
  it("גרש בכל צורותיו, וקידומת „שכונת”", () => {
    const forms = ["שיכון ג", "שיכון ג'", "שיכון ג׳", "שכונת שיכון ג'", "  שיכון   ג  "];
    const keys = new Set(forms.map(neighborhoodKey));
    expect(keys.size).toBe(1);
  });

  it("גרשיים בשתי הצורות", () => {
    expect(neighborhoodKey('רמת ח"ן')).toBe(neighborhoodKey("רמת ח״ן"));
  });

  it("מקף עברי ומקף רגיל ורווח", () => {
    expect(neighborhoodKey("נווה-צדק")).toBe(neighborhoodKey("נווה צדק"));
    expect(neighborhoodKey("נווה־צדק")).toBe(neighborhoodKey("נווה צדק"));
  });

  /*
   * ‎**קיפול-יתר מאחד שכונות אמיתיות**, וזה נזק גרוע מכפילות: המתווך
   * אינו יכול להפריד בחזרה מה שהמערכת איחדה. הבדיקה הזו מקבעת את
   * הגבול.
   */
  it("אינו מאחד שמות שהם באמת שונים", () => {
    expect(neighborhoodKey("רמת גן")).not.toBe(neighborhoodKey("רמות גן"));
    expect(neighborhoodKey("בית הכרם")).not.toBe(neighborhoodKey("בית כרם"));
    expect(neighborhoodKey("נווה שאנן")).not.toBe(neighborhoodKey("נווה שרת"));
  });

  it("סימני פיסוק בלבד אינם שם", () => {
    expect(neighborhoodKey("'''")).toBe("");
    expect(neighborhoodKey("   ")).toBe("");
  });
});

describe("neighborhoodMatches", () => {
  it("תחילית של המילה הראשונה — המקרה שתואר", () => {
    expect(neighborhoodMatches("שיכון ג'", "שיכון")).toBe(true);
  });

  it("תחילית של מילה פנימית — מי שזוכר את החלק המזהה", () => {
    expect(neighborhoodMatches("רמת אהרון", "אהרון")).toBe(true);
  });

  /*
   * תת-מחרוזת חופשית מחזירה רשימה שאי אפשר לסרוק, וזה מה שגורם
   * להתעלם מההצעות ולהקליד מחדש — כלומר להחזיר את הכפילות.
   */
  it("אינו תופס אמצע של מילה", () => {
    expect(neighborhoodMatches("רמת אהרון", "מת")).toBe(false);
    expect(neighborhoodMatches("רמת אהרון", "הרון")).toBe(false);
  });

  /*
   * ‎**הרגרסיה שקודקס תפס.** הצורה הראשונה השוותה כל מילה בנפרד,
   * ולכן ברגע שהמתווך הקליד רווח ועבר למילה השנייה ההצעה נעלמה —
   * בדיוק כשהוא היה באמצע לכתוב אותה. שם שכונה רב-מילתי הוא הרוב,
   * לא קצה.
   */
  it("שאילתה רב-מילתית ממשיכה להתאים תוך כדי הקלדה", () => {
    for (const typed of ["ר", "רמ", "רמת", "רמת ", "רמת א", "רמת אה", "רמת אהרון"]) {
      expect(neighborhoodMatches("רמת אהרון", typed), typed).toBe(true);
    }
  });

  it("רב-מילתית מגבול מילה פנימי", () => {
    expect(neighborhoodMatches("קריית שמונה עיר", "שמונה ע")).toBe(true);
  });

  it("רב-מילתית שאינה מתחילה בגבול מילה אינה מתאימה", () => {
    expect(neighborhoodMatches("רמת אהרון", "מת אהרון")).toBe(false);
  });

  it("שאילתה ריקה מחזירה הכול", () => {
    expect(neighborhoodMatches("רמת אהרון", "  ")).toBe(true);
  });

  it("גרש בשאילתה אינו מונע התאמה", () => {
    expect(neighborhoodMatches("שיכון ג", "שיכון ג'")).toBe(true);
  });
});

describe("mergeNeighborhoodUses", () => {
  /*
   * ‎**הצורה הנפוצה מנצחת** — לא הראשונה ולא הקצרה. ההצעה צריכה
   * להיות זו שהמשרד כבר מדבר בה.
   */
  it("בוחר את הצורה שכתובה הכי הרבה, וסוכם את המונים", () => {
    const merged = mergeNeighborhoodUses([
      { name: "שיכון ג", count: 1 },
      { name: "שיכון ג'", count: 10 },
      { name: "שכונת שיכון ג׳", count: 2 },
    ]);
    expect(merged).toEqual([{ name: "שיכון ג'", count: 13 }]);
  });

  it("מדרג לפי שכיחות", () => {
    const merged = mergeNeighborhoodUses([
      { name: "פרדס כץ", count: 2 },
      { name: "רמת אהרון", count: 9 },
    ]);
    expect(merged.map((u) => u.name)).toEqual(["רמת אהרון", "פרדס כץ"]);
  });

  it("זורק ערכים ריקים ומונים לא חיוביים", () => {
    expect(mergeNeighborhoodUses([{ name: "  ", count: 5 }, { name: "רמת אהרון", count: 0 }])).toEqual([]);
  });

  /* אותם נתונים ⟵ אותה תוצאה, גם כששני מונים שווים. */
  it("שוויון נשבר יציב לפי אלפבית", () => {
    const once = mergeNeighborhoodUses([
      { name: "בבב", count: 3 },
      { name: "אאא", count: 3 },
    ]);
    const twice = mergeNeighborhoodUses([
      { name: "אאא", count: 3 },
      { name: "בבב", count: 3 },
    ]);
    expect(once).toEqual(twice);
  });
});

describe("suggestNeighborhoods", () => {
  const vocabulary = [
    { name: "שיכון ג'", count: 10 },
    { name: "שיכון ה", count: 4 },
    { name: "רמת אהרון", count: 7 },
    { name: "פרדס כץ", count: 3 },
  ];

  it("המקרה שתואר: „שיכון” מציג את מה שכבר הוזן", () => {
    expect(suggestNeighborhoods(vocabulary, "שיכון")).toEqual(["שיכון ג'", "שיכון ה"]);
  });

  /*
   * הצעה שזהה למה שכבר בשדה היא שורה שאי אפשר לעשות בה כלום, והיא
   * דוחקת הצעה אמיתית מהרשימה.
   */
  it("אינו מציע את מה שכבר הוקלד במלואו", () => {
    expect(suggestNeighborhoods(vocabulary, "שיכון ג'")).toEqual([]);
    expect(suggestNeighborhoods(vocabulary, "שיכון ג")).toEqual([]);
  });

  it("מכבד תקרה", () => {
    expect(suggestNeighborhoods(vocabulary, "", 2)).toHaveLength(2);
    expect(suggestNeighborhoods(vocabulary, "", 0)).toEqual([]);
  });

  it("אוצר ריק אינו נופל", () => {
    expect(suggestNeighborhoods([], "שיכון")).toEqual([]);
  });
});
