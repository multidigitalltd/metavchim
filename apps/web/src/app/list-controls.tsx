"use client";

import { useEffect } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { IconSearch, IconX } from "./icons";
import { SelectMenu } from "./select-menu";

/**
 * פקדי סינון/מיון משותפים לעמודי הרשימות (נכסים, קונים, לידים).
 * הסינון רץ בצד הלקוח — הרשימות מוגבלות ל-100 פריטים מה-API, גודל
 * שמתאים למשרד קטן; כשיידרש עמוד־עמוד, הסינון יעבור לשרת.
 */

export function SearchField(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mv-search-field">
      <span className="mv-visually-hidden">{props.label}</span>
      {/*
        זכוכית מגדלת בתוך השדה. `type="search"` לבדו נראה כמו כל
        שדה טקסט אחר בשורה, והמשתמש היה מגלה שהוא שדה חיפוש רק
        אחרי שקרא את הטקסט המרמז שבתוכו.
      */}
      <IconSearch s={16} />
      <input
        type="search"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
      />
    </label>
  );
}

/*
 * SelectMenu ולא ‎<select>‎ מקורי: רשימת ה-option של הפקד המקורי
 * מצוירת בידי מערכת ההפעלה, ולכן הסינונים נפתחו כרשימה כחולה של
 * ווינדוס באמצע מסך ירוק. ההחלפה כאן מספיקה לכל מסכי הרשימות.
 */
export function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: [string, string][];
}) {
  return (
    <SelectMenu
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      options={[
        { value: "", label: props.allLabel },
        ...props.options.map(([value, label]) => ({ value, label })),
      ]}
    />
  );
}

export function SortSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <SelectMenu
      label="מיון"
      value={props.value}
      onChange={props.onChange}
      minWidth={190}
      options={props.options.map(([value, label]) => ({ value, label: `מיון: ${label}` }))}
    />
  );
}

/** מונה חי — מוקרא גם לקורא מסך בכל שינוי סינון */
function ResultsCount(props: { shown: number; total: number; noun: string }) {
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
    /*
     * קופסה ולא שורה חופשית. הפקדים ריחפו קודם על הרקע בלי גבול,
     * ולכן הם נראו כמו המשך הכותרת ולא כמו אזור שליטה — והמונה,
     * שהוא התוצאה שלהם, נבלע ביניהם. עכשיו הוא בקצה הנגדי.
     */
    <div className="mv-filter-bar" data-active={props.active ? "on" : undefined}>
      {props.children}
      <span className="mv-filter-bar-end">
        <ResultsCount shown={props.shown} total={props.total} noun={props.noun} />
        {props.active ? (
          <button type="button" className="mv-filter-clear" onClick={props.onClear}>
            <IconX s={14} /> נקה סינון
          </button>
        ) : null}
      </span>
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

/**
 * אתחול מסנן מפרמטר בכתובת — ‎/leads?status=new‎ וחבריו.
 *
 * הדשבורד מקשר לרשימות מסוננות מכל פרוסה בגרף, אבל מסכי הרשימה
 * התעלמו מהפרמטרים ופתחו את הרשימה המלאה: הבטחה שלא קוימה (ביקורת
 * Codex).
 *
 * הקריאה ב-‎useEffect‎ ולא באתחול ה-state בכוונה: ‎window‎ אינו קיים
 * בעיבוד בשרת, ואתחול ממנו היה יוצר אי-התאמה בהידרציה. הריצה
 * חד-פעמית בטעינה, ולכן שינוי ידני של המסנן אחר כך אינו נדרס.
 */
export function useFilterFromUrl(
  params: Record<string, (value: string) => void>,
): void {
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    for (const [key, apply] of Object.entries(params)) {
      const value = search.get(key);
      if (value !== null && value !== "") apply(value);
    }
    // מערך תלויות ריק בכוונה: קריאה חד-פעמית בטעינה
  }, []);
}
