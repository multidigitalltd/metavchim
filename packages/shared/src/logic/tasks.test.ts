import { describe, expect, it } from "vitest";
import {
  compareTasks,
  groupTasksByBucket,
  isTaskUrgent,
  taskBucket,
  taskEntityHref,
} from "./tasks.js";

/*
 * הזמנים מוגדרים ב-UTC ולא בשעון המקומי של המריץ: הבדיקה חייבת
 * להיות אותה בדיקה ב-CI שרץ ב-UTC ובמחשב של מפתח בישראל.
 *
 * אוגוסט = שעון קיץ ישראלי, כלומר UTC+3. 11:00Z הוא 14:00 בירושלים.
 */
const utc = (day: number, hour: number): Date =>
  new Date(Date.UTC(2026, 7, day, hour, 0, 0));
/** רביעי, 14:00 שעון ישראל — אמצע יום ואמצע שבוע. */
const NOW = utc(12, 11);
const at = (day: number, hour: number): Date => utc(day, hour - 3);

describe("taskBucket", () => {
  it("מועד שחלף הוא איחור — גם אם הוא היום", () => {
    // 09:00 שחלף בשעה 14:00 הוא איחור; זו כל הנקודה של הדלי הראשון
    expect(taskBucket(at(12, 9), NOW)).toBe("overdue");
  });

  it("מאוחר יותר היום", () => {
    expect(taskBucket(at(12, 18), NOW)).toBe("today");
  });

  it("מחר בבוקר אינו היום — הגבול הוא חצות ולא 24 שעות", () => {
    // הטעות הנפוצה: now+24h היה מכניס את 08:00 מחר ל"היום" בשעה 14:00
    expect(taskBucket(at(13, 8), NOW)).toBe("week");
  });

  it("בתוך שבעה ימים", () => {
    expect(taskBucket(at(18, 10), NOW)).toBe("week");
  });

  it("היום השביעי כבר בהמשך", () => {
    expect(taskBucket(at(19, 10), NOW)).toBe("later");
  });

  it("בלי מועד — לא 'בהמשך' אלא דלי משלו", () => {
    expect(taskBucket(null, NOW)).toBe("someday");
    expect(taskBucket(undefined, NOW)).toBe("someday");
  });

  it("תאריך פגום אינו מפיל ואינו מתחזה לאיחור", () => {
    expect(taskBucket("לא תאריך", NOW)).toBe("someday");
  });

  it("הגבול הוא חצות **ירושלמית** ולא חצות של התהליך", () => {
    /*
     * 21:30Z ב-12 באוגוסט הוא 00:30 של ה-13 בישראל. שרת שרץ ב-UTC
     * היה קורא לזה "היום" והדפדפן הישראלי "מחר" — אותה משימה, שתי
     * תשובות, וזה בדיוק הפער בין המונה בסרגל לדלי במסך.
     */
    const justAfterIsraeliMidnight = new Date(Date.UTC(2026, 7, 12, 21, 30));
    expect(taskBucket(justAfterIsraeliMidnight, NOW)).toBe("week");

    // ורגע לפני אותה חצות — עדיין היום
    expect(taskBucket(new Date(Date.UTC(2026, 7, 12, 20, 30)), NOW)).toBe("today");
  });

  it("מעבר שעון אינו מזיז את הגבול", () => {
    /*
     * שעון החורף בישראל מתחיל ב-25.10.2026 (יום בן 25 שעות). ספירה
     * של 7×24 שעות הייתה מחליקה יום אחורה סביב המעבר; ספירת ימי לוח
     * אינה מושפעת.
     */
    const beforeDst = new Date(Date.UTC(2026, 9, 22, 9, 0)); // 22.10, 12:00 בישראל
    const sixDaysLater = new Date(Date.UTC(2026, 9, 28, 10, 0)); // 28.10, אחרי המעבר
    expect(taskBucket(sixDaysLater, beforeDst)).toBe("week");
    const sevenDaysLater = new Date(Date.UTC(2026, 9, 29, 10, 0));
    expect(taskBucket(sevenDaysLater, beforeDst)).toBe("later");
  });

  it("מחרוזת ISO מתקבלת כמו Date — התשובה מהשרת היא מחרוזת", () => {
    expect(taskBucket(at(12, 9).toISOString(), NOW)).toBe("overdue");
  });
});

describe("isTaskUrgent", () => {
  it("באיחור והיום דחופים", () => {
    expect(isTaskUrgent({ status: "open", dueAt: at(12, 9) }, NOW)).toBe(true);
    expect(isTaskUrgent({ status: "open", dueAt: at(12, 18) }, NOW)).toBe(true);
  });

  it("מה שבוצע אינו דחוף — גם אם עבר מועדו", () => {
    expect(isTaskUrgent({ status: "done", dueAt: at(1, 9) }, NOW)).toBe(false);
  });

  it("בלי מועד אינו דחוף", () => {
    expect(isTaskUrgent({ status: "open", dueAt: null }, NOW)).toBe(false);
  });
});

describe("compareTasks", () => {
  it("עדיפות לפני מועד — בתוך היום מה שדחוף למעלה", () => {
    const urgent = { priority: "high", dueAt: at(12, 18) };
    const routine = { priority: "normal", dueAt: at(12, 15) };
    expect([routine, urgent].sort(compareTasks)[0]).toBe(urgent);
  });

  it("באותה עדיפות — המוקדם קודם", () => {
    const early = { priority: "normal", dueAt: at(12, 15) };
    const late = { priority: "normal", dueAt: at(12, 18) };
    expect([late, early].sort(compareTasks)[0]).toBe(early);
  });

  it("בלי מועד יורד מתחת למתוזמן באותה עדיפות", () => {
    const dated = { priority: "normal", dueAt: at(20, 10) };
    const undated = { priority: "normal", dueAt: null };
    expect([undated, dated].sort(compareTasks)[0]).toBe(dated);
  });

  it("עדיפות לא מוכרת נקראת כרגילה ולא כאפס", () => {
    // ערך זר בעמודה לא אמור להעיף משימה לתחתית הרשימה בשקט
    const unknown = { priority: "בלגן", dueAt: at(12, 15) };
    const low = { priority: "low", dueAt: at(12, 15) };
    expect([low, unknown].sort(compareTasks)[0]).toBe(unknown);
  });

  it("שובר שוויון לפי סדר היצירה — מיון יציב ולא אקראי", () => {
    const first = { priority: "normal", dueAt: null, createdAt: at(1, 9) };
    const second = { priority: "normal", dueAt: null, createdAt: at(2, 9) };
    expect([second, first].sort(compareTasks)[0]).toBe(first);
  });
});

describe("groupTasksByBucket", () => {
  it("כל הדליים מוחזרים לפי הסדר, כולל ריקים", () => {
    const groups = groupTasksByBucket([], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["overdue", "today", "week", "later", "someday"]);
  });

  it("כל משימה נופלת לדלי אחד בדיוק", () => {
    const tasks = [
      { id: "a", dueAt: at(12, 9) },
      { id: "b", dueAt: at(12, 18) },
      { id: "c", dueAt: null },
    ];
    const groups = groupTasksByBucket(tasks, NOW);
    expect(groups.flatMap((g) => g.tasks)).toHaveLength(3);
    expect(groups.find((g) => g.bucket === "overdue")?.tasks[0]?.id).toBe("a");
    expect(groups.find((g) => g.bucket === "someday")?.tasks[0]?.id).toBe("c");
  });

  it("בתוך הדלי — ממוין לפי עדיפות", () => {
    const groups = groupTasksByBucket(
      [
        { id: "רגילה", priority: "normal", dueAt: at(12, 20) },
        { id: "דחופה", priority: "high", dueAt: at(12, 22) },
      ],
      NOW,
    );
    expect(groups.find((g) => g.bucket === "today")?.tasks.map((t) => t.id)).toEqual([
      "דחופה",
      "רגילה",
    ]);
  });
});

describe("taskEntityHref", () => {
  it("כל סוג מוכר מקבל מסך", () => {
    expect(taskEntityHref("buyer", "01J")).toBe("/buyers/01J");
    expect(taskEntityHref("property", "01J")).toBe("/properties/01J");
    expect(taskEntityHref("lead", "01J")).toBe("/leads/01J");
  });

  it("סוג לא מוכר אינו מייצר קישור שבור", () => {
    expect(taskEntityHref("משהו", "01J")).toBeNull();
  });
});
