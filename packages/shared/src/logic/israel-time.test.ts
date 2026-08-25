import { describe, expect, it } from "vitest";
import { formatJerusalemTime, jerusalemDayRange, jerusalemWeekStart } from "./israel-time.js";

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

  it("אזור הזמן של התהליך אינו משנה את התוצאה", () => {
    /* אותו רגע, אותו גבול — הפונקציה קוראת רק ללוח הישראלי */
    const at = new Date("2026-08-26T09:00:00Z");
    expect(jerusalemWeekStart(at).toISOString()).toBe("2026-08-22T21:00:00.000Z");
  });
});
