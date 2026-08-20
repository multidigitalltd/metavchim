/**
 * כיול משקלי ההתאמה מסיבות הדחייה — **המנוע לומד ממה שהמשרד דוחה.**
 *
 * דוח הדחיות (match-feedback) כבר אומר למנהל "63% מהדחיות על מחיר —
 * העלו את משקל התקציב". הצעד הזה סוגר את הלולאה: במקום שהמנהל יקרא
 * דוח ויגרור מחוון, המערכת מזיזה את המחוון בעצמה — בצעדים קטנים,
 * חסומים ושקופים.
 *
 * ## עקרונות
 *
 * - **רק העלאות.** הניקוד משוקלל יחסית לסכום המשקלים, ולכן העלאת
 *   קריטריון שמייצר דחיות מקטינה מעצמה את ההשפעה היחסית של השאר.
 *   הורדה מפורשת הייתה מסתכנת בירידה מתחת לרצפת הקריטריונים
 *   הפוסלים ובסכום אפס — שני מצבים ש-resolveMatchWeights נבנה למנוע.
 * - **צעד קבוע וקטן** (CALIBRATION_STEP): כיול הוא סחיפה איטית לכיוון
 *   המציאות, לא קפיצה. משרד שחווה גל דחיות חריג לא מקבל מנוע שונה
 *   בן-לילה.
 * - **סף ראיות** — אותו סף של הדוח (MIN_DISMISSALS_FOR_INSIGHT):
 *   מסקנה מ-5 דחיות היא רעש, וכיול לפי רעש גרוע מאין כיול.
 * - **שקוף והפיך**: התוצאה מוחזרת עם פירוט מה השתנה וכמה, המסך מציג
 *   אותה, והמנהל יכול לגרור חזרה או לכבות את הכיול — הידני תמיד גובר.
 *
 * טהור ובדוק: הקלט הוא משקלים + רשימת סיבות, בלי מסד ובלי שעון.
 */

import {
  DISMISS_REASON_CRITERION,
  MIN_DISMISSALS_FOR_INSIGHT,
  type DismissReason,
} from "./match-feedback.js";
import type { MatchCriterion, MatchWeights } from "./matching.js";

/** בכמה עולה משקל בקריאה אחת. */
export const CALIBRATION_STEP = 0.05;
/** חלקה של סיבה מכלל הדחיות הממופות כדי להיחשב ראיה. */
export const CALIBRATION_MIN_SHARE = 0.25;
/** כמה קריטריונים מכוילים בקריאה אחת — סחיפה איטית, לא שכתוב. */
export const CALIBRATION_MAX_ADJUSTED = 2;
/** תקרת משקל — מעבר לה ההעלאה אינה אומרת דבר. */
const MAX_WEIGHT = 1;

export interface CalibrationAdjustment {
  criterion: MatchCriterion;
  from: number;
  to: number;
  /** חלק הדחיות שהעיד על הקריטריון — להסבר במסך. */
  share: number;
}

export interface WeightCalibration {
  weights: MatchWeights;
  adjusted: CalibrationAdjustment[];
}

/**
 * `null` = אין מה לכייל: מעט מדי ראיות, אין סיבה דומיננטית, או
 * שהקריטריונים הרלוונטיים כבר בתקרה. המתקשר מבחין בין "אין שינוי"
 * ל"שינוי" בלי לבדוק שוויון עמוק.
 */
export function calibrateMatchWeights(
  current: MatchWeights,
  reasons: readonly DismissReason[],
): WeightCalibration | null {
  /*
   * רק דחיות שמעידות על קריטריון. "הלקוח לא מחפש כרגע" ו"סיבה
   * אחרת" אינן ראיה נגד המנוע — ראו match-feedback — וספירה שלהן
   * בבסיס האחוזים הייתה מדללת ראיות אמיתיות.
   */
  const mapped = reasons
    .map((reason) => DISMISS_REASON_CRITERION[reason])
    .filter((criterion): criterion is MatchCriterion => criterion !== null);
  if (mapped.length < MIN_DISMISSALS_FOR_INSIGHT) return null;

  const counts = new Map<MatchCriterion, number>();
  for (const criterion of mapped) {
    counts.set(criterion, (counts.get(criterion) ?? 0) + 1);
  }

  const adjusted: CalibrationAdjustment[] = [...counts.entries()]
    .map(([criterion, count]) => ({ criterion, share: count / mapped.length }))
    .filter((entry) => entry.share >= CALIBRATION_MIN_SHARE)
    .sort((a, b) => b.share - a.share)
    .slice(0, CALIBRATION_MAX_ADJUSTED)
    .flatMap((entry) => {
      const from = current[entry.criterion];
      const to = round2(Math.min(MAX_WEIGHT, from + CALIBRATION_STEP));
      // כבר בתקרה — אין שינוי, ולכן אין מה לדווח
      if (to <= from) return [];
      return [{ criterion: entry.criterion, from, to, share: round2(entry.share) }];
    });

  if (adjusted.length === 0) return null;

  const weights: MatchWeights = { ...current };
  for (const change of adjusted) weights[change.criterion] = change.to;
  return { weights, adjusted };
}

/** שתי ספרות — משקל 0.30000000004 במסך ההגדרות הוא באג ויזואלי. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
