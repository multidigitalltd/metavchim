import {
  jerusalemDayStart,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  resolveJerusalemWall,
} from "./israel-time.js";
import { quickDueOptions } from "./quick-due.js";

/**
 * ‎**דחיית משימה, ושורת המצב שמעל הרשימה.**
 *
 * ## „דחה” נשען על הצ׳יפים ואינו מחשב בעצמו
 *
 * ‎`quick-due.ts` כבר יודע מהו „מחר בבוקר” בשעון ישראל, כולל ליל
 * מעבר שעון. חישוב שני כאן היה **שני חישובים שאמורים להסכים** —
 * ובדיוק המקום שבו הם מפסיקים: מישהו משנה את שעת הבוקר בצ׳יפ,
 * והדחייה נשארת על הישנה, בלי שדבר נראה שבור.
 *
 * ## ולמה מ„עכשיו” ולא מהמועד הקיים
 *
 * ‎„עוד יום מהמועד” על משימה שאיחרה בשבוע היה דוחה אותה **אל אתמול**
 * — כלומר כפתור שנלחץ ולא עושה דבר. מה שהמתווך מתכוון אליו כשהוא
 * לוחץ „דחה” הוא „לא עכשיו, מחר”.
 */

/**
 * ‎**„דחה” אף פעם לא מקדים** (ביקורת Codex).
 *
 * הגרסה הראשונה כתבה „מחר ב-9” בלי לקרוא את המועד הקיים, והכפתור
 * מוצג על **כל** משימה פתוחה — כלומר לחיצה על משימה שמועדה בשבוע
 * הבא הייתה **מקרבת** אותה למחר. „דחייה” שמקדימה היא בדיוק ההפך
 * ממה שכתוב על הכפתור.
 *
 * לכן היעד הוא המאוחר מבין שניים: „מחר בבוקר”, ויום לוח אחד אחרי
 * המועד הקיים **בשעתו**. משימה באיחור או בלי מועד נוחתת על מחר
 * בבוקר; משימה עתידית נדחקת יום קדימה ושומרת את שעתה.
 *
 * ‎`null` = אין מועד לחשב ממנו (הצ׳יפ אינו זמין) — והמסך אינו כותב
 * מועד שהוא לא הצליח לחשב.
 */
export function snoozeTaskDue(now: Date, currentDueAt?: Date | null): Date | null {
  const tomorrow = quickDueOptions(now).find((option) => option.key === "tomorrow");
  if (tomorrow === undefined) return null;
  const floor = jerusalemWallIsoToUtc(tomorrow.value);
  const shifted = currentDueAt ? nextDayKeepingTime(currentDueAt) : null;
  return shifted !== null && shifted.getTime() > floor.getTime() ? shifted : floor;
}

/**
 * יום לוח ישראלי אחד קדימה, **באותה שעת קיר**.
 *
 * לא „ועוד 24 שעות”: בליל מעבר השעון יום אינו 24 שעות, ומשימה
 * ל-09:00 הייתה נודדת ל-08:00 או ל-10:00 בלי שאיש נגע בה.
 */
function nextDayKeepingTime(at: Date): Date | null {
  const { time } = jerusalemWallParts(at);
  const { date } = jerusalemWallParts(jerusalemDayStart(at, 1));
  const resolved = resolveJerusalemWall(date, time, at);
  return resolved.ok ? resolved.at : null;
}

/**
 * שורת המצב מתחת לכותרת — „4 משימות פתוחות · אחת באיחור”.
 *
 * ‎**מספר בלבד אינו אומר אם יש בעיה.** „4” על מסך משימות הוא נתון
 * ניטרלי; „אחת באיחור” הוא מה שגורם למתווך לגלול. לכן האיחור מופיע
 * רק כשהוא קיים — שורה שכתוב בה „0 באיחור” מלמדת את העין להתעלם
 * ממנה, וביום שבו הוא כן קיים היא כבר בלתי נראית.
 */
export function openTasksSummary(open: number, overdue: number): string {
  const head =
    open === 0 ? "אין משימות פתוחות" : open === 1 ? "משימה פתוחה אחת" : `${open} משימות פתוחות`;
  if (overdue <= 0) return head;
  return `${head} · ${overdue === 1 ? "אחת באיחור" : `${overdue} באיחור`}`;
}
