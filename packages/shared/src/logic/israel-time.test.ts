import { describe, expect, it } from "vitest";
import { formatJerusalemTime, jerusalemDayRange } from "./israel-time.js";

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
