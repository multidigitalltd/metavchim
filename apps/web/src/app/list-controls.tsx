"use client";

import type { ChangeEvent, ReactNode } from "react";

/**
 * פקדי סינון/מיון משותפים לעמודי הרשימות (נכסים, קונים, לידים).
 * הסינון רץ בצד הלקוח — הרשימות מוגבלות ל-100 פריטים מה-API, גודל
 * שמתאים למשרד קטן; כשיידרש עמוד־עמוד, הסינון יעבור לשרת.
 */

const inputStyle = {
  borderColor: "var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
} as const;

export function SearchField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-48 flex-1 flex-col gap-1 sm:max-w-xs">
      <span className="mv-visually-hidden">{props.label}</span>
      <input
        type="search"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2"
        style={inputStyle}
      />
    </label>
  );
}

export function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: [string, string][];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="mv-visually-hidden">{props.label}</span>
      <select
        value={props.value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value)}
        className="mv-select"
      >
        <option value="">{props.allLabel}</option>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SortSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="mv-visually-hidden">מיון</span>
      <select
        value={props.value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value)}
        className="mv-select"
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            מיון: {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** מונה חי — מוקרא גם לקורא מסך בכל שינוי סינון */
export function ResultsCount(props: { shown: number; total: number; noun: string }) {
  return (
    <p aria-live="polite" className="text-sm" style={{ color: "var(--color-text-muted)" }}>
      {props.shown === props.total
        ? `${props.total} ${props.noun}`
        : `מציג ${props.shown} מתוך ${props.total} ${props.noun}`}
    </p>
  );
}

/**
 * הערת גבול — הסינון והמיון המקומיים רואים רק את עמוד ה-API האחרון
 * (100 פריטים), ולכן פריט ישן שתואם עלול לא להופיע.
 */
export function CapNote(props: { show: boolean; noun: string }) {
  if (!props.show) return null;
  return (
    <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
      הסינון והמיון חלים על 100 ה{props.noun} האחרונים בלבד — לחיפוש בכל המאגר
      השתמשו בחיפוש הכללי.
    </p>
  );
}

/**
 * שורת סינון אחידה לכל מסכי הרשימה: חיפוש, מסננים, מיון, מונה חי
 * וכפתור ניקוי שמופיע רק כשיש מה לנקות.
 *
 * הפקדים עצמם מגיעים כ-children — לכל מסך יש מסננים משלו, אבל
 * הפריסה, המונה וההתנהגות של "נקה" זהים בכולם.
 */
export function FilterBar(props: {
  children: ReactNode;
  shown: number;
  total: number;
  noun: string;
  /** האם מופעל סינון כלשהו כרגע — קובע אם מוצג כפתור הניקוי. */
  active: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      {props.children}
      <ResultsCount shown={props.shown} total={props.total} noun={props.noun} />
      {props.active ? (
        <button type="button" className="mv-btn-plain" onClick={props.onClear}>
          נקה סינון
        </button>
      ) : null}
    </div>
  );
}

/** צ'יפים לסינון מהיר — הדפוס מקובץ העיצוב (ערים בנכסים, סוגי שיחות). */
export function FilterChips(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [value: string, label: string][];
}) {
  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap items-center gap-2">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="mv-chip"
          aria-pressed={props.value === value}
          onClick={() => props.onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** התאמת טקסט חופשי — השוואה סלחנית ללא רגישות לרווחים/אותיות */
export function textMatches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}
