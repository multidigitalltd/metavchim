"use client";

import { useState } from "react";

/**
 * מועד כניסה/מסירה — בחירת **צורת התשובה** ולא רק יום בלוח.
 *
 * שדה תאריך לבדו אילץ את הסוכן לשקר: רוב הנכסים נמסרים "מיידי",
 * "גמיש" או "בתיאום עם השוכר", ומי שנאלץ לבחור יום בחר יום שרירותי —
 * ומנוע ההתאמות התייחס אליו כאילו הוא אמיתי. כאן בוחרים קודם את
 * המצב, ושדה התאריך מופיע רק כשיש לו משמעות.
 *
 * שדה ההערה תמיד פתוח: הניואנס האמיתי ("לאחר פינוי השוכר במאי",
 * "בכפוף לאישור משכנתה") לא נכנס לשום אנום, והוא מה שהקונה בצד השני
 * באמת צריך לדעת.
 *
 * הרכיב לא מנוהל מבחוץ — הוא כותב ל-`<input hidden>` בשמות המוסכמים,
 * כך שהוא משתלב בטפסים שעובדים עם `FormData` בלי לשנות אותם.
 */

const PROPERTY_MODES = [
  { value: "immediate", label: "מיידי", hint: "אפשר להיכנס עכשיו" },
  { value: "on_date", label: "בתאריך", hint: "מסירה ביום נקוב" },
  { value: "from_date", label: "החל מ-", hint: "פנוי מהתאריך ואילך" },
  { value: "flexible", label: "גמיש / בתיאום", hint: "ייקבע מול המוכר" },
] as const;

const BUYER_MODES = [
  { value: "immediate", label: "מיידי", hint: "צריך להיכנס עכשיו" },
  { value: "by_date", label: "עד תאריך", hint: "לא יאוחר מהתאריך" },
  { value: "flexible", label: "גמיש", hint: "אין אילוץ מועד" },
] as const;

type Mode = string;

function ModeButton({
  active,
  label,
  hint,
  onSelect,
}: {
  active: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={hint}
      className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold"
      style={{
        borderColor: active ? "var(--color-primary)" : "var(--color-border)",
        background: active ? "var(--color-primary-soft)" : "transparent",
        color: active ? "var(--color-primary)" : "inherit",
      }}
    >
      {label}
    </button>
  );
}

export function EntryTimingField({
  side,
  defaultMode,
  defaultDate,
  defaultNote,
  inputStyle,
}: {
  side: "property" | "buyer";
  defaultMode?: string;
  /** yyyy-mm-dd */
  defaultDate?: string;
  defaultNote?: string;
  inputStyle?: React.CSSProperties;
}) {
  const modes = side === "property" ? PROPERTY_MODES : BUYER_MODES;
  const dateField = side === "property" ? "entryDate" : "entryBy";
  /*
   * כרטיס ישן נושא תאריך בלי מצב. בלי הגזירה הזו הוא היה נפתח על
   * "לא נבחר", והסוכן שנגע בשדה אחר היה מוחק בלי כוונה את התאריך.
   */
  const [mode, setMode] = useState<Mode>(
    defaultMode ?? (defaultDate ? (side === "property" ? "on_date" : "by_date") : ""),
  );
  const [date, setDate] = useState(defaultDate ?? "");
  const needsDate = mode === "on_date" || mode === "from_date" || mode === "by_date";

  return (
    <div>
      <span className="mb-1 block font-medium">
        {side === "property" ? "מועד כניסה / מסירה" : "מתי צריך להיכנס"}
      </span>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {modes.map((m) => (
          <ModeButton
            key={m.value}
            active={mode === m.value}
            label={m.label}
            hint={m.hint}
            onSelect={() => setMode(mode === m.value ? "" : m.value)}
          />
        ))}
      </div>

      <input type="hidden" name="entryType" value={mode} />
      {/*
        התאריך נשלח רק כשהמצב דורש אותו. אחרת נכס ש"מיידי" היה נושא
        תאריך שנשאר מבחירה קודמת — ההפך המדויק ממה שהמסך מראה.
      */}
      <input type="hidden" name={dateField} value={needsDate ? date : ""} />

      {needsDate ? (
        <input
          type="date"
          aria-label={side === "property" ? "תאריך המסירה" : "התאריך שעד אליו"}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border px-3 py-2.5"
          style={inputStyle}
        />
      ) : null}

      {side === "property" ? (
        <input
          name="entryNote"
          maxLength={160}
          defaultValue={defaultNote ?? ""}
          placeholder="הערה למסירה — למשל: לאחר פינוי השוכר"
          className="mt-2 w-full rounded-lg border px-3 py-2.5"
          style={inputStyle}
        />
      ) : null}
    </div>
  );
}
