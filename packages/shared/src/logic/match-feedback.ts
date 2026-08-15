/**
 * למה התאמה נדחתה — **הדבר היחיד שמכייל את המנוע לפי מציאות.**
 *
 * עד כה דחייה הייתה `status = "dismissed"` וזהו. סוכן שדוחה שמונה
 * התאמות ביום מספר לנו שמונה פעמים שמשהו לא בסדר, ואנחנו לא שומעים
 * אף אחת מהן. משקלי ההתאמה ניתנים לעריכה במסך ההגדרות — אבל בלי
 * נתונים, הכיול הוא ניחוש.
 *
 * ## למה רשימה סגורה ולא טקסט חופשי
 *
 * טקסט חופשי אי אפשר לספור, וספירה היא כל התכלית: "63% מהדחיות
 * החודש היו על מחיר" הוא משפט שאפשר לפעול לפיו. הסיבות כאן ממופות
 * **אחת לאחת לקריטריוני הניקוד** — כך שדוח הדחיות מצביע ישירות על
 * המשקל שצריך לשנות, ולא רק מתאר תחושה.
 *
 * `not_interested` ו-`other` הן היוצאות מן הכלל, ובכוונה: לא כל
 * דחייה היא באג במנוע. לקוח שהחליט לא לקנות בכלל אינו ראיה נגד
 * שום קריטריון, ומיפוי כפוי שלו לאחד מהם היה מזהם את הדוח.
 */

import type { MatchCriterion } from "./matching.js";

export const DISMISS_REASONS = [
  "price",
  "location",
  "rooms",
  "property_type",
  "area",
  "features",
  "entry_date",
  "condition",
  "not_interested",
  "other",
] as const;

export type DismissReason = (typeof DISMISS_REASONS)[number];

export const DISMISS_REASON_LABEL: Record<DismissReason, string> = {
  price: "המחיר לא מתאים",
  location: "האזור לא מתאים",
  rooms: "מספר החדרים",
  property_type: "סוג הנכס",
  area: "השטח",
  features: "חסר מאפיין שהלקוח דורש",
  entry_date: "מועד הכניסה",
  condition: "מצב הנכס / איכות",
  not_interested: "הלקוח לא מחפש כרגע",
  other: "סיבה אחרת",
};

/**
 * הסיבה → הקריטריון שהיא מעידה עליו.
 *
 * `null` = הדחייה אינה מעידה על המנוע. ראו ההסבר למעלה.
 */
export const DISMISS_REASON_CRITERION: Record<DismissReason, MatchCriterion | null> = {
  price: "budget",
  location: "location",
  rooms: "rooms",
  property_type: "property_type",
  area: "area",
  features: "features_must",
  entry_date: "entry_date",
  /*
   * מצב הנכס אינו קריטריון בניקוד — המנוע אינו יודע לשקלל "משופצת
   * או לא", כי אין שדה כזה. דחייה כזו היא ראיה לשדה **חסר**, וזה
   * ממצא בפני עצמו שהדוח צריך להציג ולא לבלוע.
   */
  condition: null,
  not_interested: null,
  other: null,
};

export const MAX_DISMISS_NOTE = 200;

export interface DismissTally {
  reason: DismissReason;
  label: string;
  count: number;
  /** אחוז מכלל הדחיות שנרשמה להן סיבה. */
  percent: number;
  criterion: MatchCriterion | null;
}

export interface DismissReport {
  /** כמה דחיות נספרו — הבסיס לאחוזים. */
  total: number;
  tallies: DismissTally[];
  /**
   * המסקנה המעשית, או `null` כשאין מספיק נתונים.
   *
   * דוח שמציג אחוזים ומשאיר את המשתמש לפרש אותם הוא דוח שלא ייקרא.
   */
  insight: string | null;
}

/** מתחת לזה כל אחוז הוא רעש, ומסקנה ממנו גרועה מאין מסקנה. */
export const MIN_DISMISSALS_FOR_INSIGHT = 12;
/** מעל זה סיבה אחת שולטת מספיק כדי לומר עליה משהו. */
const DOMINANT_SHARE = 0.4;

/**
 * ריכוז הדחיות לדוח.
 *
 * הקלט הוא רשימת סיבות גולמית ולא ספירה מוכנה — הספירה היא חלק
 * מההיגיון, ולכן היא נבדקת.
 */
export function summarizeDismissals(reasons: readonly DismissReason[]): DismissReport {
  const counts = new Map<DismissReason, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);

  const total = reasons.length;
  const tallies: DismissTally[] = [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      label: DISMISS_REASON_LABEL[reason],
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
      criterion: DISMISS_REASON_CRITERION[reason],
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return { total, tallies, insight: buildInsight(total, tallies) };
}

function buildInsight(total: number, tallies: readonly DismissTally[]): string | null {
  if (total < MIN_DISMISSALS_FOR_INSIGHT) return null;
  const top = tallies[0];
  if (!top || top.count / total < DOMINANT_SHARE) {
    return "הדחיות מתפזרות על כמה סיבות — אין קריטריון בודד שדורש שינוי.";
  }
  if (top.reason === "not_interested") {
    return `${top.percent}% מהדחיות הן לקוחות שאינם מחפשים כרגע — זה סימן לבשלות הקונים ולא למנוע ההתאמות.`;
  }
  if (top.criterion === null) {
    return `${top.percent}% מהדחיות הן "${top.label}" — מאפיין שהמנוע אינו יודע לשקלל, כי אין לו שדה במערכת.`;
  }
  return (
    `${top.percent}% מהדחיות הן על ${top.label}. ` +
    `העלאת המשקל של "${top.criterion}" בהגדרות ההתאמה תוריד מלכתחילה התאמות כאלה.`
  );
}
