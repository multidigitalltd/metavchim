/**
 * ‎**מרכזייה ששתקה — ומי שם לב.**
 *
 * ## למה זה קיים
 *
 * שני משרדים במערכת לא קיבלו אף אירוע מרכזייה במשך ארבעה וחמישה
 * ימים, ואיש לא ידע. משרד שלישי נפל באמצע יום עבודה, וזה התגלה רק
 * כשמתווך התלונן — חמש שעות ו-47 דקות של שיחות שהספק לא שלח ולא
 * ישלח, כי הוא אינו שומר מה שלא יצא.
 *
 * ‏תקלה במרכזייה אינה מרעישה: אין שגיאה, אין 500, אין שורה אדומה.
 * יש **היעדר** — וזה בדיוק מה ששום מסך אינו מציג. ההתראה כאן היא
 * הדבר היחיד שהופך היעדר לאירוע.
 *
 * ## למה חלון ניטור, ולא סתם סף
 *
 * משרד תיווך ישראלי סגור בשבת ובלילה. סף של „ארבע שעות בלי שיחה”
 * בלי חלון היה מתריע כל מוצאי שבת, כל בוקר, ופעמיים בכל חג —
 * והתראה שצועקת כשהכול תקין נכבית תוך שבוע. אחרי שהיא נכבית,
 * השתיקה האמיתית שוב אינה נראית.
 *
 * ‎**ולכן הסף נמדד בשעות מנוטרות בלבד.** יום שישי בערב אינו מקרב
 * את המשרד להתראה, ובוקר ראשון אינו פותח בגירעון של יומיים. זו
 * ההכרעה היחידה שהופכת את הפיצ'ר לשמיש.
 *
 * הכול טהור ומקבל את הרגע במפורש — הסבב שקורא לזה רץ בעובדים, ואת
 * ההחלטה אפשר לבדוק בלי מרכזייה, בלי מסד ובלי שעון.
 */

import { jerusalemWallParts, jerusalemWeekday } from "./israel-time.js";

/* ==================== חלון הניטור ==================== */

/**
 * מתי בכלל מצפים לשיחות.
 *
 * ‎**מנוסח כ„מתי כן”, ולא כ„מתי לא”.** שתי הצורות שקולות, אבל
 * שלילה כפולה („לא לנטר בשעות שאינן…”) היא בדיוק מה שגורם למשרד
 * להגדיר הפוך ולגלות זאת מהתראה שלא הגיעה.
 */
export interface PbxWatchWindow {
  /** ימי השבוע שבהם מנטרים — 0 ראשון … 6 שבת. */
  days: readonly number[];
  /** שעת הפתיחה, כולל. */
  fromHour: number;
  /** שעת הסגירה, לא כולל. */
  toHour: number;
}

/**
 * ברירת המחדל: ראשון עד חמישי, 09:00–19:00.
 *
 * שישי בחוץ בכוונה — במשרד תיווך ישראלי הוא יום חלקי שמסתיים
 * מוקדם, ומשרד שכן עובד בו יסמן אותו. עדיף להחמיץ התראה בשישי
 * מלייצר התראת שווא בכל שבוע.
 */
export const DEFAULT_PBX_WATCH: PbxWatchWindow = {
  days: [0, 1, 2, 3, 4],
  fromHour: 9,
  toHour: 19,
};

/** כמה שעות שתיקה עד שמתריעים, כברירת מחדל. */
export const DEFAULT_PBX_SILENT_HOURS = 4;

/** הגבולות שמסך ההגדרות ואימות הקלט חולקים. */
export const PBX_SILENT_MIN_HOURS = 1;
export const PBX_SILENT_MAX_HOURS = 72;

/** תוויות הימים, לפי אותו אינדקס — למסך ההגדרות. */
export const WEEKDAY_LABELS: readonly string[] = [
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
  "שבת",
];

/**
 * חלון שנשמר בעבר, סלחני בכוונה — כמו שאר ההגדרות.
 *
 * ‎**ריק אינו „אף פעם”.** משרד שביטל בטעות את כל הימים היה מכבה
 * את הניטור בלי לכבות אותו, כלומר בלי שהמסך יראה שהוא כבוי. חלון
 * בלי ימים נופל לברירת המחדל; מי שרוצה לכבות מכבה את האוטומציה.
 */
export function resolvePbxWatch(raw: unknown): PbxWatchWindow {
  if (typeof raw !== "object" || raw === null) return DEFAULT_PBX_WATCH;
  const source = raw as Record<string, unknown>;

  const days = Array.isArray(source["days"])
    ? [
        ...new Set(
          (source["days"] as unknown[]).filter(
            (day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];

  const hour = (key: string, fallback: number): number => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
    return value >= 0 && value <= 24 ? value : fallback;
  };
  const fromHour = hour("fromHour", DEFAULT_PBX_WATCH.fromHour);
  const toHour = hour("toHour", DEFAULT_PBX_WATCH.toHour);

  return {
    days: days.length === 0 ? DEFAULT_PBX_WATCH.days : days,
    // טווח הפוך או ריק אינו חלון — הוא הגדרה שנשמרה שבורה
    ...(fromHour < toHour ? { fromHour, toHour } : { fromHour: DEFAULT_PBX_WATCH.fromHour, toHour: DEFAULT_PBX_WATCH.toHour }),
  };
}

/* ==================== ההכרעה ==================== */

/** האם הרגע הזה נמצא בתוך חלון הניטור, לפי שעון ישראל. */
export function insideWatchWindow(at: Date, window: PbxWatchWindow): boolean {
  if (!window.days.includes(jerusalemWeekday(at))) return false;
  const hour = Number(jerusalemWallParts(at).time.slice(0, 2));
  return hour >= window.fromHour && hour < window.toHour;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * ‎**כמה זמן מנוטר עבר מאז הרגע הזה** — לא כמה זמן עבר.
 *
 * ## למה החלוקה לפרוסות ולא נוסחה סגורה
 *
 * החלון תלוי בשעון ישראל, וישראל מעבירה שעון פעמיים בשנה. נוסחה
 * שמניחה 24 שעות ליום נכונה חצי שנה, וביום המעבר היא שוגה בשעה
 * בדיוק — כלומר בגודל של הסף.
 *
 * ## ולמה **חפיפה** ולא ספירת דגימות
 *
 * הגרסה הראשונה ספרה כל דגימה כשעה מלאה, ולכן שני קצוות חלקיים
 * נספרו כשעתיים שלמות: שיחה אחרונה ב-10:59 וסבב ב-14:00 החזירו 4
 * — כלומר סף של ארבע שעות נפרץ אחרי שלוש שעות ודקה (ביקורת Codex).
 * בסף המינימלי של שעה זה חמור עוד יותר: חיבור שנוצר ב-11:59 היה
 * מתריע ב-12:00.
 *
 * כאן נצבר **הזמן בפועל**: כל פרוסה היא שעת-קיר ישראלית שלמה,
 * חתוכה בקצוות ל-`since` ול-`now`. מכיוון שגבולות החלון הם שעות
 * עגולות, דגימה אחת בתוך הפרוסה מסווגת אותה כולה נכון.
 */
export function monitoredHoursSince(
  since: Date | null,
  now: Date,
  window: PbxWatchWindow,
  capHours = 24 * 30,
): number {
  const floor = since === null ? now.getTime() - capHours * HOUR_MS : since.getTime();
  let counted = 0;
  let end = now.getTime();
  /*
   * ‎`+ 2` מעל התקרה: הפרוסה הראשונה והאחרונה חלקיות, ולכן מספר
   * הגבולות שנחצים גדול בפרוסה מכמות השעות.
   */
  for (let step = 0; step < capHours + 2 && end > floor; step += 1) {
    const inside = new Date(end - 1);
    const start = Math.max(floor, jerusalemHourStart(end));
    if (insideWatchWindow(inside, window)) counted += end - start;
    end = start;
  }
  return counted / HOUR_MS;
}

/**
 * תחילת שעת-הקיר הישראלית שהרגע שלפני `at` נמצא בתוכה.
 *
 * ‎**דקות ושניות של UTC, ולא של ישראל** — וזה נכון ולא קיצור דרך:
 * ההיסט של ישראל הוא מספר שלם של שעות (‎+2 ו-+3), ולכן הדקה
 * הישראלית והדקה ב-UTC זהות תמיד. גבול השעה משותף לשתיהן.
 */
function jerusalemHourStart(at: number): number {
  const d = new Date(at - 1);
  return (
    at -
    1 -
    (d.getUTCMinutes() * 60_000 + d.getUTCSeconds() * 1_000 + d.getUTCMilliseconds())
  );
}

export interface PbxSilenceInput {
  /** השיחה הנכנסת האחרונה, או `null` אם מעולם לא הייתה. */
  lastInboundAt: Date | null;
  now: Date;
  thresholdHours: number;
  window: PbxWatchWindow;
}

/**
 * האם להתריע עכשיו.
 *
 * שני תנאים, ושניהם נדרשים:
 *
 * 1. ‎**עכשיו בתוך החלון.** התראה שמגיעה ב-03:00 על שתיקה שהתחילה
 *    ב-17:00 מעירה את המשרד בלי שיוכל לעשות דבר, וזו הדרך הבטוחה
 *    לגרום לו לכבות אותה.
 * 2. ‎**עברו מספיק שעות מנוטרות.** ראו `monitoredHoursSince`.
 */
export function shouldAlertPbxSilence(input: PbxSilenceInput): boolean {
  if (!insideWatchWindow(input.now, input.window)) return false;
  return (
    monitoredHoursSince(input.lastInboundAt, input.now, input.window) >= input.thresholdHours
  );
}

/**
 * מפתח שמונע התראה חוזרת על אותה שתיקה.
 *
 * ‎**ליום, ולא לשעה.** מרכזייה שנפלה נשארת נפולה, והסבב רץ שוב ושוב
 * — בלי מפתח כזה המשרד היה מקבל התראה בכל סבב עד שיתקן. פעם ביום
 * אומרת את מה שצריך ואינה הופכת לרעש.
 */
export function pbxSilenceDedupeKey(tenantId: string, now: Date): string {
  return `pbx_silent:${tenantId}:${jerusalemWallParts(now).date}`;
}

/** מה ההתראה אומרת. שם המשרד בפנים — היא מגיעה גם למנהל הפלטפורמה. */
export function pbxSilenceMessage(input: {
  lastInboundAt: Date | null;
  now: Date;
  window: PbxWatchWindow;
}): { title: string; body: string } {
  // שעות שלמות בתצוגה — „3.4 שעות עבודה” אינו מה שמתווך רוצה לקרוא
  const hours = Math.floor(
    monitoredHoursSince(input.lastInboundAt, input.now, input.window),
  );
  return {
    title: "לא נקלטו שיחות מהמרכזייה",
    body:
      input.lastInboundAt === null
        ? "מעולם לא נקלטה שיחה נכנסת מהמרכזייה. בדקו את כתובת הוובהוק בהגדרות הספק."
        : `לא נקלטה שיחה נכנסת כבר ${hours} שעות עבודה. אם התקשרו אליכם בזמן הזה — הוובהוק אצל ספק המרכזייה כנראה כבוי.`,
  };
}
