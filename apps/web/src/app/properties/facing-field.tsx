"use client";

import { useState } from "react";
import {
  PROPERTY_FACING_LABELS,
  PropertyFacingSchema,
  type PropertyFacing,
} from "@metavchim/shared";

/**
 * ‎**חזית או עורף — פקד אחד לשני הטפסים.**
 *
 * ‏„חזית או עורף” היא אחת השאלות הראשונות בטלפון, ועד עכשיו לא
 * ‏היה לה איפה לשבת: מי ששאל רשם בהערות הפנימיות, ומשם זה לא
 * ‏חוזר לאף מסך (בקשת המשתמש).
 *
 * ## ‏למה צ׳יפים ולא בורר
 *
 * ‏שלוש אפשרויות קצרות שכולן נראות בבת אחת — בדיוק מה שהמאפיינים
 * ‏שמעליו כבר עושים, ולכן זה גם נראה כמו המשך שלהם ולא כמו שדה
 * ‏זר. בורר נפתח היה מסתיר את האפשרויות מאחורי לחיצה, על שאלה
 * ‏שהתשובה לה ידועה למתווך בשנייה.
 *
 * ## ‏למה לחיצה חוזרת מנקה
 *
 * ‏אותו נימוק של תגיות המאפיינים: מי שסימן בטעות חייב דרך חזרה
 * ‏ל„לא צוין”, ובלעדיה הערך היחיד שאי אפשר להגיע אליו הוא האמת.
 * ‏„לא צוין” נשאר **חוסר** ולא ערך רביעי.
 *
 * ‎**קובץ אחד ולא שניים.** קליטה ועריכה שאלו את אותה שאלה בשני
 * ‏עותקים היו נפרדות בשקט ביום שהניסוח משתנה.
 */

const OPTIONS: readonly PropertyFacing[] = PropertyFacingSchema.options;

export function FacingField({ value }: { value?: string }): React.ReactNode {
  /* ‏ערך שאינו מוכר (שורה ישנה, ייבוא) אינו מסמן צ׳יפ — ולא נבחר */
  const known = OPTIONS.find((option) => option === value);
  const [picked, setPicked] = useState<PropertyFacing | "">(known ?? "");

  return (
    <fieldset className="mt-4">
      <legend className="mb-1 font-medium">חזית או עורף</legend>
      <p
        className="m-0 mb-2 text-[length:var(--type-caption)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        לאיזה כיוון הדירה פונה — לחיצה נוספת על מה שנבחר מנקה, ומה שלא סומן נשאר
        &quot;לא צוין&quot;.
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className="mv-chip"
            aria-pressed={picked === option}
            onClick={() => setPicked((prev) => (prev === option ? "" : option))}
          >
            {picked === option ? "✓ " : ""}
            {PROPERTY_FACING_LABELS[option]}
          </button>
        ))}
      </div>
      {/* ‏השדה החבוי — כך שני הטפסים קוראים אותו מ-FormData כרגיל */}
      <input type="hidden" name="facing" value={picked} />
    </fieldset>
  );
}
