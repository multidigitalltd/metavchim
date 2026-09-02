import { Fragment } from "react";
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
}: {
  /**
   * ערכים שכבר נבחרו ולכן אינם מוצעים שוב (בורר הדרישות של הקונה).
   *
   * ‎**קבוצה שהתרוקנה נעלמת** ולא נשארת ככותרת ריקה: „מסחרי” בלי
   * ענפים מתחתיו הוא כותרת שאי אפשר לבחור בה דבר.
   */
  exclude?: readonly string[];
} = {}) {
  const groups = propertyTypeGroups()
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => !exclude.includes(option.value)),
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
