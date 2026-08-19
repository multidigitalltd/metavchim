"use client";

import { useEffect, useState } from "react";
import {
  MAX_CUSTOM_FEATURES,
  MAX_FEATURE_LABEL,
  customFeatureKey,
  type CustomFeature,
} from "@metavchim/shared";
import { apiGet } from "@/lib/api";

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
  initialCustom = [],
}: {
  /** ‎[שם השדה, תווית]‎ — לפי סדר ההצגה */
  features: readonly (readonly [string, string])[];
  /** ערכים קיימים (בעריכה); חסר = הכול "לא ידוע" */
  initial?: Partial<Record<string, boolean | undefined>>;
  /** מאפיינים שהמשרד הוסיף, כפי שנשמרו על הנכס. */
  initialCustom?: readonly CustomFeature[];
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, TriValue>>(() =>
    Object.fromEntries(features.map(([name]) => [name, boolToTri(initial?.[name])])),
  );
  /*
   * המאפיינים המותאמים במצב נפרד, כי הם רשימה שגדלה ולא קבוצה
   * ידועה מראש. הם נשלחים כשדה חבוי אחד עם JSON — אותו דפוס
   * שהקבועים משתמשים בו, כדי שהטופס ימשיך לקרוא הכול מ-FormData.
   */
  const [custom, setCustom] = useState<CustomFeature[]>(() => [...initialCustom]);
  const [draft, setDraft] = useState("");
  const [catalogue, setCatalogue] = useState<{ key: string; label: string }[]>([]);

  /*
   * הקטלוג הוא מה שהופך "כל סוכן מוסיף בעצמו" לשמיש: הסוכן השני
   * שנתקל במיזוג בוחר את התווית של הראשון במקום להמציא אותה. בלי
   * זה, החופש להוסיף היה מפצל את המפתחות בדיוק כפי שהנרמול נלחם.
   */
  useEffect(() => {
    apiGet<{ key: string; label: string }[]>("/properties/feature-catalogue")
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  function addCustom(label: string): void {
    const clean = label.trim().slice(0, MAX_FEATURE_LABEL);
    const key = customFeatureKey(clean);
    if (key === "" || custom.length >= MAX_CUSTOM_FEATURES) return;
    setDraft("");
    // כפילות אינה שגיאה — היא פשוט לא מוסיפה שורה שנייה לאותו מפתח
    if (custom.some((f) => f.key === key)) return;
    setCustom((prev) => [...prev, { key, label: clean, value: true }]);
  }

  return (
    <fieldset className="mt-4">
      <legend className="mb-1 font-medium">מאפיינים</legend>
      <p className="m-0 mb-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
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

      {/* ---- מאפיינים שהמשרד הוסיף ---- */}
      {custom.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {custom.map((feature) => (
            <span key={feature.key} className="mv-custom-feature">
              <button
                type="button"
                className="mv-custom-feature-toggle"
                aria-pressed={feature.value}
                onClick={() =>
                  setCustom((prev) =>
                    prev.map((f) => (f.key === feature.key ? { ...f, value: !f.value } : f)),
                  )
                }
              >
                {feature.value ? "✓ " : "✗ "}
                {feature.label}
                {feature.value ? "" : " — אין"}
              </button>
              <button
                type="button"
                className="mv-custom-feature-remove"
                aria-label={`הסר ${feature.label}`}
                onClick={() => setCustom((prev) => prev.filter((f) => f.key !== feature.key))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {custom.length < MAX_CUSTOM_FEATURES ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label htmlFor="custom-feature-input" className="mv-visually-hidden">
            הוספת מאפיין
          </label>
          <input
            id="custom-feature-input"
            list="custom-feature-options"
            value={draft}
            maxLength={MAX_FEATURE_LABEL}
            placeholder="מאפיין נוסף — מיזוג, סורגים…"
            onChange={(event) => setDraft(event.target.value)}
            /*
             * Enter מוסיף ואינו שולח את הטופס. בלי המניעה הזו, סוכן
             * שהקליד מאפיין ולחץ Enter היה שומר נכס חלקי במקום
             * להוסיף תגית.
             */
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              addCustom(draft);
            }}
            className="rounded-lg border px-3 py-2"
            style={{
              borderColor: "var(--color-input-border)",
              background: "var(--color-field)",
              minWidth: 200,
            }}
          />
          <datalist id="custom-feature-options">
            {catalogue
              .filter((option) => !custom.some((f) => f.key === option.key))
              .map((option) => (
                <option key={option.key} value={option.label} />
              ))}
          </datalist>
          <button type="button" className="mv-btn-soft" onClick={() => addCustom(draft)}>
            הוסף מאפיין
          </button>
        </div>
      ) : null}

      {features.map(([name]) => (
        <input key={name} type="hidden" name={name} value={values[name] ?? ""} />
      ))}
      <input type="hidden" name="customFeatures" value={JSON.stringify(custom)} />
    </fieldset>
  );
}
