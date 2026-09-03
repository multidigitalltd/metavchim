"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IconChevronDown, IconFilter, IconSearch, IconX } from "./icons";
import { formatNumber } from "@/lib/format";

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

/**
 * ערך מספרי של שדה סינון — `undefined` לשדה ריק או לא־מספרי.
 *
 * מיוצא כדי שסינון שרץ בצד הלקוח (אזור הרשת) יקרא את השדות בדיוק
 * כמו שהשרת קורא אותם: אותה הסרה של מפרידי אלפים ואותה משמעות
 * ל"ריק". שני פירושים לאותו שדה הם באג שמתגלה רק אצל המשתמש.
 */
function filterNumber(raw: string): number | undefined {
  const clean = numericValue(raw);
  if (clean === "") return undefined;
  const value = Number(clean);
  return Number.isFinite(value) ? value : undefined;
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

/**
 * עצירות המחיר לציר.
 *
 * **לא סקאלה לינארית, ובכוונה.** הציר משרת גם מכירה (מיליונים) וגם
 * שכירות (אלפים בודדים); ציר לינארי עד 10 מיליון היה דוחס את כל
 * טווח השכירות לפיקסל אחד, וציר עד 20 אלף היה חסר משמעות למכירה.
 * העצירות צפופות היכן שיש נכסים ומתפזרות למעלה, וכך שתי הקבוצות
 * שמישות על אותו ציר.
 *
 * השדה המספרי נשאר לצדו: הציר הוא לבחירה מהירה, והמספר הוא לדיוק
 * ולכל ערך שאינו על עצירה.
 */
const PRICE_STOPS = [
  0, 1_000, 2_000, 3_000, 4_000, 5_000, 7_500, 10_000, 15_000, 20_000, 50_000,
  100_000, 250_000, 500_000, 750_000, 1_000_000, 1_250_000, 1_500_000,
  1_750_000, 2_000_000, 2_250_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000,
  5_000_000, 7_500_000, 10_000_000,
];

/** חדרים — טווח אמיתי של דירות, בחצאים. */
const ROOM_STOPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10];

/** האינדקס בעצירות הקרוב ביותר לערך; `null` לשדה ריק. */
function stopIndex(stops: readonly number[], raw: string): number | null {
  const value = filterNumber(raw);
  if (value === undefined) return null;
  let best = 0;
  for (let i = 1; i < stops.length; i += 1) {
    if (Math.abs(stops[i]! - value) < Math.abs(stops[best]! - value)) best = i;
  }
  return best;
}

const money = (value: number): string => formatNumber(value);

/**
 * ציר טווח — שני גוררים על אותה סקאלה.
 *
 * שני `input[type=range]` ולא רכיב חיצוני: זה נגיש במקלדת בחינם,
 * עובד במגע, ואינו מוסיף תלות. הגורר התחתון לעולם אינו עובר את
 * העליון — במקום לפסול את הפעולה, הוא דוחף אותו, כי משתמש שגורר
 * מעבר לגבול מתכוון להזיז את הטווח ולא לבטל את הגרירה.
 */
function RangeSlider({
  label,
  stops,
  minRaw,
  maxRaw,
  format,
  onChange,
}: {
  label: string;
  stops: readonly number[];
  minRaw: string;
  maxRaw: string;
  format: (value: number) => string;
  onChange: (next: { min?: string; max?: string }) => void;
}): React.JSX.Element {
  const last = stops.length - 1;
  const lo = stopIndex(stops, minRaw) ?? 0;
  const hi = stopIndex(stops, maxRaw) ?? last;

  /**
   * הערך שנשלח עבור עצירה — קצה פתוח נשלח כשדה ריק.
   *
   * העצירה האחרונה מוצגת כ"ומעלה", ולכן היא חייבת **לבטל** את
   * הגבול העליון ולא לשלוח 10,000,000. אחרת נכס ב-12 מיליון היה
   * נעלם מרשימה שהמסך מבטיח שהיא כוללת אותו — סינון שמסתיר תוצאות
   * בלי שהמשתמש ביקש הוא הרעה, לא סינון (ביקורת Codex).
   *
   * אותו היגיון בקצה התחתון כשהעצירה הראשונה היא 0: "מ־0" אינו
   * סינון, והשארתו בשדה מדליקה את "נקה" ואת מחוון הסינון הפעיל
   * בלי סיבה.
   */
  function raw(index: number, edge: "min" | "max"): string {
    if (edge === "max" && index === last) return "";
    if (edge === "min" && index === 0 && stops[0] === 0) return "";
    return String(stops[index]);
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span style={{ color: "var(--color-text-soft)" }}>
          {minRaw.trim() === "" && maxRaw.trim() === ""
            ? "הכול"
            : `${format(stops[lo]!)} – ${hi === last ? "ומעלה" : format(stops[hi]!)}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          aria-label={`${label} — מ־`}
          min={0}
          max={last}
          value={lo}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({
              min: raw(next, "min"),
              ...(next > hi ? { max: raw(next, "max") } : {}),
            });
          }}
          className="w-full"
        />
        <input
          type="range"
          aria-label={`${label} — עד`}
          min={0}
          max={last}
          value={hi}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange({
              max: raw(next, "max"),
              ...(next < lo ? { min: raw(next, "min") } : {}),
            });
          }}
          className="w-full"
        />
      </div>
    </div>
  );
}

const inputStyle = {
  borderColor: "var(--color-input-border)",
  background: "var(--color-field)",
} as const;

export function ListFilters({
  values,
  onApply,
  searchLabel,
  searchHint,
  priceLabel,
  card,
  layout = "card",
  view,
  children,
  childrenActive = false,
}: {
  values: ListFilterValues;
  onApply: (next: ListFilterValues) => void;
  searchLabel: string;
  searchHint: string;
  priceLabel: string;
  /**
   * ‎**צורת הכרטיס — כותרת עם אריח, ושדה שקוף.**
   *
   * בלי זה הרכיב נשאר טופס חשוף, וזו הצורה שכל שאר הרשימות מציגות.
   *
   * ‎`example` הוא **אופציונלי, וברירת המחדל היא בלי טקסט רפאים
   * כלל.** הרמז כבר נאמר בכותרת הכרטיס (`searchHint`), ומשפט דוגמה
   * ארוך בתוך שדה צר נקטע באמצע — כלומר הוא לא הדגים דבר, רק מילא
   * את השדה ברעש שנעלם ברגע שמקלידים. שדה ריק קורא נקי, והדוגמה
   * נשארת אפשרית למסך שבאמת צריך אותה.
   *
   * התווית של השדה נשארת ב-DOM ומוסתרת חזותית: היא מה שקורא מסך
   * מקריא, וכותרת הכרטיס אינה קשורה אליו ב-`htmlFor`.
   */
  card?: {
    example?: string;
    /**
     * ‎**בלי המרווח התחתון** — הכרטיס יושב בתוך רשת שמנהלת את
     * המרווחים בעצמה. `mb-[18px]` בתוך תא של רשת מוסיף מרווח
     * שהרשת לא ביקשה, והתוצאה היא טור אחד שנגמר נמוך מהשני.
     */
    flush?: boolean;
  };
  /**
   * ‎**`"inline"` — שורת חיפוש בתוך כרטיס של מישהו אחר.**
   *
   * ברשת שיתופי הפעולה החיפוש יושב בתוך כרטיס הכיוונים ולא בכרטיס
   * משלו: שדה רחב עם זכוכית מגדלת בתוכו, ו„עוד סינונים” בקצה. כפתור
   * „חפש” נפרד יורד — השדה נשלח ב-Enter, והכפתור רק גזל מרוחבו.
   */
  layout?: "card" | "inline";
  /** פקד תצוגה שיושב בקצה שורת החיפוש — למשל כרטיסיות/שורות. */
  view?: React.ReactNode;
  /** צ'יפים או פקדים שיושבים בתחתית אותו כרטיס, בתוך „עוד סינון”. */
  children?: React.ReactNode;
  /**
   * ‎`true` כשהפקדים ב-`children` מחזיקים סינון פעיל — למשל עיר
   * שנבחרה. המגירה נפתחת עליו, כי סינון שלא רואים הוא רשימה חסרה
   * בלי הסבר.
   */
  childrenActive?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(values);
  const [open, setOpen] = useState(hasActiveFilters(values) || childrenActive);

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
        <label
          htmlFor={`flt-${key}`}
          className="mb-1 block text-sm font-semibold"
        >
          {label}
        </label>
        <input
          id={`flt-${key}`}
          value={draft[key]}
          inputMode="numeric"
          placeholder={placeholder}
          onChange={(event) =>
            setDraft({ ...draft, [key]: event.target.value })
          }
          className="w-full rounded-lg border px-2.5 py-2 text-sm"
          style={inputStyle}
        />
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className={
        card === undefined
          ? "mb-4"
          : /* ‎`mv-card--pad` נשאר אסימון שלם — שער הריפוד קורא מחרוזות
               ומפצל ברווחים, ו-`mv-card--pad${…}` אינו נראה לו כמחלקה */
            `mv-card mv-card--pad ${card.flush === true ? "" : "mb-[18px]"}`
      }
    >
      {card === undefined ? null : (
        <div className="mv-card-head">
          <span className="mv-tile mv-tile--44 mv-domain-blue" aria-hidden="true">
            <IconSearch s={20} />
          </span>
          <h2 className="mv-card-head__title">{searchLabel}</h2>
          <span
            className="min-w-0"
            style={{ fontSize: "var(--type-body-sm)", color: "var(--color-text-muted)" }}
          >
            {searchHint}
          </span>
        </div>
      )}
      {layout === "inline" ? (
        <div className="mv-searchrow">
          <label htmlFor="flt-q" className="mv-visually-hidden">
            {searchLabel}
          </label>
          <span className="mv-searchbox">
            <IconSearch s={18} />
            <input
              id="flt-q"
              value={draft.q}
              placeholder={searchHint}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            />
          </span>
          {view}
          <button
            type="button"
            className="mv-morefilters"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconFilter s={16} /> עוד סינונים
            <span className="mv-morefilters__chevron" aria-hidden="true">
              <IconChevronDown s={15} />
            </span>
          </button>
          {hasActiveFilters(draft) ? (
            <button type="button" className="mv-morefilters" onClick={clear}>
              <IconX s={15} /> נקה
            </button>
          ) : null}
        </div>
      ) : (
      /* גובה אחיד (38px) לשדה ולכפתונים — שורה אחת ישרה שגם נשברת
          יפה במובייל בזכות flex-wrap */
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1" style={{ minWidth: 200 }}>
          <label
            htmlFor="flt-q"
            className={
              card === undefined
                ? "mb-1 block text-sm font-semibold"
                : "mv-visually-hidden"
            }
          >
            {searchLabel}
          </label>
          <input
            id="flt-q"
            value={draft.q}
            placeholder={card === undefined ? searchHint : (card.example ?? "")}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            className="w-full rounded-lg border px-3 text-sm"
            style={{ ...inputStyle, minHeight: 38 }}
          />
        </div>
        <button
          type="submit"
          className="mv-btn-action"
          style={{ minHeight: 38 }}
        >
          <IconSearch s={15} /> חפש
        </button>
        <button
          type="button"
          className="mv-btn-plain"
          style={{ minHeight: 38, fontSize: "var(--type-caption)", paddingInline: 14 }}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <IconFilter s={15} /> {open ? "פחות סינון" : "עוד סינון"}
        </button>
        {hasActiveFilters(draft) ? (
          <button
            type="button"
            className="mv-btn-plain"
            style={{ minHeight: 38, fontSize: "var(--type-caption)", paddingInline: 14 }}
            onClick={clear}
          >
            <IconX s={14} /> נקה
          </button>
        ) : null}
      </div>
      )}

      {open ? (
        <div
          className="mt-2 grid gap-2"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          }}
        >
          {field("minPrice", `${priceLabel} — מ־`, "1,000,000")}
          {field("maxPrice", `${priceLabel} — עד`, "2,500,000")}
          {field("minRooms", "חדרים — מ־", "3")}
          {field("maxRooms", "חדרים — עד", "5")}
        </div>
      ) : null}

      {/*
        ‎**הצ׳יפים חיים בתוך „עוד סינון”, ולא מעל הכל.**

        רשימת הערים גדלה עם המשרד: משרד שעובד בשתים-עשרה ערים קיבל
        שתי שורות של כפתורים בראש המסך, לפני הנכס הראשון — כלומר
        המסך נפתח על הסינון במקום על התוכן. הם אותו סוג של בקרה כמו
        טווח המחיר והחדרים שכבר יושבים שם, ולכן זה המקום שלהם.

        ‎`childrenActive` הוא מה שמונע סינון שקוף: עיר שנבחרה פותחת
        את המגירה מעצמה, כדי שלא תישאר רשימה מסוננת בלי שום סימן
        למה.
      */}
      {open && children !== undefined ? <div className="mt-3">{children}</div> : null}

      {/*
        הצירים מתחת לשדות ולא במקומם: גרירה מהירה למי שרוצה טווח,
        והקלדה מדויקת למי שיודע את המספר. שניהם כותבים לאותו state,
        ולכן אין מצב שבו המסך מראה שני טווחים שונים.
      */}
      {open ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <RangeSlider
            label={priceLabel}
            stops={PRICE_STOPS}
            minRaw={draft.minPrice}
            maxRaw={draft.maxPrice}
            format={money}
            onChange={(next) => {
              const merged = {
                ...draft,
                ...(next.min === undefined ? {} : { minPrice: next.min }),
                ...(next.max === undefined ? {} : { maxPrice: next.max }),
              };
              setDraft(merged);
              onApply(merged);
            }}
          />
          <RangeSlider
            label="חדרים"
            stops={ROOM_STOPS}
            minRaw={draft.minRooms}
            maxRaw={draft.maxRooms}
            format={(value) => String(value)}
            onChange={(next) => {
              const merged = {
                ...draft,
                ...(next.min === undefined ? {} : { minRooms: next.min }),
                ...(next.max === undefined ? {} : { maxRooms: next.max }),
              };
              setDraft(merged);
              onApply(merged);
            }}
          />
        </div>
      ) : null}
    </form>
  );
}
