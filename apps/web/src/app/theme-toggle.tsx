"use client";

import { useEffect, useState } from "react";

/**
 * בורר ערכת נושא: בהיר / כהה / אוטומטי לפי המכשיר.
 *
 * "אוטומטי" מוחק את התכונה מ-<html> וחוזר ל-prefers-color-scheme, כך
 * שהמערכת עוקבת אחרי מצב הלילה של המכשיר בלי לזכור בחירה. הבחירה
 * נשמרת ב-localStorage ומיושמת גם לפני הצביעה הראשונה (ראו
 * THEME_INIT_SCRIPT ב-layout) כדי שלא תהיה הבזקה של הצבע ההפוך.
 */

export type ThemeChoice = "light" | "dark" | "auto";

export const THEME_STORAGE_KEY = "mv-theme";

/**
 * רץ ב-<head> לפני הצביעה הראשונה. חייב להישאר קטן וללא תלויות —
 * הוא מוטמע כטקסט. עטוף ב-try כי localStorage חסום בגלישה פרטית
 * בחלק מהדפדפנים, ואסור שדף שלם ייפול בגללו.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

const OPTIONS: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "בהיר", icon: "☀️" },
  { value: "dark", label: "כהה", icon: "🌙" },
  { value: "auto", label: "אוטומטי", icon: "🖥️" },
];

export function ThemeToggle() {
  // null עד הקריאה מה-localStorage — מונע אי-התאמה בין השרת ללקוח
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      stored = null;
    }
    setChoice(stored === "light" || stored === "dark" ? stored : "auto");
  }, []);

  function select(value: ThemeChoice): void {
    setChoice(value);
    apply(value);
    try {
      if (value === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // גלישה פרטית — הבחירה תקפה לעמוד הנוכחי בלבד
    }
  }

  if (choice === null) return null;

  return (
    <fieldset className="border-0 p-0">
      <legend className="mb-2 font-medium">ערכת נושא</legend>
      <div
        role="radiogroup"
        aria-label="ערכת נושא"
        className="flex gap-1 rounded-lg border p-1"
        style={{ borderColor: "var(--color-border)" }}
      >
        {OPTIONS.map((option) => {
          const active = choice === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(option.value)}
              className="min-h-11 flex-1 rounded-md px-3 py-2 text-sm font-medium"
              style={{
                background: active ? "var(--color-primary)" : "transparent",
                color: active ? "var(--color-surface)" : "var(--color-text)",
              }}
            >
              <span aria-hidden="true">{option.icon}</span> {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
