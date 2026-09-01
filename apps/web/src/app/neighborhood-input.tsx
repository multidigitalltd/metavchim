"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  neighborhoodKey,
  neighborhoodMatches,
  NEIGHBORHOOD_SUGGESTION_LIMIT,
} from "@metavchim/shared";
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

/**
 * מה שכבר נבחר בשדה — כל האסימונים חוץ מזה שנערך כרגע.
 *
 * ‎`neighborhoodKey` ולא הטקסט הגולמי: „שיכון ג'” ו„שיכון ג” הן
 * אותה שכונה, ורשימה שמכילה את שתיהן היא בדיוק הכפילות שהפיצ'ר
 * נועד למנוע — במיוחד כשהיא נוצרת מתוך ההצעות שלו עצמו.
 */
function completedKeys(value: string, multi: boolean): Set<string> {
  if (!multi) return new Set();
  const at = value.lastIndexOf(",");
  if (at === -1) return new Set();
  return new Set(
    value
      .slice(0, at)
      .split(",")
      .map(neighborhoodKey)
      .filter((key) => key !== ""),
  );
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
  /*
   * ‎**ההצעות נושאות את העיר שהן נשלפו עבורה** (ביקורת Codex).
   *
   * הסינון המקומי בודק את האסימון בלבד, ולכן שינוי עיר לא ביטל
   * אותן: בטופס נכס חדש, מי שמילא עיר ואז מיקד את שדה השכונה ראה
   * — במשך ההשהיה והרשת — הצעות מהעיר הקודמת או מהמאגר הכללי,
   * לחיצות וניתנות לבחירה ב-Enter. שם העיר צמוד לתוצאה, וההשוואה
   * מול העיר הנוכחית מוציאה אותן מיד.
   */
  const [suggestions, setSuggestions] = useState<{ city: string; names: string[] }>({
    city: "",
    names: [],
  });
  const [open, setOpen] = useState(false);
  /*
   * ‎**מה שמסומן נשמר כשם ולא כמיקום** (ביקורת Codex, סבב רביעי).
   *
   * בדיקת הגבולות שהוספתי קודם דחתה מדד ישן רק כשהרשימה החדשה
   * **קצרה יותר**. רשימה ארוכה דיה מהעיר החדשה השאירה אותו בתחום,
   * והוא הצביע על שורה אחרת לגמרי — Enter היה בוחר אותה בלי שהמתווך
   * ניווט אליה מעולם.
   *
   * שם אינו יכול להצביע על השורה הלא נכונה: הוא או קיים ברשימה
   * הנוכחית, ואז הסימון נכון גם אחרי החלפת עיר, או שאינו קיים ואז
   * אין סימון. זו החלפה של מחלקת באגים שלמה בהגדרה, ולא עוד שכבת
   * בדיקה מעליה.
   */
  const [activeName, setActiveName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  /*
   * ‎**הבקשה מבוטלת כשהקלט משתנה.** בלי זה תשובה של שאילתה ישנה
   * שחזרה מאוחר דורסת את ההצעות של מה שכבר הוקלד — הרשימה "קופצת"
   * אחורה בזמן, וזה נראה כמו תקלה.
   */
  useEffect(() => {
    const token = activeToken(value, multi).trim();
    /* אותו נרמול שההשוואה למטה משתמשת בו — אחרת רווח נגרר פוסל התאמה. */
    const requestedCity = city?.trim() ?? "";
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: token });
      if (requestedCity !== "") params.set("city", requestedCity);
      apiGet<{ suggestions: string[] }>(`/suggest/neighborhoods?${params.toString()}`)
        .then((res) => {
          if (controller.signal.aborted) return;
          setSuggestions({ city: requestedCity, names: res.suggestions });
        })
        /*
         * כשל אינו מרעיש: השדה עובד בלעדיו בדיוק כמו קודם, והצגת
         * שגיאה על השלמה אוטומטית מפחידה יותר משהיא עוזרת.
         */
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions({ city: requestedCity, names: [] });
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

  /*
   * ‎**סינון מקומי מעל מה שכבר בידינו — וזה מה שמעלים הצעות ישנות.**
   *
   * השרת עונה אחרי השהיה ורשת, ובין לבין הרשימה הציגה מועמדים
   * שאינם תואמים למה שכתוב בשדה; הצעה מסומנת כזו נבחרה ב-Enter
   * ודרסה את השדה בתוצאה לא קשורה (ביקורת Codex). הסינון כאן
   * מיידי ומשתמש **באותה** פונקציית התאמה שהשרת משתמש בה, ולכן
   * אינו יכול לחלוק עליו: הוא רק מקדים אותו.
   *
   * ולכן גם בלי הבהוב — מה שכבר תואם נשאר על המסך בזמן שהשרת
   * מרענן את המאגר, ומה שאינו תואם נעלם מיד.
   */
  const shown = useMemo(() => {
    /* תוצאה של עיר אחרת אינה „ישנה” אלא **שגויה** — היא יוצאת כולה. */
    if (suggestions.city !== (city?.trim() ?? "")) return [];
    const token = activeToken(value, multi);
    /*
     * ‎**מה שכבר נבחר יורד מהרשימה** (ביקורת Codex).
     *
     * אחרי בחירה והקלדת פסיק האסימון ריק, ואז *הכול* מתאים —
     * כולל השכונה שזה עתה נבחרה. בחירה חוזרת בה מוסיפה אותה
     * פעמיים, שני מסלולי השמירה של הקונה רק מפצלים ומנקים רווחים,
     * והכפילות נשמרת. גרוע מזה: שאילתת האוצר סופרת אותה פעמיים
     * ומנפחת את הדירוג של הצורה הזו — כלומר ההצעה מזינה את עצמה.
     */
    const taken = completedKeys(value, multi);
    return suggestions.names
      .filter((s) => neighborhoodMatches(s, token) && !taken.has(neighborhoodKey(s)))
      .slice(0, NEIGHBORHOOD_SUGGESTION_LIMIT);
  }, [suggestions, value, multi, city]);

  /*
   * המיקום נגזר מהשם בכל רינדור, ולכן אינו יכול להיות מיושן —
   * ואין צורך ב-`useEffect` שמאפס, שממילא רץ אחרי הרינדור ומשאיר
   * את חלון המרוץ שהוא אמור לסגור.
   */
  const activeIndex = activeName === null ? -1 : shown.indexOf(activeName);

  const visible = open && shown.length > 0;

  /*
   * ‎**נקודת כתיבה אחת.** גם הקלדה וגם בחירה מהרשימה עוברות כאן,
   * ולכן `onValueChange` אינו יכול לפספס אחת מהן — וזו בדיוק הטעות
   * שהייתה משאירה את מצב הכתובת מעודכן בהקלדה ותקוע בבחירה.
   */
  function commit(next: string): void {
    setValue(next);
    /*
     * ‎**האיפוס כאן ולא באפקט.** `active` הוא מה ש-Enter בוחר, ואפקט
     * רץ אחרי הרינדור — כלומר נשאר חלון שבו הקלדה כבר קרתה והבחירה
     * עדיין מצביעה על השורה הקודמת.
     */
    setActiveName(null);
    onValueChange?.(next);
  }

  function pick(suggestion: string): void {
    commit(withToken(value, multi, suggestion));
    setOpen(false);
    setActiveName(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!visible) {
      if (event.key === "ArrowDown" && shown.length > 0) {
        setOpen(true);
        event.preventDefault();
      }
      return;
    }
    if (event.key === "ArrowDown") {
      setActiveName(shown[(activeIndex + 1) % shown.length] ?? null);
      event.preventDefault();
    } else if (event.key === "ArrowUp") {
      setActiveName(shown[activeIndex <= 0 ? shown.length - 1 : activeIndex - 1] ?? null);
      event.preventDefault();
    } else if (event.key === "Enter" && activeIndex >= 0) {
      /*
       * ‎`preventDefault` רק כשההצעה נבחרת בפועל. Enter בלי הצעה
       * מסומנת חייב להמשיך לשלוח את הטופס כרגיל.
       */
      pick(shown[activeIndex]!);
      event.preventDefault();
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveName(null);
    }
  }

  /*
   * ‎**יציאה מהשדה סוגרת את הרשימה — גם בלי עכבר** (ביקורת Codex).
   *
   * הסגירה נשענה על `mousedown` מחוץ לרכיב בלבד, ולכן Tab מהשדה
   * הלאה — הדרך שבה ממלאים טופס במקלדת — השאיר את הרשימה פתוחה.
   * היא ממוקמת `absolute`, כך שהיא נשארה **מעל השדות הבאים**
   * וחסמה אותם.
   *
   * ‎`relatedTarget` הוא מה שקיבל את הפוקוס. מעבר בין השדה לכפתורי
   * ההצעות הוא פוקוס שנשאר בתוך הרכיב, ולכן אינו סוגר — ובחירה
   * בעכבר ממילא מוגנת ב-`preventDefault` על `mousedown`.
   */
  function onFocusOut(event: React.FocusEvent<HTMLDivElement>): void {
    if (rootRef.current?.contains(event.relatedTarget)) return;
    setOpen(false);
    setActiveName(null);
  }

  return (
    <div ref={rootRef} className="relative" onBlur={onFocusOut}>
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
        {...(visible && activeIndex >= 0 ? { "aria-activedescendant": `${listId}-${activeIndex}` } : {})}
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
          {shown.map((suggestion, index) => (
            <li key={suggestion} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex}>
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
                onMouseEnter={() => setActiveName(suggestion)}
                className="block w-full px-3 py-2 text-start"
                style={{
                  background: index === activeIndex ? "var(--color-field)" : "transparent",
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
