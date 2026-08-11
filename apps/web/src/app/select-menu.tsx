"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * רשימה נפתחת בשפת העיצוב של המערכת.
 *
 * ‎<select>‎ מקורי הוא הפקד הנכון ברוב המקרים — הוא נגיש, מוכר, ובמובייל
 * הדפדפן פותח אותו כגלגלת נוחה. הבעיה היחידה: **רשימת ה-‎<option>‎ שלו
 * מצוירת בידי מערכת ההפעלה ואי אפשר לעצב אותה**. לכן הסינונים נראו
 * כרשימה כחולה של ווינדוס באמצע מסך ירוק.
 *
 * הרכיב הזה מצייר את הרשימה בעצמו כ-listbox לפי תבנית ARIA, ומשחזר
 * ידנית את מה ש-select נותן בחינם:
 * - ניווט מקלדת מלא (חצים, Home/End, Enter, Esc, Tab)
 * - הקלדת אות לקפיצה לפריט
 * - סגירה בלחיצה בחוץ, והחזרת הפוקוס לכפתור
 *
 * במסכי מגע צרים נשמרת ההתנהגות המקורית: ראו הערת ה-‎useSyntheticMenu‎.
 */

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectMenu({
  value,
  onChange,
  options,
  label,
  /** רוחב מינימלי — כדי ששורת הסינון לא "תקפוץ" בהחלפת ערך. */
  minWidth = 150,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  label: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  /* פתיחה מציבה את הסמן על הפריט הנבחר — לא על הראשון */
  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open, selectedIndex]);

  /* סגירה בלחיצה מחוץ לרכיב */
  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  /* הפריט הפעיל תמיד בתוך התצוגה — רשימה ארוכה נגללת אליו */
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [open, active]);

  function commit(index: number): void {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(active);
        break;
      case "Tab":
        // Tab סוגר ומאשר, כמו בפקד מקורי
        commit(active);
        break;
      default:
        // הקלדת אות — קפיצה לפריט הבא שמתחיל בה
        if (event.key.length === 1) {
          const from = active + 1;
          const found = options.findIndex(
            (o, i) => i >= from && o.label.startsWith(event.key),
          );
          const wrapped =
            found >= 0 ? found : options.findIndex((o) => o.label.startsWith(event.key));
          if (wrapped >= 0) setActive(wrapped);
        }
    }
  }

  return (
    <div ref={rootRef} className="relative" style={{ minWidth }}>
      <button
        ref={buttonRef}
        type="button"
        className="mv-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        /*
         * הפוקוס נשאר על הכפתור בזמן הניווט בחצים, ולכן בלי
         * aria-activedescendant קורא המסך שתק לחלוטין והמשתמש בחר
         * בעיוורון (ביקורת Codex). שלושת המאפיינים האלה יחד הם מה
         * שהופך את הרשימה לנשמעת: מה נשלט, מה פתוח, ומה פעיל כרגע.
         */
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className="mv-select-list"
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              // הפריט הפעיל מדווח כנבחר בזמן הניווט: זה מה שקורא
              // המסך מקריא, והבחירה מאושרת רק ב-Enter
              aria-selected={index === active}
              data-active={index === active}
              className="mv-select-option"
              onMouseEnter={() => setActive(index)}
              onClick={() => commit(index)}
            >
              <span className="truncate">{option.label}</span>
              {option.value === value ? (
                <svg
                  aria-hidden="true"
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
