"use client";

import { useEffect, useState, type FormEvent } from "react";

/**
 * סרגל הסינון של מסכי הרשימה — נכסים וקונים.
 *
 * רכיב אחד לשניהם: אותם שלושה סינונים (טקסט חופשי, טווח מחיר, טווח
 * חדרים) עם ניסוח שונה לכל מסך. שני עותקים היו נפרדים בפועל אחרי
 * השינוי הראשון.
 *
 * הטופס נשלח בלחיצה ולא בכל הקלדה: סינון שרץ על כל תו שולח שאילתה
 * לכל אות ומקפיץ את הרשימה מתחת לאצבע.
 */

export interface ListFilterValues {
  q: string;
  minPrice: string;
  maxPrice: string;
  minRooms: string;
  maxRooms: string;
}

export const EMPTY_FILTERS: ListFilterValues = {
  q: "",
  minPrice: "",
  maxPrice: "",
  minRooms: "",
  maxRooms: "",
};

/**
 * ניקוי מפרידי אלפים לפני השליחה.
 *
 * ההנחיה במסך מדגימה "1,000,000" — וזה בדיוק הערך שהיה נשלח כמות
 * שהוא, מתפרש כ-NaN בשרת, ומחזיר 400 עם הודעת טעינה כללית. משתמש
 * שמקליד את מה שכתוב בדוגמה לא אמור לקבל שגיאה (ביקורת Codex).
 */
function numericValue(raw: string): string {
  return raw.replace(/[,\s₪]/gu, "");
}

/** מחרוזת ה-query — רק שדות שמולאו בפועל. */
export function filtersToQuery(values: ListFilterValues): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const clean = key === "q" ? value.trim() : numericValue(value);
    if (clean !== "") params.set(key, clean);
  }
  const text = params.toString();
  return text === "" ? "" : `&${text}`;
}

export function hasActiveFilters(values: ListFilterValues): boolean {
  return Object.values(values).some((value) => value.trim() !== "");
}

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

export function ListFilters({
  values,
  onApply,
  searchLabel,
  searchHint,
  priceLabel,
}: {
  values: ListFilterValues;
  onApply: (next: ListFilterValues) => void;
  searchLabel: string;
  searchHint: string;
  priceLabel: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState(values);
  const [open, setOpen] = useState(hasActiveFilters(values));

  /*
   * הטיוטה מתעדכנת כשההורה משנה את הערכים.
   *
   * כפתור "נקה" של מסך הרשימה מאפס את ה-state של ההורה, אבל הרכיב
   * הזה כבר מורכב — בלי הסנכרון הוא היה ממשיך להציג את הטיוטה
   * הישנה, ולחיצה על "חפש" הייתה מחזירה את הסינון שכביכול נוקה
   * (ביקורת Codex).
   */
  useEffect(() => {
    setDraft(values);
  }, [values]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onApply(draft);
  }

  function clear(): void {
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  }

  function field(
    key: keyof ListFilterValues,
    label: string,
    placeholder: string,
  ): React.JSX.Element {
    return (
      <div>
        <label htmlFor={`flt-${key}`} className="mb-1 block text-xs font-semibold">
          {label}
        </label>
        <input
          id={`flt-${key}`}
          value={draft[key]}
          inputMode="numeric"
          placeholder={placeholder}
          onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
          className="w-full rounded-lg border px-2.5 py-2 text-sm"
          style={inputStyle}
        />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1" style={{ minWidth: 220 }}>
          <label htmlFor="flt-q" className="mb-1 block text-xs font-semibold">
            {searchLabel}
          </label>
          <input
            id="flt-q"
            value={draft.q}
            placeholder={searchHint}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          />
        </div>
        <button type="submit" className="mv-btn-action">
          חפש
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "פחות סינון" : "עוד סינון"}
        </button>
        {hasActiveFilters(draft) ? (
          <button type="button" className="mv-btn-plain" onClick={clear}>
            נקה
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className="mt-2 grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}
        >
          {field("minPrice", `${priceLabel} — מ־`, "1,000,000")}
          {field("maxPrice", `${priceLabel} — עד`, "2,500,000")}
          {field("minRooms", "חדרים — מ־", "3")}
          {field("maxRooms", "חדרים — עד", "5")}
        </div>
      ) : null}
    </form>
  );
}
