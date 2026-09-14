"use client";

import { useState } from "react";
import {
  PROPERTY_CONDITION_LABELS,
  PROPERTY_CONDITIONS,
  type PropertyCondition,
} from "@metavchim/shared";

/**
 * ‎**מצב הנכס — פקד אחד לשני הטפסים.**
 *
 * ## ‏למה זה נוסף עכשיו
 *
 * ‏השדה `condition` היה קיים בעמודה, בסכימה, בקטלוג הסוכן
 * ‏ובייבוא CSV — **ובשום מסך.** כלומר מתווך יכול היה להכתיב את
 * ‏המצב לסוכן הקולי ולראות אותו בכרטיס הרשת, אבל לא היה לו איפה
 * ‏להקליד אותו ואיפה לתקן אותו (בקשת המשתמש).
 *
 * ## ‏חמישה ערכים, מהטוב לפחות טוב
 *
 * ‏הסדר אינו אקראי: כך קוראים את הצ׳יפים בשורה בלי לחשוב, וכך
 * ‏גם השוואה בין שני נכסים נראית כמו סולם. „משופץ מהיסוד” הוא
 * ‏ערך ולא ניסוח של „משופץ” — ההפרש ביניהם הוא מאות אלפי שקלים.
 *
 * ## ‏למה צ׳יפים ולא בורר
 *
 * ‏אותו נימוק בדיוק כמו ב-`FacingField` שלצידו, וזו הסיבה שהם
 * ‏נראים כמו זוג: חמש אפשרויות קצרות שכולן נראות בבת אחת, על
 * ‏שאלה שהתשובה לה ידועה למתווך בשנייה. בורר נפתח היה מסתיר
 * ‏אותן מאחורי לחיצה.
 *
 * ## ‏למה לחיצה חוזרת מנקה
 *
 * ‏מי שסימן בטעות חייב דרך חזרה ל„לא צוין”, ובלעדיה הערך היחיד
 * ‏שאי אפשר להגיע אליו הוא האמת. „לא צוין” נשאר **חוסר** ולא
 * ‏ערך שישי.
 *
 * ‎**קובץ אחד ולא שניים.** קליטה ועריכה ששאלו את אותה שאלה בשני
 * ‏עותקים היו נפרדות בשקט ביום שהניסוח משתנה.
 */
export function ConditionField({ value }: { value?: string }): React.ReactNode {
  /* ‏ערך שאינו מוכר (שורה ישנה, ייבוא) אינו מסמן צ׳יפ — ולא נבחר */
  const known = PROPERTY_CONDITIONS.find((option) => option === value);
  const [picked, setPicked] = useState<PropertyCondition | "">(known ?? "");

  return (
    <fieldset className="mt-4">
      <legend className="mb-1 font-medium">מצב הנכס</legend>
      <p
        className="m-0 mb-2 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        לחיצה נוספת על מה שנבחר מנקה, ומה שלא סומן נשאר &quot;לא צוין&quot;.
      </p>
      <div className="flex flex-wrap gap-2">
        {PROPERTY_CONDITIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="mv-chip"
            aria-pressed={picked === option}
            onClick={() => setPicked((prev) => (prev === option ? "" : option))}
          >
            {picked === option ? "✓ " : ""}
            {PROPERTY_CONDITION_LABELS[option]}
          </button>
        ))}
      </div>
      {/* ‏השדה החבוי — כך שני הטפסים קוראים אותו מ-FormData כרגיל */}
      <input type="hidden" name="condition" value={picked} />
    </fieldset>
  );
}
