import { describe, expect, it } from "vitest";
import {
  DEFAULT_PBX_WATCH,
  insideWatchWindow,
  monitoredHoursSince,
  pbxSilenceDedupeKey,
  pbxSilenceMessage,
  resolvePbxWatch,
  shouldAlertPbxSilence,
  type PbxWatchWindow,
} from "./pbx-watch.js";

/** שעת קיר ישראלית → רגע UTC, בקיץ (היסט 3 שעות). */
const at = (wall: string): Date => new Date(`${wall}+03:00`);

// 2026-08-30 הוא יום ראשון; 2026-09-04 שישי; 2026-09-05 שבת
describe("insideWatchWindow", () => {
  it("יום ושעה בתוך החלון", () => {
    expect(insideWatchWindow(at("2026-08-30T10:00"), DEFAULT_PBX_WATCH)).toBe(true);
  });

  it("שבת בחוץ גם בשעת עבודה", () => {
    expect(insideWatchWindow(at("2026-09-05T10:00"), DEFAULT_PBX_WATCH)).toBe(false);
  });

  it("לילה בחוץ גם ביום עבודה", () => {
    expect(insideWatchWindow(at("2026-08-30T03:00"), DEFAULT_PBX_WATCH)).toBe(false);
  });

  /* שעת הסגירה אינה כלולה — אחרת 19:00 בדיוק נחשב פתוח */
  it("שעת הסגירה אינה בפנים, ושעת הפתיחה כן", () => {
    expect(insideWatchWindow(at("2026-08-30T19:00"), DEFAULT_PBX_WATCH)).toBe(false);
    expect(insideWatchWindow(at("2026-08-30T09:00"), DEFAULT_PBX_WATCH)).toBe(true);
  });
});

describe("monitoredHoursSince", () => {
  it("סופר שעות עבודה בלבד באותו יום", () => {
    expect(
      monitoredHoursSince(at("2026-08-30T10:00"), at("2026-08-30T14:00"), DEFAULT_PBX_WATCH),
    ).toBe(4);
  });

  /*
   * ‎**זו ההכרעה שמצדיקה את כל המודול.** בלי ספירה מנוטרת, שיחה
   * אחרונה בחמישי ב-18:00 הייתה נראית בראשון ב-09:00 כמו 63 שעות
   * שתיקה — והתראה הייתה יוצאת לכל משרד, בכל שבוע.
   */
  it("סוף שבוע אינו מקרב להתראה", () => {
    const lastCall = at("2026-09-03T18:00"); // חמישי אחר הצהריים
    const sundayMorning = at("2026-09-06T09:30"); // ראשון בבוקר

    // בשעון קיר עברו יותר מ-63 שעות; במנוטרות — שתי קצוות של שעה
    expect(sundayMorning.getTime() - lastCall.getTime()).toBeGreaterThan(63 * 3_600_000);
    expect(monitoredHoursSince(lastCall, sundayMorning, DEFAULT_PBX_WATCH)).toBeLessThan(4);

    // וזו הנקודה: אין התראה בבוקר ראשון על סוף שבוע שקט
    expect(
      shouldAlertPbxSilence({
        lastInboundAt: lastCall,
        now: sundayMorning,
        thresholdHours: 4,
        window: DEFAULT_PBX_WATCH,
      }),
    ).toBe(false);
  });

  it("בלי שיחה מעולם — נספרות שעות החלון עד התקרה", () => {
    expect(
      monitoredHoursSince(null, at("2026-08-30T12:00"), DEFAULT_PBX_WATCH),
    ).toBeGreaterThan(20);
  });
});

describe("shouldAlertPbxSilence", () => {
  const window = DEFAULT_PBX_WATCH;

  it("מתריע כשעברו מספיק שעות עבודה", () => {
    expect(
      shouldAlertPbxSilence({
        lastInboundAt: at("2026-08-30T09:30"),
        now: at("2026-08-30T15:00"),
        thresholdHours: 4,
        window,
      }),
    ).toBe(true);
  });

  it("אינו מתריע לפני הסף", () => {
    expect(
      shouldAlertPbxSilence({
        lastInboundAt: at("2026-08-30T13:00"),
        now: at("2026-08-30T15:00"),
        thresholdHours: 4,
        window,
      }),
    ).toBe(false);
  });

  /* התראה ב-03:00 מעירה בלי שאפשר לעשות דבר — ולכן נכבית */
  it("אינו מתריע מחוץ לחלון גם כשהשתיקה ארוכה", () => {
    expect(
      shouldAlertPbxSilence({
        lastInboundAt: at("2026-08-25T09:00"),
        now: at("2026-08-30T03:00"),
        thresholdHours: 4,
        window,
      }),
    ).toBe(false);
  });

  it("מתריע גם כשמעולם לא נקלטה שיחה", () => {
    expect(
      shouldAlertPbxSilence({
        lastInboundAt: null,
        now: at("2026-08-30T15:00"),
        thresholdHours: 4,
        window,
      }),
    ).toBe(true);
  });

  it("משרד שמסמן שישי מנוטר בו", () => {
    const withFriday: PbxWatchWindow = { ...DEFAULT_PBX_WATCH, days: [0, 1, 2, 3, 4, 5] };
    expect(insideWatchWindow(at("2026-09-04T10:00"), withFriday)).toBe(true);
    expect(insideWatchWindow(at("2026-09-04T10:00"), DEFAULT_PBX_WATCH)).toBe(false);
  });
});

describe("resolvePbxWatch", () => {
  it("חסר נופל לברירת המחדל", () => {
    expect(resolvePbxWatch(undefined)).toEqual(DEFAULT_PBX_WATCH);
    expect(resolvePbxWatch(null)).toEqual(DEFAULT_PBX_WATCH);
  });

  it("קורא חלון תקין", () => {
    expect(resolvePbxWatch({ days: [1, 2], fromHour: 8, toHour: 17 })).toEqual({
      days: [1, 2],
      fromHour: 8,
      toHour: 17,
    });
  });

  /*
   * רשימת ימים ריקה הייתה מכבה את הניטור **בלי שהמסך יראה שהוא
   * כבוי** — כיבוי סמוי הוא בדיוק מה שאי אפשר לאבחן.
   */
  it("רשימת ימים ריקה אינה מכבה בשקט", () => {
    expect(resolvePbxWatch({ days: [] }).days).toEqual(DEFAULT_PBX_WATCH.days);
  });

  it("ימים מחוץ לתחום ונכפלים מסוננים", () => {
    expect(resolvePbxWatch({ days: [1, 1, 9, -2, 3] }).days).toEqual([1, 3]);
  });

  it("טווח שעות הפוך נופל לברירת המחדל", () => {
    const resolved = resolvePbxWatch({ fromHour: 20, toHour: 8 });
    expect(resolved.fromHour).toBe(DEFAULT_PBX_WATCH.fromHour);
    expect(resolved.toHour).toBe(DEFAULT_PBX_WATCH.toHour);
  });
});

describe("ההתראה עצמה", () => {
  it("המפתח מייצר התראה אחת ליום", () => {
    const key = (wall: string) => pbxSilenceDedupeKey("t1", at(wall));
    expect(key("2026-08-30T10:00")).toBe(key("2026-08-30T17:00"));
    expect(key("2026-08-30T10:00")).not.toBe(key("2026-08-31T10:00"));
  });

  it("נוסח נפרד למי שמעולם לא קיבל שיחה", () => {
    const never = pbxSilenceMessage({
      lastInboundAt: null,
      now: at("2026-08-30T12:00"),
      window: DEFAULT_PBX_WATCH,
    });
    expect(never.body).toContain("מעולם");
    const stopped = pbxSilenceMessage({
      lastInboundAt: at("2026-08-30T09:00"),
      now: at("2026-08-30T15:00"),
      window: DEFAULT_PBX_WATCH,
    });
    expect(stopped.body).toContain("שעות עבודה");
  });
});
