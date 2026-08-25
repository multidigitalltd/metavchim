/**
 * שעון ישראל — **מקום אחד, כי השרת רץ ב-UTC.**
 *
 * זו לא קפדנות: פגישה ב-14:30 בירושלים נשמרת כרגע UTC, וכל עיצוב או
 * חישוב גבול-יום שמסתמך על אזור הזמן של התהליך יראה אותה כ-11:30
 * בקיץ. שעה שגויה בהמלצה היא סוכן שמגיע באיחור של שלוש שעות.
 *
 * כל פונקציה כאן טהורה ומקבלת את הרגע במפורש — אין קריאה לשעון
 * מבפנים, כדי שהתוצאה תהיה ניתנת לבדיקה.
 */

export const JERUSALEM_TZ = "Asia/Jerusalem";

/**
 * ההיסט של שעון ישראל מ-UTC ברגע נתון, במילישניות.
 *
 * תלוי-רגע ולא קבוע: ישראל עוברת שעון פעמיים בשנה, ולכן "שעתיים
 * מ-UTC" נכון רק חצי שנה.
 */
export function jerusalemOffsetMs(at: Date): number {
  const wallAsUtc = new Date(at.toLocaleString("en-US", { timeZone: JERUSALEM_TZ }));
  return wallAsUtc.getTime() - at.getTime();
}

/**
 * הרגע ב-UTC שבו מתרחשת שעת-קיר ישראלית נתונה, לפי מחרוזת ISO.
 *
 * ל-`recurrence` יש אחות שמקבלת `Date` במקום מחרוזת; שתיהן נשענות
 * על `jerusalemOffsetMs` שכאן, כדי שתיקון של חישוב ההיסט יחול על
 * שתיהן ולא על אחת.
 *
 * ניחוש ותיקון כפול, כי ההיסט הנכון הוא זה שבתוקף ברגע המבוקש עצמו:
 * ביום מעבר שעון ההיסט של חצות שונה מההיסט של הרגע שבו החישוב רץ.
 */
export function jerusalemWallIsoToUtc(wallIso: string): Date {
  const wallMs = new Date(`${wallIso}Z`).getTime();
  let guess = new Date(wallMs);
  for (let i = 0; i < 2; i++) guess = new Date(wallMs - jerusalemOffsetMs(guess));
  return guess;
}

/**
 * גבולות היום הישראלי הנוכחי, כערכי UTC לשאילתות.
 *
 * `setHours(23,59,59)` על תהליך שרץ ב-UTC מגדיר את סוף היום ה-UTC —
 * כלומר גורף פגישות של מחר לפנות בוקר, ובין חצות המקומית לחצות
 * ה-UTC מפספס כמעט את כל היום המקומי החדש.
 */
export function jerusalemDayRange(now: Date): { start: Date; end: Date } {
  const day = (at: Date): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: JERUSALEM_TZ }).format(at);
  const start = jerusalemWallIsoToUtc(`${day(now)}T00:00:00.000`);
  // 30 שעות אחרי תחילת היום נופלות תמיד בתוך היום המקומי הבא, גם
  // ביום מעבר שעון בן 25 שעות
  const nextDay = day(new Date(start.getTime() + 30 * 60 * 60 * 1000));
  return { start, end: jerusalemWallIsoToUtc(`${nextDay}T00:00:00.000`) };
}

/**
 * תאריך בשעון ישראל — "24.08.2026", ללא תלות באזור הזמן של התהליך.
 *
 * ‎`toLocaleDateString` בלי `timeZone` היה נותן את התאריך של השרת:
 * פגישה ב-01:30 בירושלים היא עדיין 22:30 של אתמול ב-UTC, ולכן דוח
 * שיוצא ללקוח היה מקדים אותה ביום שלם.
 */
export function formatJerusalemDate(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: JERUSALEM_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(at);
}

/** שעה בשעון ישראל — "14:30", ללא תלות באזור הזמן של התהליך. */
export function formatJerusalemTime(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: JERUSALEM_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
