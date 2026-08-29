"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiList } from "@/lib/api";
import { IconPlus, IconSearch } from "../../icons";

/**
 * מי ואיזה נכס — בשני הכיוונים, מתוך טופס הפגישה עצמו.
 *
 * ## מה היה קודם
 *
 * ‎`/calendar/new` ידע לקבל `leadId` ו-`propertyId` מהכתובת, ותו לא.
 * זה עבד בכיוון אחד בלבד: מכרטיס הנכס יצא קישור עם הנכס, ומכרטיס
 * הליד יצא קישור עם הליד — ובשני המקרים הצד השני של הפגישה נשאר
 * ריק לנצח. סיור נקבע בלי לדעת את מי מזמינים, או עם מי בלי לדעת
 * לאן. הקישור בין הפגישה לכרטיס הוא מה שמפעיל את התזכורת ללקוח
 * ואת התיעוד בציר הזמן, ולכן פגישה חצי-מקושרת היא פגישה שנעלמת.
 *
 * ## למה חיפוש ולא רשימה נפתחת
 *
 * המסכים האחרים בוחרים נכס מ-`<select>` שנטען מ-`/properties?limit=100`.
 * זה עובד עד שיש במשרד 101 נכסים, ואז ה-101 פשוט אינו ברשימה —
 * בלי הודעה, בלי סימן. כאן החיפוש הוא הדרך הראשית: הוא רץ מול
 * ‎`/search`, שכבר יודע לחפש נכסים לפי כתובת ולקוחות לפי שם, טלפון
 * וערי חיפוש, ומסנן לפי בעלות בדיוק כמו כל מסך אחר. הרשימה
 * הראשונית היא רק „האחרונים”, והיא אומרת זאת במפורש.
 *
 * ## „חדש” הוא הטופס האמיתי, לא שכפול שלו
 *
 * ‎„נכס חדש” ו„ליד חדש” מנווטים לטופסי הקליטה הקיימים עם `returnTo`,
 * ואלה מחזירים לכאן עם המזהה החדש ועם הטיוטה. מיני-טופס בתוך מסך
 * הפגישה היה מדלג על אימות הטלפון, על מיזוג ליד כפול ועל פענוח
 * הכתובת — ובעיקר היה נסחף מהטופס האמיתי תוך חודש.
 */

const DEBOUNCE_MS = 250;
/** מה שנטען לפני שמקלידים: „האחרונים”, ובמפורש לא „הכול”. */
const RECENT_LIMIT = 8;

export interface PickedProperty {
  id: string;
  label: string;
}

export interface PickedPerson {
  kind: "buyer" | "lead";
  id: string;
  label: string;
  /**
   * הטלפון נישא כאן ולא נשלף שוב אחרי היצירה.
   *
   * הוא כבר חוזר מכל מקור שממנו הלקוח נבחר, וקריאה נוספת אחרי
   * שהפגישה נשמרה הייתה יכולה להיכשל — ואז ההצעה לעדכן בוואטסאפ
   * פשוט לא מופיעה, על פגישה שכן נקבעה. הוא עשוי להיות `undefined`
   * כשכללי הבעלות אינם מתירים אותו, והמסך מתמודד עם זה.
   */
  phone?: string;
}

/* ---------- מה שמגיע מהשרת ---------- */

interface SearchProperty {
  id: string;
  city: string | null;
  street: string | null;
  neighborhood: string | null;
  marketingTitle: string | null;
}

interface SearchPerson {
  id: string;
  name: string;
  phone?: string;
}

interface SearchSubset {
  properties: SearchProperty[];
  buyers: (SearchPerson & { cities: string[] })[];
  leads: SearchPerson[];
}

interface PropertyRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  rooms?: number;
  marketingTitle?: string;
}

interface ContactRow {
  id: string;
  contact: { name: string; phone: string };
}

/* ---------- תוויות ---------- */

function propertyLabel(p: {
  city?: string | null;
  neighborhood?: string | null;
  street?: string | null;
  rooms?: number;
  marketingTitle?: string | null;
}): string {
  const where = [p.street, p.neighborhood, p.city].filter(Boolean).join(", ");
  const rooms = p.rooms !== undefined ? `${p.rooms} חדרים` : "";
  return (
    [where, rooms].filter((part) => part !== "").join(" · ") ||
    p.marketingTitle ||
    "נכס ללא כתובת"
  );
}

/* ---------- מעטפת משותפת ---------- */

interface Option {
  id: string;
  label: string;
  sub: string;
  /** מה שנשמר בפועל כשבוחרים — לקונה ולליד זה גם הסוג. */
  pick: () => void;
}

function PickerShell({
  id,
  title,
  hint,
  placeholder,
  chosen,
  onClear,
  options,
  loading,
  recent,
  query,
  onQuery,
  newLabel,
  onNew,
}: {
  id: string;
  title: string;
  hint: string;
  placeholder: string;
  /** התווית של מה שכבר נבחר, או `null` כשעוד לא. */
  chosen: string | null;
  onClear: () => void;
  options: Option[];
  loading: boolean;
  /** התוצאות שמוצגות הן „האחרונים” ולא תשובה לחיפוש. */
  recent: boolean;
  query: string;
  onQuery: (next: string) => void;
  newLabel: string;
  /**
   * ‎**כפתור ולא קישור** — בכוונה.
   *
   * היעד נבנה מהטיוטה שבטופס ברגע הלחיצה, ולכן `href` שמחושב
   * ברינדור היה מפגר אחרי מה שנכתב מאז. הוא גם אינו קישור שיש
   * טעם לפתוח בלשונית חדשה: החזרה לכאן היא כל הרעיון.
   */
  onNew: () => void;
}) {
  if (chosen !== null) {
    return (
      <div
        className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <span className="font-medium">{title}:</span>
        <span>{chosen}</span>
        <button
          type="button"
          className="mv-btn-plain ms-auto"
          style={{ minHeight: 32, paddingInline: 11, fontSize: "var(--type-caption-lg)" }}
          onClick={onClear}
        >
          החלף
        </button>
      </div>
    );
  }

  return (
    <div
      className="mb-4 rounded-lg border p-3"
      style={{ borderColor: "var(--color-border)" }}
    >
      <label htmlFor={id} className="mb-1 block font-medium">
        {title}
      </label>
      <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {hint}
      </p>
      <div className="flex gap-2">
        <input
          id={id}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full rounded-lg border px-3 py-2.5"
          style={{
            borderColor: "var(--color-input-border)",
            background: "var(--color-field)",
          }}
        />
        <button
          type="button"
          onClick={onNew}
          className="mv-btn-plain whitespace-nowrap"
          style={{ paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
        >
          <IconPlus s={14} /> {newLabel}
        </button>
      </div>

      <div aria-live="polite">
        {loading ? (
          <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            מחפש…
          </p>
        ) : options.length === 0 ? (
          <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {query.trim().length >= 2
              ? `לא נמצא. אפשר להמשיך בלי, או ${newLabel}.`
              : "אין עדיין מה להציג — חפשו, או הוסיפו חדש."}
          </p>
        ) : (
          <>
            {recent ? (
              <p
                className="m-0 mt-2 text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                <IconSearch s={12} /> מוצגים האחרונים — הקלידו כדי לחפש בכל המשרד.
              </p>
            ) : null}
            <ul className="m-0 mt-2 list-none p-0">
              {options.map((option) => (
                <li key={option.id} className="mb-1 last:mb-0">
                  <button
                    type="button"
                    onClick={option.pick}
                    className="w-full rounded-lg border px-3 py-2 text-start"
                    style={{
                      // גבול של פקד ולא של כרטיס — השורה הזו נלחצת
                      borderColor: "var(--color-input-border)",
                      background: "var(--color-surface)",
                    }}
                  >
                    <b className="block font-medium">{option.label}</b>
                    {option.sub === "" ? null : (
                      <span
                        className="text-[length:var(--type-caption-lg)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {option.sub}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * חיפוש עם השהיה, שמתעלם מתשובה מאוחרת של שאילתה ישנה.
 *
 * בלי המונה, הקלדה מהירה הייתה מציגה את תוצאות „ת” אחרי תוצאות
 * „תל אביב” — אותו באג שכבר תוקן בחיפוש שבסרגל העליון.
 */
function useSearch<T>(
  query: string,
  run: (trimmed: string) => Promise<T>,
  recentRun: () => Promise<T>,
  empty: T,
): { data: T; loading: boolean; recent: boolean } {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [recent, setRecent] = useState(true);
  const seq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    const mine = ++seq.current;
    setLoading(true);
    if (trimmed.length < 2) {
      recentRun()
        .then((res) => {
          if (mine !== seq.current) return;
          setData(res);
          setRecent(true);
          setLoading(false);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setData(empty);
          setLoading(false);
        });
      return;
    }
    const timer = setTimeout(() => {
      run(trimmed)
        .then((res) => {
          if (mine !== seq.current) return;
          setData(res);
          setRecent(false);
          setLoading(false);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setData(empty);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `run`/`recentRun`/`empty` יציבים אצל הקוראים (מוגדרים במודול),
    // והוספתם לתלויות הייתה מריצה חיפוש בכל רינדור
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return { data, loading, recent };
}

/* ---------- בחירת נכס ---------- */

const NO_PROPERTIES: SearchProperty[] = [];

async function searchProperties(trimmed: string): Promise<SearchProperty[]> {
  const res = await apiGet<SearchSubset>(`/search?q=${encodeURIComponent(trimmed)}`);
  return res.properties;
}

async function recentProperties(): Promise<SearchProperty[]> {
  const res = await apiGet<{ items: PropertyRow[] }>(
    `/properties?limit=${RECENT_LIMIT}`,
  );
  return apiList(res.items, "items").map((row) => ({
    id: row.id,
    city: row.city ?? null,
    street: row.street ?? null,
    neighborhood: row.neighborhood ?? null,
    marketingTitle: row.marketingTitle ?? null,
  }));
}

export function PropertyPicker({
  value,
  onPick,
  onClear,
  onNew,
}: {
  value: PickedProperty | null;
  onPick: (picked: PickedProperty) => void;
  onClear: () => void;
  /** פותח את טופס הנכס החדש עם נתיב החזרה לכאן. */
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, loading, recent } = useSearch(
    query,
    searchProperties,
    recentProperties,
    NO_PROPERTIES,
  );

  return (
    <PickerShell
      id="property-picker"
      title="הנכס"
      hint="על איזה נכס הסיור? בלי נכס הפגישה לא תופיע בכרטיס שלו ולא תשלח תזכורת עם הכתובת."
      placeholder="רחוב, שכונה או עיר…"
      chosen={value === null ? null : value.label}
      onClear={onClear}
      loading={loading}
      recent={recent}
      query={query}
      onQuery={setQuery}
      newLabel="נכס חדש"
      onNew={onNew}
      options={data.map((row) => ({
        id: row.id,
        label: propertyLabel(row),
        sub: row.marketingTitle ?? "",
        pick: () => onPick({ id: row.id, label: propertyLabel(row) }),
      }))}
    />
  );
}

/* ---------- בחירת קונה או ליד ---------- */

const NO_PEOPLE: PickedPerson[] = [];

async function searchPeople(trimmed: string): Promise<PickedPerson[]> {
  const res = await apiGet<SearchSubset>(`/search?q=${encodeURIComponent(trimmed)}`);
  return [
    ...res.buyers.map((row) => ({
      kind: "buyer" as const,
      id: row.id,
      label: row.name,
      phone: row.phone,
    })),
    ...res.leads.map((row) => ({
      kind: "lead" as const,
      id: row.id,
      label: row.name,
      phone: row.phone,
    })),
  ];
}

async function recentPeople(): Promise<PickedPerson[]> {
  /*
   * שתי הרשימות במקביל, וכל אחת נופלת לריק בנפרד: סוכן שאין לו
   * הרשאת צפייה בלידים עדיין צריך לראות את הקונים שלו, ובקשה
   * שנכשלת לא אמורה למחוק את השנייה.
   */
  const [buyers, leads] = await Promise.all([
    apiGet<{ items: ContactRow[] }>(`/buyers?limit=${RECENT_LIMIT}`).catch(() => ({
      items: [] as ContactRow[],
    })),
    apiGet<{ items: ContactRow[] }>(`/leads?limit=${RECENT_LIMIT}`).catch(() => ({
      items: [] as ContactRow[],
    })),
  ]);
  return [
    ...buyers.items.map((row) => ({
      kind: "buyer" as const,
      id: row.id,
      label: row.contact.name,
      phone: row.contact.phone,
    })),
    ...leads.items.map((row) => ({
      kind: "lead" as const,
      id: row.id,
      label: row.contact.name,
      phone: row.contact.phone,
    })),
  ];
}

export function PersonPicker({
  value,
  onPick,
  onClear,
  onNew,
}: {
  value: PickedPerson | null;
  onPick: (picked: PickedPerson) => void;
  onClear: () => void;
  /** פותח את טופס הליד החדש עם נתיב החזרה לכאן. */
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const { data, loading, recent } = useSearch(
    query,
    searchPeople,
    recentPeople,
    NO_PEOPLE,
  );

  return (
    <PickerShell
      id="person-picker"
      title="עם מי"
      hint="קונה קיים או ליד. בלי לקוח לא תוצע הודעת עדכון בוואטסאפ, והפגישה לא תתועד בכרטיס שלו."
      placeholder="שם או טלפון…"
      chosen={value === null ? null : value.label}
      onClear={onClear}
      loading={loading}
      recent={recent}
      query={query}
      onQuery={setQuery}
      newLabel="ליד חדש"
      onNew={onNew}
      options={data.map((row) => ({
        // קונה וליד יכולים לחלוק מזהה? לא — אבל המפתח ב-React הוא
        // מהזוג, כדי שהרשימה לא תקרוס אם אי־פעם יחלקו
        id: `${row.kind}-${row.id}`,
        label: row.label,
        sub: row.kind === "buyer" ? "קונה" : "ליד",
        pick: () => onPick(row),
      }))}
    />
  );
}
