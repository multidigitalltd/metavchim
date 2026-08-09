import { describe, expect, it } from "vitest";
import {
  compareTasks,
  groupTasksByBucket,
  isTaskUrgent,
  taskBucket,
  taskEntityHref,
} from "./tasks.js";

/** רביעי, 14:00 מקומי — אמצע יום ואמצע שבוע, כדי ששני הגבולות ייבדקו. */
const NOW = new Date(2026, 7, 12, 14, 0, 0);
const at = (day: number, hour: number): Date => new Date(2026, 7, day, hour, 0, 0);

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
