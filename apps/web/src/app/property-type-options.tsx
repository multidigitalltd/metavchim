import { Fragment } from "react";
import { SHARED_TABU_PROPERTY_TYPE } from "@metavchim/shared";
import { propertyTypeGroups } from "@/lib/format";

/**
 * אפשרויות סוג הנכס לבורר — עם „מסחרי” כקבוצה.
 *
 * רכיב ולא פונקציה ב-`format.ts`, כי `format.ts` הוא `.ts` ואינו
 * נושא JSX. החלוקה עצמה (`propertyTypeGroups`) נשארת שם, ליד
 * הטבלה שהיא נגזרת ממנה.
 *
 * ‎**ארבעת המסכים משתמשים בזה** — נכס חדש, עריכת נכס, המרת ליד
 * ודרישות קונה — ולכן קבוצה שתתווסף לטבלה מגיעה לארבעתם יחד.
 */
export function PropertyTypeOptions({
  exclude = [],
  keep,
}: {
  /**
   * ערכים שכבר נבחרו ולכן אינם מוצעים שוב (בורר הדרישות של הקונה).
   *
   * ‎**קבוצה שהתרוקנה נעלמת** ולא נשארת ככותרת ריקה: „מסחרי” בלי
   * ענפים מתחתיו הוא כותרת שאי אפשר לבחור בה דבר.
   */
  exclude?: readonly string[];
  /**
   * ‎**הערך ששמור על השורה הזו, כדי שלא יוחלף בשקט** (ביקורת Codex, P1).
   *
   * ‎`shared_tabu` אינו סוג מבנה אלא **עובדה משפטית**, ולכן הוא
   * ‏ירד מרשימת ההצעות: כל עוד הוא הוצע, מתווך שבחר בו והשאיר את
   * ‏התיבה החדשה ריקה שלח `propertyType: "shared_tabu"` יחד עם
   * ‏`sharedTabu: false` — ו-`fieldsToColumns` קורא את הצירוף הזה
   * ‏כ„פרישת הייצוג הישן”, כלומר מוחק את שניהם. הסיווג שהמתווך
   * ‏בחר בו נעלם בשקט.
   *
   * ‏אבל בעריכה של שורה **שכבר** נושאת אותו הוא חייב להישאר בבורר:
   * ‏בלעדיו `defaultValue` לא מתאים לשום אפשרות, והבורר נופל
   * ‏לאפשרות הראשונה — כלומר שמירה סתמית הייתה משנה את הסוג. את
   * ‏ההסבה מבצע `sharedTabu`, שממילא מסומן שם מראש.
   */
  keep?: string | null | undefined;
} = {}) {
  const groups = propertyTypeGroups()
    .map((group) => ({
      ...group,
      options: group.options.filter(
        (option) =>
          !exclude.includes(option.value) &&
          (option.value !== SHARED_TABU_PROPERTY_TYPE || keep === SHARED_TABU_PROPERTY_TYPE),
      ),
    }))
    .filter((group) => group.options.length > 0);
  return (
    <>
      {groups.map((group, index) =>
        group.label === undefined ? (
          <Fragment key={`root-${index}`}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Fragment>
        ) : (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ),
      )}
    </>
  );
}
