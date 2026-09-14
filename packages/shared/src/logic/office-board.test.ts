import { describe, expect, it } from "vitest";
import {
  BOARD_WEIGHTS,
  boardFormulaText,
  boardMovement,
  boardScore,
  delta,
  goalPercent,
  initials,
  movementLabel,
  periodStart,
  periodTitle,
  previousPeriodTitle,
  superlative,
  superlativeNote,
} from "./office-board";

const counts = (over: Partial<Record<string, number>> = {}) => ({
  calls: 0,
  leads: 0,
  properties: 0,
  viewings: 0,
  deals: 0,
  ...over,
});

describe("הניקוד", () => {
  /*
   * ‎**הכיתוב והחישוב הם אותו מקור.** המסך מדפיס את הנוסחה מעל
   * ‏הטבלה; כיתוב שנכתב ביד היה מסכים ביום שנכתב ומשקר ביום
   * ‏שמישהו שינה משקל — וזה בדיוק הרגע שבו סוכן סופר ביד ומגלה
   * ‏שהמערכת לא מסכימה איתו.
   */
  it("הכיתוב נגזר מהמשקלים", () => {
    const text = boardFormulaText();
    for (const [metric, weight] of Object.entries(BOARD_WEIGHTS)) {
      expect(text, metric).toContain(`×${weight}`);
    }
  });

  it("המשקלים מוכפלים כפי שהוצהר", () => {
    expect(boardScore(counts({ leads: 41, properties: 9, viewings: 26, deals: 4 }))).toBe(
      41 * 1 + 9 * 3 + 26 * 2 + 4 * 10,
    );
  });

  /*
   * ‎**שיחות אינן בניקוד, וזו הכרעה.** ניקוד עליהן היה הופך חיוג
   * ‏לאסטרטגיה: מאה חיוגים ביום בלי גיוס היו מנצחים שלושה נכסים.
   */
  it("שיחות אינן משנות את הניקוד", () => {
    expect(boardScore(counts({ calls: 500 }))).toBe(0);
  });
});

describe("התנועה מול התקופה הקודמת", () => {
  /*
   * ‎**„ירידה” על מי שאין לו חודש קודם היא שקר**, ו„מתחת לקצב”
   * ‏בחודש הראשון היא קבלת פנים גרועה.
   */
  it("מי שהתחיל החודש אינו מדורג בשפת התנועה", () => {
    expect(boardMovement(9, null, 11)).toEqual({ kind: "new" });
    expect(movementLabel(boardMovement(9, null, 11))).toBe("חודש ראשון");
  });

  it("עלייה וירידה נמדדות במקומות", () => {
    expect(boardMovement(1, 3, 11)).toEqual({ kind: "up", places: 2 });
    expect(boardMovement(5, 4, 11)).toEqual({ kind: "down", places: 1 });
    expect(movementLabel({ kind: "up", places: 2 })).toBe("עלייה של 2 מקומות");
    expect(movementLabel({ kind: "down", places: 1 })).toBe("ירידה של מקום");
  });

  /*
   * ‏אותו מקום בשליש התחתון מקבל אמירה רכה; באמצע הטבלה „ללא
   * ‏שינוי” הוא התיאור הנכון ואין מה להוסיף עליו.
   */
  it("תחתית הטבלה מקבלת אמירה, והאמצע לא", () => {
    expect(boardMovement(9, 9, 11)).toEqual({ kind: "behind" });
    expect(boardMovement(5, 5, 11)).toEqual({ kind: "same" });
  });

  /* ‏ובטבלה קטנה אין „תחתית” — שליש משלושה הוא שורה אחת */
  it("טבלה קטנה אינה מייצרת „מתחת לקצב”", () => {
    expect(boardMovement(3, 3, 3)).toEqual({ kind: "same" });
  });

  /*
   * ‎**הניסוח אינו מטה מגדרית.** „עלה”/„עלתה” דורש לדעת את המגדר
   * ‏של אדם אמיתי, ושם פרטי אינו אומר אותו.
   */
  it("אף תווית אינה בצורה מוטה", () => {
    const labels = [
      movementLabel({ kind: "new" }),
      movementLabel({ kind: "up", places: 1 }),
      movementLabel({ kind: "up", places: 3 }),
      movementLabel({ kind: "down", places: 1 }),
      movementLabel({ kind: "same" }),
      movementLabel({ kind: "behind" }),
    ];
    for (const label of labels) {
      expect(label, label).not.toMatch(/עלה|עלתה|ירד|ירדה|שומר|שומרת|זקוק|זקוקה/u);
    }
  });
});

describe("„הכי הרבה”", () => {
  const rows = [
    { name: "דוד כהן", counts: counts({ leads: 41, calls: 214 }) },
    { name: "שירה מזרחי", counts: counts({ leads: 38, calls: 186 }) },
  ];

  it("המוביל והפער מהשני", () => {
    const top = superlative("leads", rows)!;
    expect(top.name).toBe("דוד כהן");
    expect(top.value).toBe(41);
    expect(superlativeNote(top)).toBe("+3 מהשני");
  });

  /*
   * ‎**כרטיס שמכריז על מוביל עם אפס הוא לעג.** במשרד שלא גייס
   * ‏אף נכס החודש, „הכי הרבה נכסים: דוד כהן, 0” גרוע מכלום.
   */
  it("מונה אפס אינו „הכי הרבה”", () => {
    expect(superlative("properties", rows)).toBeNull();
  });

  it("שוויון ויחיד נאמרים כפי שהם", () => {
    expect(superlativeNote({ metric: "leads", name: "א", value: 5, lead: 0 })).toContain("שוויון");
    expect(superlativeNote({ metric: "leads", name: "א", value: 5, lead: null })).toContain("היחיד");
  });
});

describe("היעד והתצוגה", () => {
  /* ‏בלי יעד אין אחוז: „0%” נראה ככישלון של מי שפשוט לא קבע יעד */
  it("בלי יעד אין אחוז", () => {
    expect(goalPercent(160, null)).toBeNull();
    expect(goalPercent(160, 0)).toBeNull();
  });

  it("והפס אינו גולש מעבר למאה", () => {
    expect(goalPercent(300, 100)).toBe(100);
    expect(goalPercent(89, 100)).toBe(89);
  });

  it("ראשי תיבות משתי מילים", () => {
    expect(initials("דוד כהן")).toBe('ד"כ');
    expect(initials("שירה מזרחי")).toBe('ש"מ');
    expect(initials("")).toBe("??");
  });
});

describe("התקופות", () => {
  /* 2026-08-14 בשעון ישראל */
  const now = new Date("2026-08-14T09:00:00.000Z");

  it("הכותרת וההשוואה", () => {
    expect(periodTitle("month", now)).toBe("אוגוסט 2026");
    expect(previousPeriodTitle("month", now)).toBe("יולי 2026");
    expect(periodTitle("quarter", now)).toBe("רבעון 3 2026");
    expect(previousPeriodTitle("quarter", now)).toBe("רבעון 2 2026");
    expect(periodTitle("year", now)).toBe("2026");
  });

  /* ‏גלישה לשנה הקודמת — ינואר מול דצמבר, ורבעון 1 מול רבעון 4 */
  it("ינואר משווה לדצמבר של השנה שעברה", () => {
    const january = new Date("2026-01-14T09:00:00.000Z");
    expect(previousPeriodTitle("month", january)).toBe("דצמבר 2025");
    expect(previousPeriodTitle("quarter", january)).toBe("רבעון 4 2025");
  });

  /*
   * ‎**תחילת התקופה נבנית מהמספר ולא בחיסור ימים.** „31 יום
   * ‏פעמיים” מדלג על פברואר ונוחת בחודש הלא נכון.
   */
  it("תחילת הרבעון היא החודש הראשון שלו", () => {
    const march = new Date("2026-03-20T09:00:00.000Z");
    const start = periodStart("quarter", march);
    expect(start.toISOString().slice(0, 7)).toBe("2025-12");
    expect(periodStart("year", march).toISOString().slice(0, 7)).toBe("2025-12");
  });
});

describe("המגמה", () => {
  it("הפרש ואחוז", () => {
    expect(delta(220, 196)).toEqual({ diff: 24, percent: 12 });
    expect(delta(15, 17)).toEqual({ diff: -2, percent: -12 });
  });

  /* ‏חלוקה באפס אינה „אינסוף אחוז” — היא „אין ממה להשוות” */
  it("בלי בסיס אין אחוז", () => {
    expect(delta(5, 0)).toEqual({ diff: 5, percent: null });
  });
});
