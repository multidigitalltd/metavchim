/**
 * ‎**מציון להחלטה — הפירוט כצ'יפים (SPEC-4a §1).**
 *
 * הציון לבדו אינו מספיק כדי להחליט אם לשלוח הצעה. „‎87%” אינו אומר
 * אם החדרים תואמים ורק השטח חסר, או שהתקציב בקושי עובר. המתווך
 * שמסתכל על השורה צריך לראות **על מה** נשען המספר, ובעיקר מה חסר —
 * כי זה מה שהוא יכול לתקן.
 *
 * ## שלושה מצבים, לא שניים
 *
 * ההבחנה שהפונקציה הזו קיימת בשבילה:
 *
 * - ‎**תואם** — הקריטריון נבדק ועבר.
 * - ‎**חלקי או נכשל** — נבדק, והתוצאה אינה מלאה. יש לו סיבה, והיא
 *   נכתבת בהערה שהמנוע כבר מנסח („תקציב נמוך ב-5%”).
 * - ‎**לא נבדק** — הקריטריון **אינו ברשימה כלל**, כי לאחד הצדדים
 *   חסר הנתון. אין לו ציון, ולא בגלל שהוא נכשל.
 *
 * השלישי הוא מה שהיה בלתי נראה: קריטריון שנכשל וקריטריון שלא נבדק
 * נראו שניהם כ„לא ירוק”. ההבדל ביניהם הוא ההבדל בין „הקונה הזה לא
 * מתאים” לבין „לא מילאנו שדה” — שתי מסקנות הפוכות מאותו מסך.
 *
 * ## למה כאן ולא ב-JSX
 *
 * ב-`apps/web` אין הרצת בדיקות, וזו החלטה עם שלושה ענפים וסדר.
 * אותו נימוק בדיוק שהעביר לכאן את `collectDictation` ואת
 * ‎`dictationErrorMessage`.
 */

import { MATCH_CRITERIA, type MatchCriterion, type ScoreComponent } from "../schemas/match.js";
import { DEFAULT_MATCH_WEIGHTS, MATCH_CRITERION_LABELS } from "./matching.js";

export type MatchChipTone = "matched" | "partial" | "missing";

export interface MatchChip {
  tone: MatchChipTone;
  /** מה שמוצג — תווית הקריטריון, או ההערה שהמנוע ניסח כשיש כזו. */
  label: string;
  criterion: MatchCriterion;
}

/**
 * ‎**סף ה„תואם”.**
 *
 * הניקוד הוא מספר ממשי, והשוואה ל-1 מדויק הייתה מסמנת `0.9999`
 * כחלקי. הסף אינו „כמעט” אלא הכרה בכך שהחישוב מגיע ל-1 דרך כפל
 * שברים.
 */
const FULL = 0.995;

/**
 * הפירוט ⟵ צ'יפים, בסדר שבו הם מוצגים.
 *
 * ‎**הסדר: תואם, אחר כך חלקי, אחר כך לא-נבדק** — ובתוך כל קבוצה לפי
 * המשקל, מהכבד לקל. זה הסדר שבו המתווך קורא: קודם למה כן, אחר כך
 * מה מפריע, ולבסוף מה אפשר להשלים.
 *
 * ‎**כל קריטריון מופיע בדיוק פעם אחת.** הרשימה נבנית מ-`MATCH_CRITERIA`
 * ולא ממה שהגיע בפירוט, ולכן אין תלות בסדר שבו המנוע דחף רכיבים —
 * וגם אין קריטריון שנשמט בשקט משום שהוא לא היה שם.
 */
export function matchChips(breakdown: readonly ScoreComponent[]): MatchChip[] {
  const byCriterion = new Map<MatchCriterion, ScoreComponent>();
  for (const part of breakdown) byCriterion.set(part.criterion, part);

  const chips: MatchChip[] = [];
  for (const criterion of MATCH_CRITERIA) {
    const part = byCriterion.get(criterion);
    const label = MATCH_CRITERION_LABELS[criterion];
    if (part === undefined) {
      chips.push({ tone: "missing", label: `לא נבדק: ${label}`, criterion });
      continue;
    }
    if (part.score >= FULL) {
      chips.push({ tone: "matched", label, criterion });
      continue;
    }
    /*
     * ההערה מנוסחת במנוע („רחוק מכל אזורי החיפוש”), ולכן היא מדויקת
     * יותר מכל ניסוח שנמציא כאן. כשאין — התווית לבדה, בלי להמציא
     * סיבה שאיננו יודעים.
     */
    chips.push({ tone: "partial", label: part.note ?? label, criterion });
  }

  const order: Record<MatchChipTone, number> = { matched: 0, partial: 1, missing: 2 };
  return chips.sort(
    (a, b) =>
      order[a.tone] - order[b.tone] ||
      DEFAULT_MATCH_WEIGHTS[b.criterion] - DEFAULT_MATCH_WEIGHTS[a.criterion],
  );
}
