import { matchChips, type MatchChipTone } from "@metavchim/shared";
import type { MatchCriterion, ScoreComponent } from "@metavchim/shared";

/**
 * ‎**רצועת ההסבר מתחת לשורת ההתאמה (SPEC-4a §1).**
 *
 * „זה מה שהופך ציון לפעולה” — ובלעדיה השורה אומרת „‎87%” ולא אומרת
 * על מה. מתווך שרואה מספר בלי הרכב אינו יכול להחליט אם לשלוח, ובעיקר
 * אינו יודע מה לתקן כדי שההתאמה תשתפר.
 *
 * ## שלושה צבעים, ולא שניים
 *
 * ‎**ירוק** — נבדק ועבר. **ענבר** — נבדק, והתוצאה חלקית או שלילית;
 * הטקסט הוא ההערה שהמנוע ניסח, ולכן הוא מדויק („תקציב נמוך ב-5%”).
 * ‎**אפור** — **חסר בנכס**, ולכן לא היה מה להשוות.
 *
 * השלישי אינו גוון של השני. „הקונה לא מתאים” ו„לא מילאנו שדה” הן
 * מסקנות הפוכות, והן נראו זהות כל עוד שתיהן היו „לא ירוק”. האפור
 * הוא היחיד שהמתווך יכול לפעול עליו — ולכן הוא לא ייצבע בענבר.
 *
 * ## ומה שאינו צבע כלל
 *
 * קריטריון שהקונה פשוט לא ביקש — בלי תקציב מוגדר, בלי מאפיין
 * שסומן „נחמד שיהיה” — **אינו מוצג**. הוא אינו פער ואין מה להשלים
 * בו, וצביעתו באפור שלחה את המתווך לחפש שדה חסר בהתאמה שכבר מלאה
 * (ביקורת Codex). `propertyEvaluable` הוא מה שמפריד בין השניים.
 *
 * החלוקה עצמה נבדקת ב-`@metavchim/shared` (`matchChips`), כי כאן אין
 * הרצת בדיקות.
 */

const TONE: Record<MatchChipTone, { bg: string; border: string; fg: string }> = {
  /* ירוק — התחום שכבר מסמן „תקין” בכל המערכת */
  matched: { bg: "#E9F7EE", border: "#BCE3C9", fg: "#1E6B39" },
  /* ענבר — בדיוק הצמד מ-SPEC-4a לאזהרה שאינה שגיאה */
  partial: { bg: "var(--domain-amber-bg)", border: "var(--domain-amber-line)", fg: "var(--domain-amber-fg)" },
  /* אפור — „אין נתון”, ובמכוון לא אזהרה: איש לא עשה כאן דבר שגוי */
  missing: { bg: "#F1F3EF", border: "#DCE1D8", fg: "#5E6860" },
};

export function MatchExplanation({
  breakdown,
  propertyEvaluable,
}: {
  breakdown: ScoreComponent[];
  /** מה שהנכס מסוגל לו — ראו `propertyEvaluableCriteria` בחבילה. */
  propertyEvaluable: ReadonlySet<MatchCriterion>;
}): React.JSX.Element | null {
  /*
   * פירוט ריק — שורה שנכתבה לפני שהפירוט נשמר, או שכל רכיביה נפסלו
   * בקריאה. אין רצועה, ואין גם שורת „אין מידע”: השורה עצמה כבר
   * מציגה ציון והסבר מילולי, והוספת מסגרת ריקה מתחתיה אומרת פחות
   * מכלום.
   */
  const chips = breakdown.length === 0 ? [] : matchChips(breakdown, propertyEvaluable);
  if (chips.length === 0) return null;

  return (
    <div
      className="mt-2 flex flex-wrap gap-1.5 px-3 py-2"
      style={{
        background: "var(--domain-neutral-bg)",
        borderTop: "1px solid #EDF0EA",
        borderRadius: "0 0 12px 12px",
      }}
    >
      {chips.map((chip) => {
        const tone = TONE[chip.tone];
        return (
          <span
            key={chip.criterion}
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[length:var(--type-caption-lg)] font-semibold"
            style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
          >
            {chip.label}
          </span>
        );
      })}
    </div>
  );
}
