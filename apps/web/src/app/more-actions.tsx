"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * ‎**„פעולות נוספות” — צורה אחת בשני רוחבי מסך.**
 *
 * ## הבקשה
 *
 * ‏בכותרת כרטיס הקונה ישבו חמישה כפתורים פתוחים כל הזמן. בעל
 * ‏המוצר ביקש שבדסקטופ הם ייאספו מאחורי כפתור אחד: „ככה זה יותר
 * ‏מסודר במקום שזה יהיה כל הזמן פתוח ויוצר מאוד עומס”. במובייל
 * ‏הם נשארים גלויים — שם הם גריד ארבע פעולות במרחק אגודל, וזה מה
 * ‏שקובץ העיצוב מבקש.
 *
 * ## ‏למה `disclosure` ולא `role="menu"`
 *
 * ‏ב-`ConvertMenu` וב-`SelectMenu` הפריטים הם טקסט, ולכן שם
 * ‎`aria-activedescendant` הוא הפתרון הנכון. כאן הפריטים הם
 * ‏**קישורים אמיתיים** — `tel:`, `wa.me`, ניווט פנימי — ורכיב עם
 * ‏מצב משלו. תפריט ARIA היה גוזל מהם את הפוקוס ואיתו את הלחיצה
 * ‏האמצעית, „פתח בלשונית חדשה” והעתקת הכתובת.
 *
 * ‏לכן: כפתור עם `aria-expanded` שחושף פאנל, והפקדים שבתוכו
 * ‏נשארים מה שהם.
 *
 * ## ‏שני מצבים, עץ DOM אחד
 *
 * ‏הפקדים כתובים **פעם אחת**. במובייל ה-CSS מרדד את העטיפה
 * ‏(`display: contents`), מסתיר את הכפתור והפאנל הוא הגריד;
 * ‏בדסקטופ הפאנל צף והכפתור פותח אותו. שני עצים היו נפרדים זה
 * ‏מזה ביום שאחד מהם מתוקן — וכבר ראינו כאן מה עולה ניסיון לגשר
 * ‏על הפער הזה ב-`order`.
 *
 * ‎**הסגירה במובייל אינה נוגעת בכלום**: הפאנל שם גלוי תמיד מכוח
 * ‏ה-CSS, ולכן `open` הוא עניין של הדסקטופ בלבד. הכפתור מוסתר
 * ‏ב-`display: none` ולכן גם אינו קיים בעץ הנגישות שם.
 */
export function MoreActions({
  label = "פעולות נוספות",
  children,
}: {
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDocument(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setOpen(false);
      /* ‏הפוקוס חוזר לכפתור ולא נופל לתחילת הדף */
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocument);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mv-moreactions" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="mv-btn-plain mv-moreactions__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">•••</span>
        {label}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {/*
        ‎`data-open` ולא `hidden`: ההסתרה שייכת ל-CSS, כי במובייל
        ‏הפאנל גלוי תמיד. `hidden` היה מסתיר אותו גם שם.
      */}
      <div id={panelId} className="mv-moreactions__panel" data-open={open}>
        {children}
      </div>
    </div>
  );
}
