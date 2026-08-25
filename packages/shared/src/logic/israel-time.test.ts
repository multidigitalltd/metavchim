import { describe, expect, it } from "vitest";
import {
  formatJerusalemTime,
  jerusalemDayRange,
  jerusalemDayStart,
  jerusalemOffsetMs,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  jerusalemWeekday,
  jerusalemWeekStart,
  resolveJerusalemWall,
} from "./israel-time.js";

/*
 * הבדיקות מנוסחות ברגעי UTC מפורשים ולא ב"עכשיו": כל התקלה שהן
 * מכסות היא בדיוק ההפרש בין שעון התהליך לשעון ישראל, וקריאה לשעון
 * הייתה מסתירה אותה בחצי מהיום.
 */
describe("formatJerusalemTime", () => {
  it("שעון קיץ — 11:30 UTC היא 14:30 בישראל", () => {
    expect(formatJerusalemTime(new Date("2026-08-13T11:30:00Z"))).toBe("14:30");
  });

  it("שעון חורף — ההיסט שעתיים ולא שלוש", () => {
    expect(formatJerusalemTime(new Date("2026-01-15T12:00:00Z"))).toBe("14:00");
  });
});

describe("jerusalemDayRange", () => {
  it("היום מתחיל בחצות המקומית, לא בחצות UTC", () => {
    // 13/08 בקיץ: חצות בישראל היא 21:00 UTC של ה-12
    const { start } = jerusalemDayRange(new Date("2026-08-13T11:30:00Z"));
    expect(start.toISOString()).toBe("2026-08-12T21:00:00.000Z");
  });

  it("סוף היום הוא תחילת המחרת — 24 שעות ביום רגיל", () => {
    const { start, end } = jerusalemDayRange(new Date("2026-08-13T11:30:00Z"));
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000);
  });

  it("רגע שאחרי חצות מקומית ולפני חצות UTC שייך ליום המקומי החדש", () => {
    // 22:30 UTC ב-13/08 הוא כבר 01:30 של ה-14/08 בישראל
    const { start } = jerusalemDayRange(new Date("2026-08-13T22:30:00Z"));
    expect(start.toISOString()).toBe("2026-08-13T21:00:00.000Z");
  });

  it("יום מעבר שעון אינו שובר את הגבולות", () => {
    // מעבר לשעון חורף בישראל — היום נמשך 25 שעות
    const { start, end } = jerusalemDayRange(new Date("2026-10-25T09:00:00Z"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getTime() - start.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
  });
});

/*
 * ‎**תחילת השבוע** — הגבול שהשרת בוחר לפיו מה להמליץ והיומן מציג
 * לפיו. שני הצדדים חייבים לקבל את אותו רגע, גם ביום מעבר שעון וגם
 * כשהתהליך רץ באזור זמן אחר.
 */
describe("jerusalemWeekStart — שבוע ישראלי אחד לשני הצדדים", () => {
  it("יום ראשון בחצות ישראל, לכל יום בשבוע", () => {
    /* 23–29 באוגוסט 2026: ראשון עד שבת. כולם שייכים לאותו שבוע. */
    const starts = new Set<string>();
    for (let d = 23; d <= 29; d++) {
      starts.add(jerusalemWeekStart(new Date(`2026-08-${d}T09:00:00Z`)).toISOString());
    }
    expect(starts.size).toBe(1);
    /* ראשון 23/08 ב-00:00 בישראל = 22/08 21:00 UTC (שעון קיץ) */
    expect([...starts][0]).toBe("2026-08-22T21:00:00.000Z");
  });

  it("היסט שבועות מזיז שבועות שלמים ולא 168 שעות", () => {
    const now = new Date("2026-08-26T09:00:00Z");
    const back = jerusalemWeekStart(now, -2);
    expect(back.toISOString()).toBe("2026-08-08T21:00:00.000Z");
  });

  /*
   * המקרה שבגללו החשבון נעשה על תווית התאריך: חיסור מילישניות היה
   * נופל ב-23:00 של שבת בשבוע שאחרי מעבר השעון.
   */
  it("מעבר שעון אינו מזיז את הגבול מחצות", () => {
    /* מעבר לשעון חורף בישראל חל ב-25/10/2026 */
    const after = jerusalemWeekStart(new Date("2026-10-28T09:00:00Z"));
    expect(after.toISOString()).toBe("2026-10-24T21:00:00.000Z");
    const across = jerusalemWeekStart(new Date("2026-10-28T09:00:00Z"), -1);
    expect(across.toISOString()).toBe("2026-10-17T21:00:00.000Z");
  });

  /*
   * ‎**הבדיקה הזו חייבת באמת להחליף אזור זמן.**
   *
   * הגרסה הראשונה שלה נשאה את אותה כותרת והריצה הכול תחת UTC —
   * כלומר טענה „ללא תלות במארח” בלי לבדוק ולו מארח אחד אחר, ולכן
   * עברה בזמן ש-`jerusalemOffsetMs` היה שגוי בכל דפדפן שאינו UTC
   * (ביקורת Codex). שם של בדיקה אינו הבדיקה.
   */
  it("אזור הזמן של המארח אינו משנה את התוצאה", () => {
    const at = new Date("2026-08-26T09:00:00Z");
    const original = process.env.TZ;
    try {
      const seen = new Set<string>();
      for (const tz of ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"]) {
        process.env.TZ = tz;
        seen.add(jerusalemWeekStart(at).toISOString());
        seen.add(jerusalemDayRange(at).start.toISOString());
        /* ישראל ב-+3 באוגוסט, ולא ההיסט של המארח */
        expect(jerusalemOffsetMs(at)).toBe(3 * 3_600_000);
      }
      expect(seen).toEqual(
        new Set(["2026-08-22T21:00:00.000Z", "2026-08-25T21:00:00.000Z"]),
      );
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("jerusalemWeekday / jerusalemDayStart — לוח ישראלי, לא של המארח", () => {
  it("היום בשבוע נקבע בישראל — גם כשבמארח זה עדיין אתמול", () => {
    const original = process.env.TZ;
    try {
      /* שבת 29/08 ב-00:30 בישראל = שישי 21:30 UTC = שישי 17:30 בניו-יורק */
      const at = new Date("2026-08-28T21:30:00Z");
      for (const tz of ["UTC", "America/New_York", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        expect(jerusalemWeekday(at)).toBe(6);
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("טור יום הוא יום ישראלי שלם, גם בשבוע מעבר שעון", () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      /*
       * מעבר השעון בישראל חל ביום ראשון — כלומר על הטור **הפותח**
       * את השבוע, ולא בתוך השבוע שלפניו. הטור הזה נמשך 25 שעות,
       * וזה בדיוק מה שחשבון על מילישניות היה מחמיץ.
       */
      const weekStart = jerusalemWeekStart(new Date("2026-10-28T09:00:00Z"));
      const spans = [0, 1, 2, 3, 4, 5].map(
        (i) =>
          (jerusalemDayStart(weekStart, i + 1).getTime() -
            jerusalemDayStart(weekStart, i).getTime()) /
          3_600_000,
      );
      /* חמישה ימים של 24 שעות ואחד של 25 — ולא שישה של 24 */
      expect(spans).toEqual([25, 24, 24, 24, 24, 24]);
    } finally {
      process.env.TZ = original;
    }
  });
});

/*
 * ‎**ליל המעבר לשעון חורף — השעה שקיימת פעמיים.**
 *
 * ב-25.10.2026 השעון בישראל חוזר מ-03:00 ל-02:00, ולכן 01:30 קורית
 * פעם אחת בשעון קיץ (22:30Z) ופעם בשעון חורף (23:30Z). שדות טופס
 * אינם מבחינים ביניהן, ומסך העריכה שולח את המועד מחדש גם כששונה רק
 * המשך — כך ששמירה בלבד הזיזה פגישה בשעה.
 */
describe("resolveJerusalemWall — עריכה לא מזיזה מה שלא נגעו בו", () => {
  const EARLIER = new Date("2026-10-24T22:30:00Z");
  const LATER = new Date("2026-10-24T23:30:00Z");

  it("שני הרגעים באמת נושאים אותה שעת קיר — אחרת אין מה לבדוק", () => {
    expect(jerusalemWallParts(EARLIER)).toEqual({ date: "2026-10-25", time: "01:30" });
    expect(jerusalemWallParts(LATER)).toEqual({ date: "2026-10-25", time: "01:30" });
  });

  /*
   * הבדיקה המרכזית: אותם שדות בדיוק, שני עוגנים — וכל אחד חוזר
   * לעצמו. שום פונקציה שמקבלת רק תאריך ושעה אינה יכולה לעבור את
   * זה, כי המידע שמבחין בין השניים אינו בשדות.
   */
  it("שעה שחוזרת פעמיים — כל מופע נשמר על עצמו", () => {
    for (const at of [EARLIER, LATER]) {
      const { date, time } = jerusalemWallParts(at);
      expect(resolveJerusalemWall(date, time, at)?.toISOString()).toBe(at.toISOString());
    }
  });

  it("בלי עוגן אי אפשר להבחין — וזה בדיוק הבאג שהעוגן סוגר", () => {
    const { date, time } = jerusalemWallParts(EARLIER);
    expect(jerusalemWallIsoToUtc(`${date}T${time}:00.000`).toISOString()).not.toBe(
      EARLIER.toISOString(),
    );
  });

  it("שינוי אמיתי של שעה מומר, והעוגן אינו גובר עליו", () => {
    expect(resolveJerusalemWall("2026-10-25", "09:00", EARLIER)?.toISOString()).toBe(
      "2026-10-25T07:00:00.000Z",
    );
    expect(resolveJerusalemWall("2026-10-26", "01:30", EARLIER)?.toISOString()).toBe(
      "2026-10-25T23:30:00.000Z",
    );
  });

  /*
   * ‎**הצד השני של המעבר: השעה שאינה קיימת כלל.**
   *
   * ב-27.03.2026 השעון קופץ מ-02:00 ל-03:00. 02:30 באותו לילה אינה
   * זמן — והמרה „סלחנית” הייתה שומרת 03:30 בלי לומר דבר. הבדיקה
   * סורקת את כל השעה החסרה, כדי שהתשובה לא תהיה נכונה בדגימה אחת.
   */
  it("שעה שדולגה במעבר לשעון קיץ נדחית, ולא מתורגמת בשקט", () => {
    for (let m = 0; m < 60; m += 10) {
      const time = `02:${String(m).padStart(2, "0")}`;
      expect(resolveJerusalemWall("2026-03-27", time, null)).toBeNull();
    }
    /* השעות שמסביב לפער קיימות, ונשארות תקינות */
    expect(resolveJerusalemWall("2026-03-27", "01:30", null)?.toISOString()).toBe(
      "2026-03-26T23:30:00.000Z",
    );
    expect(resolveJerusalemWall("2026-03-27", "03:30", null)?.toISOString()).toBe(
      "2026-03-27T00:30:00.000Z",
    );
  });

  it("גם עוגן אינו מכשיר שעה שאינה קיימת", () => {
    const anchor = new Date("2026-03-27T00:30:00Z");
    /* העוגן עצמו נקרא 03:30 — הוא אינו יכול לאשר בקשה ל-02:30 */
    expect(jerusalemWallParts(anchor).time).toBe("03:30");
    expect(resolveJerusalemWall("2026-03-27", "02:30", anchor)).toBeNull();
  });

  it("יצירה חדשה — אין עוגן, וההמרה רגילה", () => {
    expect(resolveJerusalemWall("2026-08-13", "14:30", null)?.toISOString()).toBe(
      "2026-08-13T11:30:00.000Z",
    );
  });

  it("שניות של הרגע השמור נשמרות כשלא נגעו בשעה", () => {
    const at = new Date("2026-08-13T11:30:45.000Z");
    expect(resolveJerusalemWall("2026-08-13", "14:30", at)?.toISOString()).toBe(at.toISOString());
  });

  it("אזור הזמן של הדפדפן אינו משנה את התוצאה", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York", "Asia/Tokyo"]) {
        process.env.TZ = tz;
        expect(resolveJerusalemWall("2026-10-25", "01:30", EARLIER)?.toISOString()).toBe(
          EARLIER.toISOString(),
        );
        expect(resolveJerusalemWall("2026-08-13", "14:30", null)?.toISOString()).toBe(
          "2026-08-13T11:30:00.000Z",
        );
      }
    } finally {
      process.env.TZ = original;
    }
  });
});
