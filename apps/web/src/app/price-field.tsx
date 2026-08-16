"use client";

import { useState } from "react";
import { priceInWordsWithCurrency } from "@metavchim/shared";

/**
 * שדה מחיר שמראה את הסכום גם במילים.
 *
 * מחיר נדל"ן הוא שבע ספרות, וספרה אחת עודפת הופכת דירה של 1,900,000
 * ל-19,000,000 — הפרש שנראה כמעט זהה במבט חטוף על שדה מספרי, ומתגלה
 * רק אחרי שההצעה כבר יצאה ללקוח. "תשעה עשר מיליון" ו"מיליון ותשע
 * מאות אלף" אינם דומים כלל, ולכן הטעות קופצת לעין בזמן ההקלדה.
 *
 * השורה מופיעה רק כשיש מה להציג: שדה ריק שמכריז "אפס" הוא רעש.
 */
export function PriceField({
  id,
  name,
  label,
  defaultValue,
  required = false,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: number | string;
  required?: boolean;
  /** הסבר קבוע מתחת לשדה, לצד המילים. */
  hint?: string;
}) {
  const [value, setValue] = useState<string>(
    defaultValue === undefined ? "" : String(defaultValue),
  );
  const words = priceInWordsWithCurrency(Number(value));

  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        min="0"
        step="1000"
        inputMode="numeric"
        required={required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full rounded-lg border px-3 py-2.5"
        style={{ borderColor: "var(--color-border)", background: "var(--color-field)" }}
      />
      {/*
        aria-live: מי שמקליד בעיוורון או משתמש בקורא מסך שומע את
        הסכום במילים בזמן ההקלדה — שם הבדיקה הזו נחוצה אף יותר.
      */}
      {/*
        האזור החי מורכב תמיד, גם כשהוא ריק.
        קורא מסך מכריז על **שינוי** בתוך אזור קיים, ולא על תוכן של
        אזור שזה עתה נוסף ל-DOM. בטופס יצירה השדה מתחיל ריק, ולכן
        הרכבה מותנית הייתה משתיקה בדיוק את המקרה הקריטי: הדבקת מחיר
        שלם בפעולה אחת (ביקורת Codex).
      */}
      <p
        aria-live="polite"
        className="m-0 mt-1 text-[12.5px] font-semibold"
        style={{ color: "var(--color-primary)", minHeight: "1.1em" }}
      >
        {words}
      </p>
      {words === "" && hint !== undefined ? (
        <p className="m-0 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
