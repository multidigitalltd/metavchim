"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

/**
 * מה הקונה דורש — **הקבועים והמאפיינים שהמשרד הוסיף, באותה רשימה.**
 *
 * הצד הזה הוא מה שהופך מאפיין מותאם לאמיתי. בלעדיו סוכן יכול לסמן
 * "מיזוג מרכזי" על נכס ואף קונה לא יוכל לדרוש אותו — כלומר תגית
 * שאינה מנקדת דבר, ומסך שמבטיח יכולת שאינה קיימת.
 *
 * הרשימה המותאמת נטענת מקטלוג המשרד ולא מרשימה קבועה: היא מציגה
 * בדיוק את מה שכבר בשימוש, כך שהקונה יכול לדרוש רק מה שמישהו כבר
 * מסמן על נכסים.
 */

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function FeatureRequirements({
  builtin,
  initial,
}: {
  /** ‎[מפתח, תווית]‎ של חמשת הקבועים. */
  builtin: readonly (readonly [string, string])[];
  /** דרישות קיימות (בעריכה): מפתח → must/nice. */
  initial?: Record<string, string> | undefined;
}) {
  const [catalogue, setCatalogue] = useState<{ key: string; label: string }[]>(
    [],
  );

  useEffect(() => {
    apiGet<{ key: string; label: string }[]>("/buyers/feature-catalogue")
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  /*
   * מאפיין שהקונה כבר דורש אך נעלם מהקטלוג — הנכס היחיד שנשא אותו
   * נמחק — עדיין מוצג. אחרת הדרישה הייתה נעלמת מהמסך בשקט ונמחקת
   * בשמירה הבאה, בלי שאיש ביקש זאת.
   */
  const known = new Set(catalogue.map((option) => option.key));
  const orphaned = Object.keys(initial ?? {})
    .filter((key) => key.startsWith("custom:") && !known.has(key))
    .map((key) => ({ key, label: key.slice("custom:".length) }));
  const custom = [...catalogue, ...orphaned];

  return (
    <>
      <fieldset className="mt-4">
        <legend className="mb-2 font-medium">מאפיינים — חובה או עדיפות?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {builtin.map(([key, label]) => (
            <Row
              key={key}
              featureKey={key}
              label={label}
              initial={initial?.[key]}
            />
          ))}
        </div>
      </fieldset>

      {custom.length > 0 ? (
        <fieldset className="mt-4">
          <legend className="mb-2 font-medium">מאפיינים של המשרד</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {custom.map((option) => (
              <Row
                key={option.key}
                featureKey={option.key}
                label={option.label}
                initial={initial?.[option.key]}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

function Row({
  featureKey,
  label,
  initial,
}: {
  featureKey: string;
  label: string;
  initial?: string | undefined;
}) {
  const id = `feature_${featureKey}`;
  return (
    <div
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3"
      style={{ borderColor: "var(--color-border)" }}
    >
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <select
        id={id}
        name={id}
        defaultValue={initial ?? ""}
        className="rounded-md border px-2 py-1.5"
        style={inputStyle}
      >
        <option value="">לא רלוונטי</option>
        <option value="nice">עדיפות</option>
        <option value="must">חובה</option>
      </select>
    </div>
  );
}
