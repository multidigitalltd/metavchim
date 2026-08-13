/**
 * משימות אוטומטיות קבועות — מתי הן נוצרות.
 *
 * כל משרד עובד בקצב אחר: אחד עושה סבב טלפונים לכל הקונים בימי ראשון,
 * אחר מעדכן בעלי נכסים בכל ראשון לחודש. עד כה מי שרצה כזה דבר היה
 * צריך לזכור אותו בעצמו, וזה בדיוק מה שנופל ברגע שיש לחץ.
 *
 * הקובץ הזה לא נוגע בבסיס נתונים ולא יוצר משימות: הוא עונה על שאלה
 * אחת — **מתי המופע הבא**. זו השאלה שקל לטעות בה בשקט: יום בחודש
 * שלא קיים בפברואר, מעבר שעון, ומופע שכבר נוצר וייווצר שוב.
 */

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

import { JERUSALEM_TZ, jerusalemOffsetMs } from "./israel-time.js";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /**
   * ימי השבוע למופע שבועי — 0 (ראשון) עד 6 (שבת).
   * ריק במופע שבועי פירושו "פעם בשבוע ביום שבו נוצר הכלל".
   */
  weekdays?: number[];
  /**
   * יום בחודש למופע חודשי (1–31).
   *
   * **31 בחודש קצר נופל ליום האחרון ולא מדלג על החודש.** משרד שקבע
   * "סיכום ב-31" מתכוון לסוף החודש, ודילוג על פברואר היה משאיר אותו
   * בלי סיכום בלי שאיש ישים לב.
   */
  dayOfMonth?: number;
  /** שעה ביום (0–23) בשעון ישראל. */
  hour: number;
  /** דקה (0–59). */
  minute: number;
}

/** תקינות הכלל — הודעה בעברית או `null`. */
export function recurrenceRejectionReason(rule: RecurrenceRule): string | null {
  if (!["daily", "weekly", "monthly"].includes(rule.frequency)) return "תדירות לא מוכרת";
  if (!Number.isInteger(rule.hour) || rule.hour < 0 || rule.hour > 23) return "שעה לא תקינה";
  if (!Number.isInteger(rule.minute) || rule.minute < 0 || rule.minute > 59) return "דקה לא תקינה";
  if (rule.frequency === "weekly") {
    const days = rule.weekdays ?? [];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return "יום בשבוע לא תקין";
  }
  if (rule.frequency === "monthly") {
    const day = rule.dayOfMonth;
    if (day !== undefined && (!Number.isInteger(day) || day < 1 || day > 31)) {
      return "יום בחודש חייב להיות בין 1 ל-31";
    }
  }
  return null;
}

/** מספר הימים בחודש — לטיפול ב-31 בפברואר. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * המופע הבא **אחרי** `after`.
 *
 * "אחרי" ולא "מ-" במכוון: מי שקורא לפונקציה מחזיק תמיד את המופע
 * האחרון שנוצר, ורוצה את הבא. שוויון מדויק היה מייצר את אותו מופע
 * פעמיים בכל ריצה שנופלת בדיוק על השעה.
 *
 * החישוב על שדות מקומיים של ה-`Date`. הצרכן היחיד הוא ה-Worker, שרץ
 * בשעון ישראל (TZ בקונטיינר), ולכן "09:00" הוא 09:00 מקומי — וזה מה
 * שהמשרד התכוון אליו.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  if (recurrenceRejectionReason(rule) !== null) return null;
  if (Number.isNaN(after.getTime())) return null;

  const at = (base: Date): Date => {
    const d = new Date(base);
    d.setHours(rule.hour, rule.minute, 0, 0);
    return d;
  };

  if (rule.frequency === "daily") {
    const today = at(after);
    if (today > after) return today;
    const tomorrow = new Date(after);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return at(tomorrow);
  }

  if (rule.frequency === "weekly") {
    const days = (rule.weekdays ?? []).length > 0 ? [...new Set(rule.weekdays)].sort() : [after.getDay()];
    // עד שבוע קדימה מכסה כל יום אפשרי; 0 = היום עצמו, אם השעה טרם עברה
    for (let offset = 0; offset <= 7; offset += 1) {
      const candidate = new Date(after);
      candidate.setDate(candidate.getDate() + offset);
      if (!days.includes(candidate.getDay())) continue;
      const withTime = at(candidate);
      if (withTime > after) return withTime;
    }
    return null;
  }

  // חודשי
  const wanted = rule.dayOfMonth ?? after.getDate();
  // שני חודשים קדימה מספיקים: או שהחודש הנוכחי עוד לפנינו, או הבא
  for (let offset = 0; offset <= 2; offset += 1) {
    const probe = new Date(after.getFullYear(), after.getMonth() + offset, 1);
    const year = probe.getFullYear();
    const monthIndex = probe.getMonth();
    // 31 בחודש קצר → היום האחרון בו, ולא דילוג על החודש
    const day = Math.min(wanted, daysInMonth(year, monthIndex));
    const candidate = at(new Date(year, monthIndex, day));
    if (candidate > after) return candidate;
  }
  return null;
}

/**
 * האם הגיע הזמן ליצור מופע.
 *
 * `lastRunAt` הוא המופע האחרון שכבר נוצר. `null` = הכלל חדש, והמופע
 * הראשון שלו הוא הראשון מרגע היצירה — לא רטרואקטיבית: כלל שנוצר היום
 * ומייצר מיד את כל המופעים של החודש שעבר הוא הצפה, לא תזכורת.
 */
export function isDue(rule: RecurrenceRule, lastRunAt: Date | null, now: Date, createdAt: Date): boolean {
  const since = lastRunAt ?? createdAt;
  const next = nextOccurrence(rule, since);
  return next !== null && next <= now;
}

const WEEKDAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** תיאור הכלל בעברית — מוצג במסך כדי שלא יהיה צורך לפענח שדות. */
export function describeRecurrence(rule: RecurrenceRule): string {
  const time = `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
  if (rule.frequency === "daily") return `כל יום ב-${time}`;
  if (rule.frequency === "weekly") {
    const days = rule.weekdays ?? [];
    if (days.length === 0) return `כל שבוע ב-${time}`;
    const names = [...new Set(days)].sort().map((d) => WEEKDAY_NAMES[d] ?? String(d));
    return `כל יום ${names.join(", ")} ב-${time}`;
  }
  const day = rule.dayOfMonth;
  if (day === undefined) return `כל חודש ב-${time}`;
  // 31 מנוסח כ"בסוף החודש" כי זה מה שהוא עושה בפועל בחודשים קצרים
  if (day === 31) return `בסוף כל חודש ב-${time}`;
  return `ב-${day} לכל חודש ב-${time}`;
}

/* ============================================================
   שעון ישראל
   ============================================================
   `nextOccurrence` עובד על השדות **המקומיים** של ה-Date, כלומר על
   שעון-קיר. זה מה שהמשרד התכוון אליו כשהוא כתב 09:00 — אבל תהליכי
   השרת רצים ב-UTC, ושם 09:00 מקומי הוא 12:00 בישראל.

   הפונקציות כאן עושות את התרגום פעם אחת, ומשמשות גם את הסורק שיוצר
   את המשימות וגם את התצוגה שמבטיחה למשתמש מתי זה יקרה. שתי גרסאות
   של ההמרה היו נפרדות ביום מעבר השעון — והמסך היה מבטיח שעה אחת
   בזמן שהסורק מריץ אחרת.
   ============================================================ */

/*
 * אזור הזמן וחישוב ההיסט מגיעים מ-`israel-time` ואינם מוגדרים כאן
 * שוב: שני עותקים של אותו חישוב DST נפרדים ביום שמתקנים אחד מהם.
 */

/**
 * שעת הקיר הירושלמית של רגע נתון, כ-Date שהשדות **המקומיים** שלו הם
 * אותה שעה — הצורה ש-`nextOccurrence` יודע לקרוא.
 */
export function toJerusalemWall(at: Date): Date {
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);
  return new Date(wall.replace(" ", "T"));
}

/**
 * הרגע (UTC) שבו שעת-קיר ירושלמית מתרחשת.
 *
 * ניחוש ותיקון כפול, כי ההיסט הנכון הוא זה שבתוקף ברגע המבוקש עצמו:
 * ביום מעבר שעון ההיסט של חצות שונה מזה של הצהריים.
 */
export function jerusalemWallToUtc(wall: Date): Date {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const iso = `${wall.getFullYear()}-${pad(wall.getMonth() + 1)}-${pad(wall.getDate())}T${pad(wall.getHours())}:${pad(wall.getMinutes())}:00.000Z`;
  const wallMs = new Date(iso).getTime();
  let guess = new Date(wallMs);
  for (let i = 0; i < 2; i += 1) guess = new Date(wallMs - jerusalemOffsetMs(guess));
  return guess;
}

/**
 * המופע הבא כרגע ב-UTC.
 *
 * **זו הפונקציה שכל צרכן אמיתי צריך.** `nextOccurrence` נשארת
 * מיוצאת כי היא הלוגיקה הטהורה שהבדיקות מכסות, אבל היא מדברת
 * שעון-קיר — ומי שיקרא לה ישירות בשרת יקבל שעה שגויה בשלוש שעות.
 */
export function nextOccurrenceUtc(rule: RecurrenceRule, since: Date): Date | null {
  const wall = nextOccurrence(rule, toJerusalemWall(since));
  return wall === null ? null : jerusalemWallToUtc(wall);
}
