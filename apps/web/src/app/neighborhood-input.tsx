"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiGet } from "../lib/api";

/**
 * ‎**שדה שכונה שמציע את מה שהמשרד כבר הקליד.**
 *
 * ## למה
 *
 * שם שכונה הוא טקסט חופשי, ולכן כל מתווך מקליד את אותה שכונה אחרת —
 * ‎`שיכון ג` ,`שיכון ג'` ,`שכונת שיכון ג׳`. שלוש הצורות הן שלוש
 * שכונות שונות בכל חיפוש, סינון ודוח, והמתווך השני אינו יודע
 * שהראשון כבר הקליד אותה. ההצעה מראה לו — והוא בוחר במקום להמציא.
 *
 * ‎**הרשימה אינה סוגרת את השדה.** אפשר להמשיך להקליד כל דבר, כולל
 * שכונה שאיש עוד לא הזין; זו הנקודה שבה השדה נשאר חופשי כפי שהיה.
 * ההצעה היא הזמנה, לא אילוץ.
 *
 * ## שדה יחיד מול רשימה מופרדת בפסיקים
 *
 * טופס הקונה שואל „שכונות” ברבים, מופרדות בפסיק; טופס הנכס שואל
 * שכונה אחת. `multi` מטפל בשניהם: במצב רשימה ההשלמה חלה על
 * ‎**האסימון שאחרי הפסיק האחרון** בלבד, ושאר מה שנכתב נשאר. השלמה
 * שהייתה דורסת את כל השדה הייתה מוחקת שכונות שכבר הוקלדו.
 */

/** השהיה לפני פנייה לשרת — הקלדה רגילה לא תייצר בקשה לכל תו. */
const DEBOUNCE_MS = 200;

/** האסימון שנערך כרגע: מה שאחרי הפסיק האחרון. */
function activeToken(value: string, multi: boolean): string {
  if (!multi) return value;
  const at = value.lastIndexOf(",");
  return at === -1 ? value : value.slice(at + 1);
}

/** החלפת האסימון הפעיל בהצעה שנבחרה, בלי לגעת בשאר. */
function withToken(value: string, multi: boolean, picked: string): string {
  if (!multi) return picked;
  const at = value.lastIndexOf(",");
  /*
   * ‎`, ` ולא `,` — הפורמט שהטופס עצמו מציג ב-placeholder, וגם מה
   * שהפיצול בשליחה מצפה לו. בלי הרווח השדה נראה צפוף אחרי כל בחירה.
   */
  return at === -1 ? picked : `${value.slice(0, at)}, ${picked}`;
}

export function NeighborhoodInput({
  id,
  name,
  defaultValue = "",
  placeholder,
  multi = false,
  city,
  required = false,
  onValueChange,
  style,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  /** רשימה מופרדת בפסיקים (טופס קונה) מול ערך יחיד (טופס נכס). */
  multi?: boolean;
  /**
   * העיר שנבחרה בטופס — מצמצמת את ההצעות.
   *
   * ‎„שיכון ג'” קיימת בכמה ערים ואינה אותה שכונה, ולכן הצעה מעיר
   * אחרת אינה עוזרת אלא מזיקה. ריק = בלי צמצום, וזה המצב בתחילת
   * הטופס לפני שמילאו עיר.
   */
  city?: string;
  required?: boolean;
  /**
   * מה שהוקלד — לטופס שמחזיק את הערך גם בעצמו.
   *
   * טופס הנכס מזין ממנו את מצב הכתובת (מפה וגאוקידוד), ורכיב שאינו
   * מדווח החוצה היה שובר את זה בשקט: השדה נראה מלא, והמפה אינה
   * יודעת עליו. נקרא גם בבחירה מהרשימה ולא רק בהקלדה.
   */
  onValueChange?: (value: string) => void;
  style?: React.CSSProperties;
}) {
  const [value, setValue] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  /*
   * ‎**הבקשה מבוטלת כשהקלט משתנה.** בלי זה תשובה של שאילתה ישנה
   * שחזרה מאוחר דורסת את ההצעות של מה שכבר הוקלד — הרשימה "קופצת"
   * אחורה בזמן, וזה נראה כמו תקלה.
   */
  useEffect(() => {
    const token = activeToken(value, multi).trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: token });
      if (city !== undefined && city.trim() !== "") params.set("city", city.trim());
      apiGet<{ suggestions: string[] }>(`/suggest/neighborhoods?${params.toString()}`)
        .then((res) => {
          if (controller.signal.aborted) return;
          setSuggestions(res.suggestions);
          setActive(-1);
        })
        /*
         * כשל אינו מרעיש: השדה עובד בלעדיו בדיוק כמו קודם, והצגת
         * שגיאה על השלמה אוטומטית מפחידה יותר משהיא עוזרת.
         */
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value, multi, city]);

  useEffect(() => {
    function onOutside(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const visible = open && suggestions.length > 0;

  /*
   * ‎**נקודת כתיבה אחת.** גם הקלדה וגם בחירה מהרשימה עוברות כאן,
   * ולכן `onValueChange` אינו יכול לפספס אחת מהן — וזו בדיוק הטעות
   * שהייתה משאירה את מצב הכתובת מעודכן בהקלדה ותקוע בבחירה.
   */
  function commit(next: string): void {
    setValue(next);
    onValueChange?.(next);
  }

  function pick(suggestion: string): void {
    commit(withToken(value, multi, suggestion));
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!visible) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      setActive((i) => (i + 1) % suggestions.length);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      event.preventDefault();
    } else if (event.key === "Enter" && active >= 0) {
      /*
       * ‎`preventDefault` רק כשההצעה נבחרת בפועל. Enter בלי הצעה
       * מסומנת חייב להמשיך לשלוח את הטופס כרגיל.
       */
      pick(suggestions[active]!);
      event.preventDefault();
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        name={name}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(visible && active >= 0 ? { "aria-activedescendant": `${listId}-${active}` } : {})}
        onChange={(event) => {
          commit(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border px-3 py-2.5"
        style={style}
      />
      {visible ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="שכונות שכבר הוזנו במשרד"
          className="absolute z-20 mt-1 w-full overflow-auto rounded-lg border py-1 shadow-lg"
          style={{
            maxHeight: "16rem",
            background: "var(--color-surface)",
            borderColor: "var(--color-border)",
          }}
        >
          {suggestions.map((suggestion, index) => (
            <li key={suggestion} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
              {/*
                ‎`onMouseDown` ולא `onClick`: הלחיצה מוציאה פוקוס
                מהשדה, וה-blur היה סוגר את הרשימה לפני שה-click
                מגיע — כלומר כפתור שנראה לחיץ ואינו עושה דבר.
              */}
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(suggestion);
                }}
                onMouseEnter={() => setActive(index)}
                className="block w-full px-3 py-2 text-start"
                style={{
                  background: index === active ? "var(--color-field)" : "transparent",
                  color: "var(--color-text)",
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
