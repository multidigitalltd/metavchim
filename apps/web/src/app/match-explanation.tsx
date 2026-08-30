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

/*
 * ‎**טוקנים, ולא ערכי הקס — אותו תיקון שכבר נעשה בקובץ האחות.**
 *
 * ‏שלושת ערכי האפור כאן — `#F1F3EF`, `#DCE1D8`, `#5E6860` — הם
 * **בדיוק** אותם שלושה ש-`matches-empty-state.tsx` מתעד שהוחלפו
 * בטוקנים, כי הם הוקפאו בערכה הבהירה: בערכה הכהה זה אפור בהיר על
 * רקע כהה. אותו דבר בירוק. הבאג תוקן שם ונשאר כאן, בצ'יפים של
 * אותה לשונית בדיוק.
 */
const TONE: Record<MatchChipTone, { bg: string; border: string; fg: string }> = {
  /* ירוק — התחום שכבר מסמן „תקין” בכל המערכת */
  matched: {
    bg: "var(--domain-green-bg)",
    border: "var(--domain-green-line)",
    fg: "var(--domain-green-fg)",
  },
  /* ענבר — בדיוק הצמד מ-SPEC-4a לאזהרה שאינה שגיאה */
  partial: { bg: "var(--domain-amber-bg)", border: "var(--domain-amber-line)", fg: "var(--domain-amber-fg)" },
  /*
   * ‎**אפרסק — „חסר בנכס”, שהוא שדה שאפשר להשלים.**
   *
   * היה אפור, בנימוק ש„איש לא עשה כאן דבר שגוי”. הנימוק נכון לגבי
   * אשמה ושגוי לגבי פעולה: הצ'יפ הזה מופיע בדיוק על מה שהרצועה
   * הכתומה מעל הרשימה כבר קוראת להשלים („הנכס עדיין ללא מחיר”),
   * ושתי אמירות על אותו שדה בשני צבעים קוראות כשתי דחיפויות.
   *
   * אפרסק ולא ענבר, כדי ש„חסר” ו„חלקי” יישארו נבדלים: חלקי הוא
   * פער אמיתי בהתאמה, חסר הוא נתון שלא הוזן.
   */
  missing: {
    bg: "var(--domain-peach-bg)",
    border: "var(--domain-peach-line)",
    fg: "var(--domain-peach-fg)",
  },
};

/** ‎`✓` על מה שתואם, `!` על מה שדורש מבט — כמו בעיצוב. */
const MARK: Record<MatchChipTone, string> = {
  matched: "✓",
  partial: "!",
  missing: "!",
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
    /*
     * ‎**רצועה תחתונה של כרטיס, ולכן בלי מרווח ובלי פינות משלה.**
     *
     * ‏הרכיב היה מקונן בתוך עמודת השם, ושם `mt-2` ופינות תחתונות
     * היו הגיוניים. עכשיו הוא הילד האחרון של כרטיס ההתאמה, שחותך
     * את הפינות בעצמו (`overflow-hidden`) — מרווח עליון היה פותח
     * פס רקע בין הרצועה לשורה, ופינות כפולות היו נראות כשוליים
     * כפולים.
     */
    <div
      className="flex flex-wrap gap-1.5 px-4 py-2.5"
      style={{ borderTop: "1px solid var(--color-row-border)" }}
    >
      {chips.map((chip) => {
        const tone = TONE[chip.tone];
        return (
          <span
            key={chip.criterion}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[length:var(--type-caption-lg)] font-semibold"
            style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
          >
            {/*
              ‎**הסימן מעוצב ואינו נקרא.** „✓ חדרים תואם” בקורא מסך
              נשמע „סימן ביקורת חדרים תואם”; המילה „תואם” כבר אומרת
              את מה שהסימן מראה, ולכן הסימן מוסתר.
            */}
            <span aria-hidden="true">{MARK[chip.tone]}</span>
            {/*
              ‎**„תואם” נוסף כאן ולא בתווית המשותפת.** `matchChips`
              מחזיר „חדרים”, וזו אותה תווית שמסכים אחרים מציגים; מילת
              המצב שייכת לתצוגה הזו בלבד. שאר הטונים כבר נושאים את
              מצבם בתוך התווית („חסר בנכס: מחיר”, או הערת המנוע).
            */}
            {chip.tone === "matched" ? `${chip.label} תואם` : chip.label}
          </span>
        );
      })}
    </div>
  );
}
