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
const PARTS_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: JERUSALEM_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function jerusalemOffsetMs(at: Date): number {
  /*
   * ‎**הפירוק לחלקים, ולא `new Date(toLocaleString(...))`.**
   *
   * ‎`toLocaleString` מחזיר את שעת הקיר הישראלית כמחרוזת, ו-`new
   * Date` מפרש מחרוזת כזו **באזור הזמן של המארח**. על שרת UTC זה
   * יצא נכון במקרה, ולכן הבאג היה בלתי נראה בבדיקות; בדפדפן
   * ניו-יורקי ההיסט יצא 7 שעות במקום 3, ובטוקיו מינוס 6 — כלומר
   * ‎`jerusalemDayRange` ו-`jerusalemWeekStart` החזירו גבולות שגויים
   * לכל מתווך שאינו יושב על UTC (ביקורת Codex).
   *
   * ‎`formatToParts` מחזיר מספרים ולא טקסט לפרסור, ו-`Date.UTC`
   * מרכיב מהם רגע ללא תלות במארח. זו הפונקציה שכל חישובי הגבולות
   * כאן נשענים עליה, ולכן היא נבדקת מפורשות בכמה אזורי זמן.
   */
  const parts = PARTS_FMT.formatToParts(at);
  const value = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found === undefined ? 0 : Number(found.value);
  };
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    /* חלק מהמנועים מחזירים "24" לחצות ב-`hour12: false` */
    value("hour") % 24,
    value("minute"),
    value("second"),
  );
  return asUtc - at.getTime();
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
 * תחילת השבוע הישראלי — יום ראשון ב-00:00 שעון ישראל, כערך UTC.
 *
 * ‎`offsetWeeks` מזיז שבועות שלמים: ‎`-2` הוא ראשון של לפני שבועיים.
 *
 * ‎**החשבון על תווית התאריך ולא על מילישניות.** חיסור של `n×7×24`
 * שעות מדלג או חוזר על שעה ביום מעבר שעון, ואז „תחילת השבוע” נופלת
 * ב-23:00 של שבת. כאן נגזר קודם התאריך הישראלי, החיסור נעשה בימי
 * לוח על עוגן UTC (שאין בו מעבר שעון), והתוצאה מומרת בחזרה לחצות
 * ישראלית אמיתית.
 *
 * שני הצדדים חייבים את אותו גבול: השרת בוחר לפיו מה להמליץ, והיומן
 * מציג לפיו — ושבוע דפדפן במקום שבוע ישראלי היה מחזיר בדיוק את
 * הפער שהפונקציה נועדה לסגור, למתווך שנמצא בחו"ל.
 */
export function jerusalemWeekStart(now: Date, offsetWeeks = 0): Date {
  return shiftJerusalemDays(now, offsetWeeks * 7 - jerusalemWeekday(now));
}

/**
 * היום בשבוע לפי הלוח הישראלי — 0 ראשון … 6 שבת.
 *
 * ‎`getDay()` על `Date` נותן את היום של **המארח**: פגישה בשבת
 * ב-00:30 בישראל היא עדיין שישי בערב בניו-יורק. מי שסופר ימים
 * לרשת של שישה טורים חייב את הלוח הישראלי.
 */
export function jerusalemWeekday(at: Date): number {
  return new Date(`${jerusalemDayLabel(at)}T00:00:00Z`).getUTCDay();
}

/**
 * תחילת היום הישראלי, `offsetDays` ימי לוח מהרגע הנתון.
 *
 * ‎`setDate(getDate() + 1)` על תהליך שאינו ישראלי מזיז יום של
 * המארח, וביום מעבר שעון גם „24 שעות” אינן יום — טור אחד ברשת
 * בולע שעה מהיום הבא. חשבון על תווית התאריך, כמו בשבוע.
 */
export function jerusalemDayStart(at: Date, offsetDays = 0): Date {
  return shiftJerusalemDays(at, offsetDays);
}

/**
 * שעת הקיר הישראלית, מפוצלת לשדות טופס: `YYYY-MM-DD` ו-`HH:MM`.
 *
 * ‎**הצד השני של `jerusalemWallIsoToUtc`.** שדה תאריך ושדה שעה
 * מציגים ועורכים שעת קיר, ולכן שניהם חייבים לדבר באותו אזור זמן —
 * אחרת מסך שמציג „09:00” נפתח לעריכה על „02:00”, ושמירה של
 * „10:00” מזיזה את הפגישה לעשר בשעון הדפדפן. זה לא הבדל תצוגה
 * אלא שינוי בנתון (ביקורת Codex).
 */
export function jerusalemWallParts(at: Date): { date: string; time: string } {
  const parts = PARTS_FMT.formatToParts(at);
  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = String(Number(value("hour")) % 24).padStart(2, "0");
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${hour}:${value("minute")}`,
  };
}

/**
 * שעת קיר ישראלית מטופס → רגע UTC, **בלי להזיז פגישה שלא נגעו בשעתה.**
 *
 * ‎`jerusalemWallIsoToUtc` לבדה אינה מספיקה כאן, כי שעת קיר אינה
 * תמיד רגע יחיד: בליל המעבר לשעון חורף השעה 01:30 מתרחשת פעמיים —
 * ‎`22:30Z` בשעון קיץ ו-`23:30Z` בשעון חורף — ולשתיהן אותם שדות
 * טופס בדיוק. הפונקציה ההיא מחזירה תמיד את המאוחרת, ולכן פגישה
 * שנקבעה למופע הראשון הייתה **זזה בשעה מעצם השמירה**: מסך העריכה
 * שולח מחדש את המועד גם כששונה רק המשך, וגלגול הלוך-ושוב של
 * ‎`22:30Z` היה מחזיר `23:30Z` (ביקורת Codex).
 *
 * לכן `current` — הרגע השמור. אם שדות הטופס זהים לשעת הקיר שלו,
 * אין מה לפרש: זה אותו מועד, והוא מוחזר כמות שהוא (כולל שניות).
 * רק שינוי אמיתי של תאריך או שעה עובר המרה.
 *
 * ‎**כשלון אינו „לא”, אלא סיבה.** למעבר יש גם צד שני: בליל המעבר
 * לשעון קיץ השעון קופץ מ-02:00 ל-03:00, ולכן 02:30 אינה קיימת כלל.
 * ‎`jerusalemWallIsoToUtc` מחזירה עליה רגע שקורא בחזרה 03:30 — כלומר
 * הטופס ביקש שתיים וחצי והמערכת שמרה שלוש וחצי, בלי לומר דבר
 * (ביקורת Codex). מוטב לסרב ולהסביר מאשר לשמור מועד שאיש לא ביקש.
 *
 * המבחן אינו כלל שעון מקודד אלא הלוך-ושוב: אם הרגע שהתקבל אינו קורא
 * בחזרה את אותם שדות בדיוק, שעת הקיר הזו אינה קיימת. אותה בדיקה
 * תעבוד גם אם ישראל תשנה את תאריכי המעבר.
 *
 * ‎**הפונקציה לעולם אינה זורקת.** שדה ריק הוא מצב שגרתי בטופס — שני
 * הטפסים הם `noValidate`, ולכן `required` אינו נאכף — ובגרסה
 * הקודמת הוא הגיע כ-`Date` פסול ל-`formatToParts`, שזורק
 * ‎`RangeError`. במסך הקליטה הקריאה יושבת מחוץ ל-`try`, ולכן לחיצה
 * על „שמור” בטופס ריק לא הציגה דבר והכפתור נתקע (ביקורת Codex).
 * פונקציה שהמסך נשען עליה חייבת להיות טוטלית.
 *
 * שתי הסיבות נפרדות כי ההודעה שונה: „מלאו תאריך ושעה” מול „השעה
 * אינה קיימת”. איחודן ל-`null` יחיד היה מכריח כל מסך לנחש איזו
 * מהשתיים לומר — ושלושה מסכים מנחשים הם שלוש הזדמנויות לשקר.
 *
 * מה שנשאר פתוח, במפורש: מי שמקליד ידנית שעה שחוזרת פעמיים יקבל את
 * המופע המאוחר. אין בטופס שדה שיבחין ביניהם, ולנחש עבורו זה להמציא.
 */
export type JerusalemWallResult =
  | { ok: true; at: Date }
  | { ok: false; reason: "missing" | "nonexistent" };

export function resolveJerusalemWall(
  date: string,
  time: string,
  current: Date | null,
): JerusalemWallResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return { ok: false, reason: "missing" };
  }
  /*
   * ‎**האם זה בכלל רגע בלוח** — לפני כל שאלה על ישראל, ולפני הקריאה
   * שיודעת לזרוק. „99:99” עובר את התבנית ומייצר `Date` פסול, ו-
   * ‎`jerusalemWallIsoToUtc` זורקת עליו `RangeError` בתוך
   * ‎`formatToParts`; „2026-02-31” גרוע יותר — `Date` מגלגל אותו ל-3
   * במרץ בשקט, וללא הבדיקה הוא היה נכשל במבחן ההלוך-ושוב ומסווג
   * כ„שעה שאינה קיימת”, כלומר הסבר על מעבר שעון לתאריך שאינו בלוח.
   * סיבה שגויה גרועה מסיבה כללית.
   */
  const wall = new Date(`${date}T${time}:00.000Z`);
  if (Number.isNaN(wall.getTime()) || wall.toISOString().slice(0, 16) !== `${date}T${time}`) {
    return { ok: false, reason: "missing" };
  }
  if (current !== null) {
    const parts = jerusalemWallParts(current);
    if (parts.date === date && parts.time === time) return { ok: true, at: current };
  }
  const at = jerusalemWallIsoToUtc(`${date}T${time}:00.000`);
  const back = jerusalemWallParts(at);
  if (back.date !== date || back.time !== time) return { ok: false, reason: "nonexistent" };
  return { ok: true, at };
}

/**
 * מה שאומרים למשתמש על כל סיבת כשלון של `resolveJerusalemWall`.
 *
 * יושב לצד הפונקציה ולא בכל מסך בנפרד: שלושה טפסים מקבלים את אותן
 * שתי סיבות, ושלוש גרסאות של אותו משפט הן שלוש הזדמנויות שאחת מהן
 * תשקר. כל משפט נוקב בסיבה **ובפעולה** — מסך שאומר „שגיאה” בלבד
 * מותיר את המתווך בלי מושג מה לעשות.
 */
export function jerusalemWallErrorMessage(reason: "missing" | "nonexistent"): string {
  return reason === "missing"
    ? "יש למלא תאריך ושעה תקינים."
    : "השעה שנבחרה אינה קיימת בתאריך הזה: בליל המעבר לשעון קיץ השעון מדלג מ-02:00 ל-03:00. בחרו שעה אחרת.";
}

/** התאריך הישראלי כתווית `YYYY-MM-DD` — הבסיס לכל חשבון הלוח כאן. */
function jerusalemDayLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JERUSALEM_TZ }).format(at);
}

/** חצות ישראלית, `days` ימי לוח מהיום הישראלי של `at`. */
function shiftJerusalemDays(at: Date, days: number): Date {
  const anchor = new Date(`${jerusalemDayLabel(at)}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return jerusalemWallIsoToUtc(`${anchor.toISOString().slice(0, 10)}T00:00:00.000`);
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

/**
 * שעת קיר ישראלית → ערך ל-`datetime-local` (`YYYY-MM-DDTHH:MM`).
 *
 * ‎`datetime-local` הוא שדה **חסר אזור זמן** לפי הגדרתו, והדפדפן
 * מציג בו בדיוק את המחרוזת שנתנו לו. לכן „הזמן המקומי” שהשדה
 * מדבר בו הוא מה שאנחנו מחליטים — ובמערכת שכל מועדיה ישראליים,
 * זה שעון ישראל ולא שעון המכשיר.
 *
 * ‎`getHours()` היה נותן את שעת המכשיר: משימה שמועדה 10:00 בישראל
 * נפתחה על 03:00 בניו-יורק, ושמירה החזירה אותה ל-10:00 ניו-יורקית
 * — כלומר 17:00 בישראל. סימטרי, ולכן בלתי נראה בבדיקה מקומית,
 * ושגוי בכל מכשיר שאינו על שעון ישראל.
 */
export function jerusalemLocalInputValue(at: Date): string {
  const { date, time } = jerusalemWallParts(at);
  return `${date}T${time}`;
}

/**
 * הצד השני: ערך `datetime-local` → רגע UTC, עם אותן שתי הסיבות
 * לסירוב כמו ב-`resolveJerusalemWall` — ואותו עוגן, כדי ששמירה
 * שלא נגעה במועד לא תזיז אותו בליל מעבר השעון.
 */
export function resolveJerusalemLocalInput(
  value: string,
  current: Date | null,
): JerusalemWallResult {
  const [date, time] = value.split("T");
  return resolveJerusalemWall(date ?? "", time ?? "", current);
}
