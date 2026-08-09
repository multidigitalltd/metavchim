import { describe, expect, it } from "vitest";
import {
  describeRecurrence,
  isDue,
  nextOccurrence,
  nextOccurrenceUtc,
  recurrenceRejectionReason,
  type RecurrenceRule,
} from "./recurrence.js";

/** ראשון, 2026-08-09, 12:00 מקומי. */
const SUNDAY_NOON = new Date(2026, 7, 9, 12, 0, 0, 0);

const rule = (over: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
  frequency: "daily",
  hour: 9,
  minute: 0,
  ...over,
});

describe("recurrenceRejectionReason", () => {
  it("כלל תקין", () => {
    expect(recurrenceRejectionReason(rule())).toBeNull();
  });

  it("שעה מחוץ לתחום", () => {
    expect(recurrenceRejectionReason(rule({ hour: 24 }))).toContain("שעה");
  });

  it("דקה מחוץ לתחום", () => {
    expect(recurrenceRejectionReason(rule({ minute: 60 }))).toContain("דקה");
  });

  it("יום בשבוע לא תקין", () => {
    expect(
      recurrenceRejectionReason(rule({ frequency: "weekly", weekdays: [7] })),
    ).toContain("יום בשבוע");
  });

  it("יום בחודש לא תקין", () => {
    expect(
      recurrenceRejectionReason(rule({ frequency: "monthly", dayOfMonth: 32 })),
    ).toContain("יום בחודש");
  });

  it("31 תקין — הוא נופל לסוף חודש קצר", () => {
    expect(recurrenceRejectionReason(rule({ frequency: "monthly", dayOfMonth: 31 }))).toBeNull();
  });

  it("תדירות לא מוכרת", () => {
    expect(
      recurrenceRejectionReason({ ...rule(), frequency: "yearly" as never }),
    ).toContain("תדירות");
  });
});

describe("nextOccurrence — יומי", () => {
  it("היום, אם השעה טרם עברה", () => {
    const next = nextOccurrence(rule({ hour: 18 }), SUNDAY_NOON);
    expect(next?.getDate()).toBe(9);
    expect(next?.getHours()).toBe(18);
  });

  it("מחר, אם השעה כבר עברה", () => {
    const next = nextOccurrence(rule({ hour: 9 }), SUNDAY_NOON);
    expect(next?.getDate()).toBe(10);
  });

  it("בדיוק על השעה מדלג הלאה — אחרת אותו מופע נוצר פעמיים", () => {
    const exact = new Date(2026, 7, 9, 9, 0, 0, 0);
    expect(nextOccurrence(rule({ hour: 9 }), exact)?.getDate()).toBe(10);
  });
});

describe("nextOccurrence — שבועי", () => {
  it("היום שבו נמצאים, אם הוא ברשימה והשעה טרם עברה", () => {
    // ראשון = 0
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [0], hour: 18 }), SUNDAY_NOON);
    expect(next?.getDate()).toBe(9);
  });

  it("היום הבא ברשימה", () => {
    // רביעי = 3
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [3] }), SUNDAY_NOON);
    expect(next?.getDay()).toBe(3);
    expect(next?.getDate()).toBe(12);
  });

  it("שבוע הבא כשהיום היחיד כבר עבר היום", () => {
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [0], hour: 9 }), SUNDAY_NOON);
    expect(next?.getDate()).toBe(16);
  });

  it("כמה ימים — בוחר את הקרוב", () => {
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [4, 2] }), SUNDAY_NOON);
    expect(next?.getDay()).toBe(2);
  });

  it("בלי ימים — פעם בשבוע ביום הנוכחי", () => {
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [], hour: 9 }), SUNDAY_NOON);
    expect(next?.getDay()).toBe(0);
    expect(next?.getDate()).toBe(16);
  });

  it("כפילות ביום לא משכפלת מופע", () => {
    const next = nextOccurrence(rule({ frequency: "weekly", weekdays: [3, 3] }), SUNDAY_NOON);
    expect(next?.getDate()).toBe(12);
  });
});

describe("nextOccurrence — חודשי", () => {
  it("החודש, אם היום טרם הגיע", () => {
    const next = nextOccurrence(rule({ frequency: "monthly", dayOfMonth: 20 }), SUNDAY_NOON);
    expect(next?.getMonth()).toBe(7);
    expect(next?.getDate()).toBe(20);
  });

  it("החודש הבא, אם היום כבר עבר", () => {
    const next = nextOccurrence(rule({ frequency: "monthly", dayOfMonth: 5 }), SUNDAY_NOON);
    expect(next?.getMonth()).toBe(8);
    expect(next?.getDate()).toBe(5);
  });

  it("31 בפברואר נופל ל-28 ולא מדלג על החודש", () => {
    // משרד שקבע "סיכום ב-31" מתכוון לסוף החודש; דילוג היה משאיר
    // אותו בלי סיכום בלי שאיש ישים לב
    const lateJanuary = new Date(2027, 0, 31, 23, 0, 0, 0);
    const next = nextOccurrence(rule({ frequency: "monthly", dayOfMonth: 31 }), lateJanuary);
    expect(next?.getMonth()).toBe(1);
    expect(next?.getDate()).toBe(28);
  });

  it("31 בחודש בן 30 נופל ל-30", () => {
    const midApril = new Date(2026, 3, 15, 12, 0, 0, 0);
    const next = nextOccurrence(rule({ frequency: "monthly", dayOfMonth: 31 }), midApril);
    expect(next?.getDate()).toBe(30);
  });

  it("מעבר שנה", () => {
    const december = new Date(2026, 11, 20, 12, 0, 0, 0);
    const next = nextOccurrence(rule({ frequency: "monthly", dayOfMonth: 5 }), december);
    expect(next?.getFullYear()).toBe(2027);
    expect(next?.getMonth()).toBe(0);
  });
});

describe("nextOccurrence — קלט פגום", () => {
  it("כלל לא תקין מחזיר null", () => {
    expect(nextOccurrence(rule({ hour: 99 }), SUNDAY_NOON)).toBeNull();
  });

  it("תאריך לא תקין מחזיר null ולא מתרסק", () => {
    expect(nextOccurrence(rule(), new Date("---"))).toBeNull();
  });
});

describe("isDue", () => {
  const createdAt = new Date(2026, 7, 1, 8, 0, 0, 0);

  it("הגיע הזמן", () => {
    const now = new Date(2026, 7, 9, 10, 0, 0, 0);
    expect(isDue(rule({ hour: 9 }), new Date(2026, 7, 8, 9, 0), now, createdAt)).toBe(true);
  });

  it("טרם הגיע", () => {
    const now = new Date(2026, 7, 9, 8, 0, 0, 0);
    expect(isDue(rule({ hour: 9 }), new Date(2026, 7, 8, 9, 0), now, createdAt)).toBe(false);
  });

  it("כלל חדש נמדד מרגע היצירה ולא רטרואקטיבית", () => {
    // כלל שנוצר היום ומייצר מיד את כל מופעי החודש שעבר הוא הצפה
    const created = new Date(2026, 7, 9, 11, 0, 0, 0);
    const now = new Date(2026, 7, 9, 11, 30, 0, 0);
    expect(isDue(rule({ frequency: "monthly", dayOfMonth: 1 }), null, now, created)).toBe(false);
  });

  it("כלל חדש שהמופע הראשון שלו כבר הגיע", () => {
    const created = new Date(2026, 7, 9, 8, 0, 0, 0);
    const now = new Date(2026, 7, 9, 10, 0, 0, 0);
    expect(isDue(rule({ hour: 9 }), null, now, created)).toBe(true);
  });
});

describe("describeRecurrence", () => {
  it("יומי", () => {
    expect(describeRecurrence(rule({ hour: 9, minute: 30 }))).toBe("כל יום ב-09:30");
  });

  it("שבועי עם ימים בשמות", () => {
    const text = describeRecurrence(rule({ frequency: "weekly", weekdays: [0, 3] }));
    expect(text).toContain("ראשון");
    expect(text).toContain("רביעי");
  });

  it("שבועי בלי ימים", () => {
    expect(describeRecurrence(rule({ frequency: "weekly", weekdays: [] }))).toContain("כל שבוע");
  });

  it("חודשי ביום מסוים", () => {
    expect(describeRecurrence(rule({ frequency: "monthly", dayOfMonth: 5 }))).toContain("5");
  });

  it("31 מנוסח כסוף החודש — זה מה שהוא עושה בפועל", () => {
    expect(describeRecurrence(rule({ frequency: "monthly", dayOfMonth: 31 }))).toContain("בסוף כל חודש");
  });
});

describe("nextOccurrenceUtc", () => {
  /** השעה שהרגע הזה מייצג בישראל — מה שהמשתמש באמת יראה. */
  const jerusalemHour = (at: Date): string =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);

  it("09:00 הוא 09:00 בישראל — לא בשעון השרת", () => {
    // זה כל העניין: תהליכי השרת רצים ב-UTC, ושם 09:00 מקומי הוא
    // 12:00 בישראל בשעון קיץ
    const next = nextOccurrenceUtc(rule({ hour: 9 }), new Date("2026-08-09T20:00:00Z"));
    expect(next).not.toBeNull();
    expect(jerusalemHour(next!)).toBe("09:00");
  });

  it("נכון גם בשעון חורף", () => {
    const next = nextOccurrenceUtc(rule({ hour: 9 }), new Date("2026-01-15T20:00:00Z"));
    expect(jerusalemHour(next!)).toBe("09:00");
  });

  it("תמיד בעתיד ביחס לנקודת הייחוס", () => {
    const since = new Date("2026-08-09T20:00:00Z");
    expect(nextOccurrenceUtc(rule({ hour: 9 }), since)!.getTime()).toBeGreaterThan(since.getTime());
  });

  it("שבועי — היום בשבוע נמדד בישראל", () => {
    // 2026-08-09T21:30Z הוא כבר יום שני 00:30 בישראל
    const next = nextOccurrenceUtc(
      rule({ frequency: "weekly", weekdays: [1], hour: 9 }),
      new Date("2026-08-09T21:30:00Z"),
    );
    expect(jerusalemHour(next!)).toBe("09:00");
    // אותו יום שני, לא בעוד שבוע
    expect(next!.getTime() - new Date("2026-08-09T21:30:00Z").getTime()).toBeLessThan(
      12 * 60 * 60 * 1000,
    );
  });

  it("כלל לא תקין מחזיר null", () => {
    expect(nextOccurrenceUtc(rule({ hour: 99 }), new Date())).toBeNull();
  });
});
