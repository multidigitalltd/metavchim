"use client";

import { useState } from "react";

/**
 * תגיות המאפיינים בטפסי נכס — במקום דרופ-דאון לכל מאפיין.
 *
 * המצב נשאר תלת-מצבי בכוונה: "אין מעלית" הוא עובדה שמדירה את הנכס
 * אצל קונה שמעלית היא דרישת חובה שלו, בעוד "לא ידוע" רק מוריד ניקוד
 * (ביקורת Codex, PR ‏#1). צ'קבוקס דו-מצבי היה מוחק את ההבחנה הזו,
 * ולכן הלחיצה מגלגלת: ריק ← יש ← אין ← ריק. המקרה הנפוץ — לסמן
 * "יש" — נשאר לחיצה אחת.
 *
 * הערכים נשלחים דרך שדות חבויים כדי שהטפסים ימשיכו לקרוא אותם
 * מ-FormData בדיוק כמו מהדרופ-דאונים שהוחלפו.
 */

export type TriValue = "" | "yes" | "no";

const NEXT: Record<TriValue, TriValue> = { "": "yes", yes: "no", no: "" };
const STATE_LABEL: Record<TriValue, string> = { "": "לא ידוע", yes: "יש", no: "אין" };

/** boolean מהשרת → ערך התגית */
export function boolToTri(value: boolean | undefined): TriValue {
  return value === true ? "yes" : value === false ? "no" : "";
}

export function FeatureChips({
  features,
  initial,
}: {
  /** ‎[שם השדה, תווית]‎ — לפי סדר ההצגה */
  features: readonly (readonly [string, string])[];
  /** ערכים קיימים (בעריכה); חסר = הכול "לא ידוע" */
  initial?: Partial<Record<string, boolean | undefined>>;
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, TriValue>>(() =>
    Object.fromEntries(features.map(([name]) => [name, boolToTri(initial?.[name])])),
  );

  return (
    <fieldset className="mt-4">
      <legend className="mb-1 font-medium">מאפיינים</legend>
      <p className="m-0 mb-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
        לחיצה מסמנת שיש, לחיצה נוספת שאין, ושלישית מנקה — מה שלא סומן נחשב &quot;לא ידוע&quot;.
      </p>
      <div className="flex flex-wrap gap-2">
        {features.map(([name, label]) => {
          const value = values[name] ?? "";
          return (
            <button
              key={name}
              type="button"
              className="mv-chip"
              aria-pressed={value === "yes"}
              aria-label={`${label} — ${STATE_LABEL[value]}`}
              style={
                value === "no"
                  ? { borderColor: "var(--color-danger)", color: "var(--color-danger)" }
                  : undefined
              }
              onClick={() => setValues((prev) => ({ ...prev, [name]: NEXT[value] }))}
            >
              {value === "yes" ? "✓ " : value === "no" ? "✗ " : ""}
              {label}
              {value === "no" ? " — אין" : ""}
            </button>
          );
        })}
      </div>
      {features.map(([name]) => (
        <input key={name} type="hidden" name={name} value={values[name] ?? ""} />
      ))}
    </fieldset>
  );
}
