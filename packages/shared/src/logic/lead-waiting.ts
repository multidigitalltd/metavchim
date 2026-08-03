/**
 * "כמה זמן הליד ממתין" — המדד שמניע את מסך הלידים.
 *
 * ה-KPI במסמך החזון (§7) הוא שאף ליד לא נשאר בלי מענה מעל 24 שעות.
 * תאריך יצירה לבדו לא מייצר את התחושה הזו: "3 בפברואר" הוא מידע,
 * "ממתין יומיים" הוא קריאה לפעולה. לכן הפונקציה מחזירה גם ניסוח וגם
 * דרגת דחיפות שה-UI צובע לפיה.
 *
 * הזמן מוזרק (now) ולא נלקח מהשעון — כדי שהבדיקות יהיו דטרמיניסטיות.
 */

/** דרגת הדחיפות — ה-UI ממפה לצבע. */
export type LeadWaitingLevel = "ok" | "warn" | "late";

export interface LeadWaiting {
  hours: number;
  /** ניסוח עברי מלא, כולל צורת זוגי ("שעתיים", "יומיים") */
  label: string;
  level: LeadWaitingLevel;
}

/** סטטוסים שבהם הכדור אצל המתווך — רק הם נחשבים "ממתינים". */
const AGENT_OWNED_STATUSES = new Set(["new", "in_progress"]);

const WARN_AFTER_HOURS = 4;
const LATE_AFTER_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** עברית תקנית: 2 יחידות היא צורת זוגי, לא "2 שעות". */
function hebrewDuration(value: number, unit: "minute" | "hour" | "day"): string {
  const dual = { minute: "דקותיים", hour: "שעתיים", day: "יומיים" }[unit];
  const single = { minute: "דקה", hour: "שעה", day: "יום" }[unit];
  const plural = { minute: "דקות", hour: "שעות", day: "ימים" }[unit];
  if (value === 1) return single;
  if (value === 2) return dual;
  return `${value} ${plural}`;
}

/**
 * @param createdAt מועד כניסת הליד
 * @param status סטטוס הליד
 * @param now הזמן הנוכחי (מוזרק לבדיקות)
 * @returns null כשאין למה למהר — הליד נסגר, הומר, או שהכדור אצל הלקוח
 */
export function leadWaiting(
  createdAt: Date | string,
  status: string,
  now: Date,
): LeadWaiting | null {
  if (!AGENT_OWNED_STATUSES.has(status)) return null;

  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const elapsedMs = now.getTime() - created.getTime();
  // תאריך עתידי (שעון לא מסונכרן) — מתייחסים אליו כ"עכשיו", לא כשלילי
  const hours = Math.max(0, elapsedMs / HOUR_MS);

  const level: LeadWaitingLevel =
    hours >= LATE_AFTER_HOURS ? "late" : hours >= WARN_AFTER_HOURS ? "warn" : "ok";

  return { hours, label: `ממתין ${durationText(hours)}`, level };
}

function durationText(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return hebrewDuration(minutes, "minute");
  }
  if (hours < 24) return hebrewDuration(Math.floor(hours), "hour");
  return hebrewDuration(Math.floor(hours / 24), "day");
}

/**
 * סדר הטיפול במסך הלידים: קודם מה שסומן כדורש טיפול אנושי, ואחריו
 * הוותיק ביותר — הליד שהכי קרוב להפר את ה-KPI נמצא למעלה.
 */
export function compareLeadsByUrgency(
  a: { requiresHuman: boolean; createdAt: Date | string },
  b: { requiresHuman: boolean; createdAt: Date | string },
): number {
  if (a.requiresHuman !== b.requiresHuman) return a.requiresHuman ? -1 : 1;
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}
