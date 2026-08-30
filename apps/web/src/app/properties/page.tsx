"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import type { PropertyStatus } from "@metavchim/shared";
import { API_BASE, apiGet, apiList, apiPost } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { useFeature } from "@/lib/use-features";
import { IconHome, IconMic, IconPlus, IconSheet } from "../icons";
import { ExclusivityWatch } from "./exclusivity-watch";
import { CapNote, FilterBar, FilterChips, FilterSelect, SortSelect } from "../list-controls";
import {
  EMPTY_FILTERS,
  ListFilters,
  filtersToQuery,
  hasActiveFilters,
  type ListFilterValues,
} from "../list-filters";
import { Notice } from "../notice";
import { readinessBand } from "@/lib/readiness";

/**
 * מסך הנכסים לפי קובץ העיצוב: צ'יפי ערים לסינון, טבלת grid עם תג
 * "חדש", פס מוכנות צבעוני ועמודת מספר ההתאמות.
 */

interface PropertyRow {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  propertyType?: string;
  rooms?: number;
  priceAgorot?: number;
  /*
   * הטיפוס מהחבילה, כדי שמפת התוויות תוכל להיות ממצה: סטטוס חדש
   * בסכמה ייפול בקומפילציה במקום להיות מוצג כמפתח באנגלית.
   */
  status: PropertyStatus;
  readinessScore: number;
  missingFields: string[];
  thumbnailUrl?: string;
  suggestedMatchCount?: number;
  createdAt?: string;
}

function addressOf(p: PropertyRow): string {
  return [p.street, p.neighborhood].filter(Boolean).join(", ") || p.city || "ללא כתובת";
}

/** נכס שנקלט בשבוע האחרון מסומן "חדש" ומקבל רקע ירקרק, כמו בעיצוב. */
function isNew(p: PropertyRow): boolean {
  if (!p.createdAt) return false;
  return Date.now() - new Date(p.createdAt).getTime() < 7 * 24 * 60 * 60 * 1000;
}

/**
 * הדומיין של סטטוס הנכס (SPEC-2 §4).
 *
 * ‎**„טיוטה” הוא ניטרלי ולעולם לא ענבר** — החבילה מדגישה זאת
 * פעמיים, ובצדק: טיוטה אינה תקלה ואינה דורשת תשומת לב דחופה,
 * היא פשוט נכס שטרם הושלם. ענבר היה קורא לה „טפל בי עכשיו”.
 */
function statusDomain(status: string): string {
  if (status === "active") return "mv-domain-green";
  return "mv-domain-neutral";
}

/*
 * שתי העמודות האחרונות התרחבו יחד עם התוכן שנכנס אליהן: המוכנות
 * נושאת כעת שתי שורות („‎82%” ומתחתיו „חסרים 2 שדות”), והסטטוס
 * וההתאמות הפכו מטקסט לגלולות. ‎0.6fr‎ היה חותך „12 התאמות”.
 */
const GRID = "2fr 0.8fr 0.6fr 0.9fr 1.3fr 1fr 1fr";

const SORTS: [string, string][] = [
  ["newest", "חדשים קודם"],
  ["price_desc", "מחיר גבוה→נמוך"],
  ["price_asc", "מחיר נמוך→גבוה"],
  ["rooms_desc", "הכי הרבה חדרים"],
  ["readiness_asc", "הכי פחות מוכנים"],
];

function sortRows(rows: PropertyRow[], sort: string): PropertyRow[] {
  const sorted = [...rows];
  switch (sort) {
    case "price_desc":
      return sorted.sort((a, b) => (b.priceAgorot ?? -1) - (a.priceAgorot ?? -1));
    case "price_asc":
      return sorted.sort((a, b) => (a.priceAgorot ?? Infinity) - (b.priceAgorot ?? Infinity));
    case "rooms_desc":
      return sorted.sort((a, b) => (b.rooms ?? 0) - (a.rooms ?? 0));
    case "readiness_asc":
      return sorted.sort((a, b) => a.readinessScore - b.readinessScore);
    default:
      return sorted; // ה-API כבר מחזיר חדשים קודם
  }
}

function Thumb({ url }: { url?: string }) {
  if (url) {
    // img רגיל בכוונה: מוזרם דרך ה-API, לא לאופטימיזציית Next
    return <img src={API_BASE + url} alt="" className="h-20 w-24 rounded-lg object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-20 w-24 items-center justify-center rounded-lg text-xl"
      style={{ background: "var(--color-field)", color: "var(--color-text-muted)" }}
    >
      <IconHome s={20} />
    </span>
  );
}

export default function PropertiesPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const canImport = useFeature("data_io");
  const canVoice = useFeature("voice_intake");
  const router = useRouter();
  const [items, setItems] = useState<PropertyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("הכל");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");
  const [filters, setFilters] = useState<ListFilterValues>(EMPTY_FILTERS);
  /*
   * הנכסים שסומנו להעלאה מרוכזת לרשת — Set של מזהים, מאותה סיבה
   * שברשימת הקונים: הסינון משנה את הרשימה תוך כדי בחירה.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  /*
   * הסינון רץ בשרת ולא בדפדפן.
   *
   * הצ'יפים של הערים והמיון עובדים על מה שכבר נטען, וזה בסדר לרשימה
   * של מאה נכסים. חיפוש טקסט וטווחים הם משהו אחר: משרד עם אלפי
   * נכסים חייב שהסינון יקרה במסד, אחרת הוא מסנן רק את המאה
   * הראשונים ומחזיר "אין תוצאות" על נכס שקיים.
   */
  useEffect(() => {
    if (authLoading) return;
    setItems(null);
    apiGet<{ items: PropertyRow[] }>(`/properties?limit=100${filtersToQuery(filters)}`)
      .then((res) => setItems(apiList(res.items, "items")))
      .catch(() => setError("טעינת הנכסים נכשלה"));
  }, [authLoading, filters]);

  /* צ'יפי הערים נבנים מהנתונים עצמם — הערים שבאמת יש בהן נכסים */
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items ?? []) {
      if (p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    }
    return ["הכל", ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 6)];
  }, [items]);

  const visible = useMemo(() => {
    if (!items) return [];
    const filtered = items.filter(
      (p) =>
        // החיפוש החופשי כבר סונן בשרת; כאן נשארו רק הצ'יפים והמיון
        (city === "הכל" || p.city === city) &&
        (!status || p.status === status) &&
        (!type || p.propertyType === type),
    );
    return sortRows(filtered, sort);
  }, [items, city, status, type, sort]);

  /* הבחירה מוצגת רק למי שרשאי לפרסם לרשת — כמו הגישה במסך הקונים */
  const mayShare = can(user, "collaboration.share");
  const mayDelete = can(user, "properties.delete");
  /*
   * ‎**הבחירה שייכת לשתי היכולות, ולא לשיתוף בלבד.**
   *
   * תיבות הסימון היו מותנות ב-`mayShare` — ולכן מי שרשאי למחוק ואינו
   * רשאי לפרסם לרשת לא ראה תיבות כלל, כלומר המחיקה המרוכזת הייתה
   * קיימת בשרת ובלתי נגישה במסך. אותו מבנה בדיוק כמו במסך הקונים.
   */
  const maySelect = mayShare || mayDelete;
  const selectedVisible = visible.filter((p) => selected.has(p.id));
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  function toggle(id: string): void {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map((p) => p.id)));
  }

  /**
   * העלאה מרוכזת לרשת — התאום של shareSelected במסך הקונים.
   * השרת מפרסם כל נכס במסלול הבודד (סטטוס, כפילות, מכסה), בברירת
   * המחדל של חלוקת העמלה ועם תיאור השיווק של הנכס.
   */
  async function shareSelected(): Promise<void> {
    const ids = selectedVisible.map((p) => p.id);
    if (ids.length === 0) return;
    if (!window.confirm(`לפרסם ${ids.length} נכסים לרשת השיתופים? יפורסמו בלי כתובת מדויקת ובלי פרטי בעלים, בחלוקת עמלה 50/50.`)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ results: { id: string; ok: boolean; error?: string }[] }>(
        "/collaboration/listings/bulk",
        { propertyIds: ids },
      );
      const failed = res.results.filter((r) => !r.ok);
      const reasons = [...new Set(failed.map((r) => r.error ?? "הפרסום נכשל"))];
      setBulkNote(
        failed.length === 0
          ? `${res.results.length} נכסים פורסמו לרשת`
          : `${res.results.length - failed.length} פורסמו, ${failed.length} לא — ${reasons.join(" · ")}`,
      );
      setSelected(new Set());
    } catch {
      setError("הפרסום לרשת נכשל — נסו שוב");
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * מחיקה מרוכזת — ארכיון, או מחיקה לצמיתות.
   *
   * ברירת המחדל היא ארכיון, בדיוק כמו במחיקה בודדת: נכס שנמכר הוא
   * היסטוריה עסקית. הכפתור השני קיים בשביל המקרה שבשבילו הפעולה
   * נבנתה — ייבוא שגוי או כפילות שצריכים להיעלם.
   */
  async function removeSelected(permanent: boolean): Promise<void> {
    const ids = selectedVisible.map((p) => p.id);
    if (ids.length === 0) return;

    /*
     * ‎**הגילוי לפני האישור.**
     *
     * המחיקה לצמיתות מוחקת גם כרטיסי אדם שהנכס הזה הוא הקישור
     * האחרון אליהם — בעלים או דייר, על שמם וטלפוניהם. מתווך שמנקה
     * כפילות אינו מתכוון לזה, ולכן זה נאמר **לפני**.
     *
     * וכשהבדיקה נכשלת המחיקה **נחסמת**: „לא ידוע” לעולם אינו מוצג
     * כ„לא יימחק”. אותה הכרעה כמו במסך הקונים.
     */
    let disclosure = "";
    if (permanent) {
      setBulkBusy(true);
      setError(null);
      try {
        const preview = await apiPost<{ contacts: number }>(
          "/properties/bulk-deletion-preview",
          { ids },
        );
        disclosure =
          preview.contacts === 0
            ? ""
            : preview.contacts === 1
              ? "יימחק גם כרטיס אדם אחד שהנכס הזה הוא הקישור האחרון אליו במשרד — כולל שם, טלפונים והיסטוריית התקשורת."
              : `יימחקו גם ${preview.contacts} כרטיסי אדם שהנכסים האלה הם הקישור האחרון אליהם במשרד — כולל שם, טלפונים והיסטוריית התקשורת.`;
      } catch {
        setError("בדיקת המחיקה נכשלה — לא נמחק דבר. נסו שוב.");
        return;
      } finally {
        setBulkBusy(false);
      }
    }

    const question = permanent
      ? [
          `למחוק לצמיתות ${ids.length} נכסים? הפעולה אינה הפיכה, וכל ההיסטוריה שלהם תימחק.`,
          ...(disclosure === "" ? [] : [disclosure]),
        ].join("\n")
      : `להעביר ${ids.length} נכסים לארכיון? הם יורדו מהרשימות וההיסטוריה תישמר.`;
    if (!window.confirm(question)) return;

    setBulkBusy(true);
    setBulkNote(null);
    setError(null);
    try {
      const res = await apiPost<{ removed: number; skipped: number }>(
        "/properties/bulk-delete",
        { ids, permanent },
      );
      setBulkNote(
        res.skipped === 0
          ? `${res.removed} נכסים ${permanent ? "נמחקו" : "הועברו לארכיון"}`
          : `${res.removed} ${permanent ? "נמחקו" : "הועברו לארכיון"}, ${res.skipped} דולגו — נכס של סוכן אחר, או כזה שכבר נמחק`,
      );
      setSelected(new Set());
    } catch {
      setError("המחיקה נכשלה — נסו שוב");
      setBulkBusy(false);
      return;
    }

    /*
     * ‎**הרענון בנפרד מהמחיקה, ולא באותו `try`.**
     *
     * כישלון של הרענון — רשת, או גוף תשובה חסר — היה מדווח „המחיקה
     * נכשלה” על מחיקה שהצליחה, ומזמין את המתווך למחוק שוב.
     */
    setItems(null);
    try {
      const fresh = await apiGet<{ items: PropertyRow[] }>(
        `/properties?limit=100${filtersToQuery(filters)}`,
      );
      setItems(apiList(fresh.items, "items"));
    } catch {
      setError("הרשימה לא רועננה — רעננו את העמוד");
    } finally {
      setBulkBusy(false);
    }
  }

  const filtering =
    hasActiveFilters(filters) ||
    city !== "הכל" ||
    status !== "" ||
    type !== "" ||
    sort !== "newest";

  return (
    <>
      {/* לפני הסינון והרשימה: בלעדיות שנגמרת היא נכס שעובר למתחרה,
          וזו הידיעה היחידה במסך הזה שיש לה תאריך תפוגה */}
      <ExclusivityWatch />

      <ListFilters
        values={filters}
        onApply={setFilters}
        searchLabel="חיפוש נכס"
        searchHint="כתובת, תיאור, סוג נכס או הערה"
        priceLabel="מחיר"
      />

      {/* שורת הצ'יפים והפעולות — כמו בעיצוב */}
      <div className="mb-[18px] flex flex-wrap items-center gap-2.5">
        <FilterChips
          label="סינון לפי עיר"
          value={city}
          onChange={setCity}
          options={cities.map((c) => [c, c] as [string, string])}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2.5">
          {/* כפתור שמוביל לפיצ'ר שאינו במסלול נחסם בשרת ממילא —
              עדיף לא להציג אותו מאשר להסביר 403 אחרי בחירת קובץ */}
          {canImport ? (
            <Link href="/import" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}>
              <IconSheet s={15} /> ייבוא מאקסל
            </Link>
          ) : null}
          {canVoice ? (
            <Link href="/voice" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "var(--type-caption)" }}>
              <IconMic s={15} /> נכס בקול
            </Link>
          ) : null}
          <Link href="/properties/new" className="mv-btn-action" style={{ minHeight: 38 }}>
            <IconPlus s={15} /> נכס חדש
          </Link>
        </div>
      </div>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : items === null ? (
        <p aria-live="polite">טוען נכסים…</p>
      ) : items.length === 0 && !hasActiveFilters(filters) ? (
        /*
         * **מצב „אין נכסים בכלל” יושב כאן, ולא בתוך הרשימה.**
         *
         * הענף הזה קודם לסרגל הסינון, וזה נכון: למשרד שאין לו נכסים
         * אין מה לסנן, וצ׳יפים ריקים מעל כרטיס ריק הם רעש.
         *
         * בגרסה הקודמת כתבתי מצב „אין נכסים” משופר **בתוך** בלוק
         * הרשימה, ולא שמתי לב שהענף הזה תופס את המקרה לפניו. התוצאה
         * הייתה קוד מת: משרד חדש קיבל את הנוסח הישן, והפעולה שהוספתי
         * („קליטה בקול”) לא הופיעה לעולם. הנוסח המשופר עבר לכאן
         * (ביקורת Codex).
         */
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-1 text-[length:var(--type-screen-title)] font-black">עוד לא הוספת נכסים</p>
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            כל נכס שתוסיפו ייבדק מול הקונים שבמאגר, וההתאמות יחושבו לבד.
          </p>
          {/*
           * ‎`mv-button` ולא `mv-btn-action`/`mv-btn-plain` — יעד מגע.
           *
           * ‎§26 דורש „buttons 46 and up”, ושני הכפתורים שכתבתי כאן
           * היו מתחת ל-44: ‎`mv-btn-action` הוא 42, ו-`mv-btn-plain`
           * הוא ריפוד 6px סביב טקסט 14 — כ-34 בפועל. דווקא הפעולה
           * הזו מיועדת לשימוש במובייל תוך כדי תנועה (ביקורת Codex).
           *
           * ‎`mv-button` הוא 46 בזכות `min-height`, כלומר גם טקסט
           * שנשבר לשתי שורות אינו מקטין את יעד המגע.
           */}
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Link href="/properties/new" className="mv-button mv-button--primary">
              <IconPlus s={16} /> נכס חדש
            </Link>
            {canVoice ? (
              <Link href="/voice" className="mv-button mv-button--secondary">
                <IconMic s={16} /> קליטה בקול
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <FilterBar
            shown={visible.length}
            total={items.length}
            noun="נכסים"
            active={filtering}
            onClear={() => {
              setFilters(EMPTY_FILTERS);
              setCity("הכל");
              setStatus("");
              setType("");
              setSort("newest");
            }}
          >
            <FilterSelect
              label="סינון לפי סטטוס"
              value={status}
              onChange={setStatus}
              allLabel="כל הסטטוסים"
              options={Object.entries(STATUS_LABELS)}
            />
            <FilterSelect
              label="סינון לפי סוג נכס"
              value={type}
              onChange={setType}
              allLabel="כל הסוגים"
              options={Object.entries(PROPERTY_TYPE_LABELS)}
            />
            <SortSelect value={sort} onChange={setSort} options={SORTS} />
          </FilterBar>

          {visible.length === 0 ? (
            /*
             * כאן **תמיד** „הסינון לא החזיר כלום”, ולא „אין נכסים”.
             *
             * המקרה השני נתפס בענף שלפני סרגל הסינון. אם הגענו לכאן
             * והרשימה ריקה, בהכרח פעיל מסנן כלשהו — שרת או צ׳יפ —
             * ולכן אין כאן תנאי, ואין ענף שני שלעולם לא ירוץ.
             */
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-1 text-[length:var(--type-screen-title)] font-black">אין נכסים שמתאימים לסינון</p>
              <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
                הסינון הנוכחי לא מחזיר אף נכס. נסו לצמצם אותו או לנקות אותו לגמרי.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setCity("הכל");
                  setStatus("");
                  setType("");
                }}
              >
                ניקוי הסינון
              </Button>
            </div>
          ) : (
            <>
              {/* סרגל הבחירה מופיע רק כשיש בחירה — כמו במסך הקונים */}
              {maySelect && selected.size > 0 ? (
                <div
                  className="mv-list-card mb-3 flex flex-wrap items-center gap-2 px-4 py-3"
                  role="status"
                >
                  <strong className="text-[length:var(--type-body-sm)]">{selectedVisible.length} נבחרו</strong>
                  <button
                    type="button"
                    className="mv-btn-plain"
                    disabled={bulkBusy}
                    onClick={() => setSelected(new Set())}
                  >
                    בטל בחירה
                  </button>
                  {mayShare ? (
                    <button
                      type="button"
                      className="mv-btn-plain ms-auto"
                      disabled={bulkBusy}
                      onClick={() => void shareSelected()}
                      style={{ color: "var(--color-primary)" }}
                    >
                      {bulkBusy ? "מפרסם…" : "העלה לרשת השיתופים"}
                    </button>
                  ) : null}
                  {mayDelete ? (
                    <>
                      <button
                        type="button"
                        className={mayShare ? "mv-btn-plain" : "mv-btn-plain ms-auto"}
                        disabled={bulkBusy}
                        onClick={() => void removeSelected(false)}
                      >
                        העבר לארכיון
                      </button>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        disabled={bulkBusy}
                        onClick={() => void removeSelected(true)}
                        style={{ color: "var(--color-danger)" }}
                      >
                        מחק לצמיתות
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {bulkNote ? <Notice tone="success">{bulkNote}</Notice> : null}

              <div className="mv-list-switch">
              {/*
                כרטיסים עד 1280, טבלה מעליו — **ולא 640 ולא 1024.**

                הטבלה נפתחה תחילה ב-`sm`, ובטווח 640–1023 נשארו לשתי
                העמודות האחרונות כשישים פיקסלים כל אחת. כל עוד הן
                נשאו טקסט זה עבד; מרגע שהפכתי אותן לגלולות — שהן
                ‎`white-space: nowrap` עם 22 פיקסלים ריפוד אופקי —
                „12 התאמות” ותוויות סטטוס ארוכות נחתכות או דורסות
                את העמודה השכנה (ביקורת Codex).

                ‎**‎`lg` היה התיקון הגרוע ביותר האפשרי, ולא במקרה.**
                ‎1024 הוא בדיוק הרוחב שבו `.mv-sidebar` נכנס ותופס
                250 פיקסלים. כלומר רוחב התוכן **מצטמצם** שם:
                ב-1023 הכרטיסים מקבלים ‎1023−68 ≈ 955‎, וב-1024
                הטבלה נפתחת על ‎1024−250−68 ≈ 706‎. בחרתי את הנקודה
                היחידה שבה המעבר לפריסה הרחבה נעשה על שטח צר יותר
                (ביקורת Codex).

                ‎1280 מחזיר ‎1280−250−68 ≈ 962‎ — הרוחב הראשון שעובר
                את מה שתצוגת הכרטיסים כבר קיבלה, וכ-115 פיקסלים לכל
                עמודת ‎`1fr`‎, די לגלולה השלמה.

                ולא גלילה אופקית: בטאבלט כרטיס קריא עדיף על טבלה
                שצריך לגרור, וזה גם הנימוק המקורי של תצוגת הכרטיסים
                (docs/06 §1.5).
              */}
              <ul className="mv-list-as-cards flex-col gap-3">
                {visible.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex gap-3">
                      <Thumb url={p.thumbnailUrl} />
                      <div className="min-w-0 flex-1">
                        {maySelect ? (
                          <input
                            type="checkbox"
                            className="me-2 align-middle"
                            checked={selected.has(p.id)}
                            onChange={() => toggle(p.id)}
                            aria-label={`בחר את ${addressOf(p)}`}
                          />
                        ) : null}
                        <Link href={`/properties/${p.id}`} className="font-bold underline">
                          {addressOf(p)}
                        </Link>
                        {isNew(p) ? (
                          <span className="mv-tag ms-2" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                            חדש
                          </span>
                        ) : null}
                        <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                          {[
                            p.city,
                            p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : null,
                            p.rooms ? `${p.rooms} חד׳` : null,
                            formatPrice(p.priceAgorot),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-1 flex items-center gap-2 text-sm">
                          <span className="mv-progress">
                            <span
                              style={{
                                width: `${p.readinessScore}%`,
                                background: readinessBand(p.readinessScore).bar,
                              }}
                            />
                          </span>
                          <span
                            className="font-bold"
                            style={{ color: readinessBand(p.readinessScore).text, fontSize: "var(--type-caption)" }}
                          >
                            {p.readinessScore}%
                          </span>
                        </p>
                        {/*
                          שדות החובה והסטטוס — **הכרטיס נושא את אותן
                          עובדות כמו הטבלה.**

                          כשהעברתי את נקודת המעבר מ-640 ל-1280, כל מי
                          שנמצא בין השתיים עבר מהטבלה לכרטיס. הטבלה
                          מציגה סטטוס, שדות חסרים ומצב „אין עדיין”
                          להתאמות; הכרטיס לא הציג אף אחד מהם. כלומר
                          פתרתי בעיית רוחב במחיר של מידע, ודווקא
                          למשתמשי הטאבלט ולרוחב 1024 שהוא נפוץ
                          (ביקורת Codex).

                          הניסוח והדומיינים נלקחים מאותן פונקציות
                          שמזינות את הטבלה, ולא נכתבים כאן מחדש.
                        */}
                        <p className="mt-1" style={{ fontSize: "var(--type-caption)", color: "var(--color-text-muted)" }}>
                          {p.missingFields.length > 0
                            ? `חסרים ${p.missingFields.length} שדות`
                            : "כל השדות מלאים"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`mv-pill ${statusDomain(p.status)}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      {p.suggestedMatchCount ? (
                        <Link
                          href={`/matches?property=${p.id}`}
                          className="mv-pill mv-domain-violet no-underline"
                        >
                          {p.suggestedMatchCount} קונים מתאימים ←
                        </Link>
                      ) : (
                        <span className="mv-pill mv-domain-neutral">אין עדיין</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב. הנקודה מנומקת ליד `xl:hidden` */}
              <div className="mv-list-as-table mv-list-card">
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span className="flex items-center gap-2">
                    {maySelect ? (
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="בחר את כל הנכסים המוצגים"
                        title="בחר הכל"
                      />
                    ) : null}
                    כתובת
                  </span>
                  <span>עיר</span>
                  <span>חדרים</span>
                  <span>מחיר</span>
                  <span>מוכנות לשיווק</span>
                  <span>סטטוס</span>
                  <span>התאמות</span>
                </div>
                {visible.map((p) => {
                  const ready = readinessBand(p.readinessScore);
                  return (
                    /* התיבה לצד השורה ולא בתוכה — השורה כולה כפתור
                       ניווט, ותיבת סימון בתוך כפתור אינה נגישה */
                    <div key={p.id} className="mv-list-select-row">
                      {maySelect ? (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`בחר את ${addressOf(p)}`}
                        />
                      ) : null}
                    <button
                      type="button"
                      className={`mv-list-row grow${isNew(p) ? " mv-list-row--new" : ""}`}
                      style={{ gridTemplateColumns: GRID }}
                      onClick={() => router.push(`/properties/${p.id}`)}
                    >
                      <span className="flex items-center gap-2 truncate text-[length:var(--type-body)] font-bold">
                        {addressOf(p)}
                        {isNew(p) ? (
                          <span className="mv-tag" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                            חדש
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                        {p.city ?? "—"}
                      </span>
                      <span className="text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                        {p.rooms ?? "—"}
                      </span>
                      <span className="text-sm font-bold">{formatPrice(p.priceAgorot)}</span>
                      <span className="flex flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="mv-progress">
                            <span style={{ width: `${p.readinessScore}%`, background: ready.bar }} />
                          </span>
                          <span className="font-bold" style={{ color: ready.text, fontSize: "var(--type-caption)" }}>
                            {p.readinessScore}%
                          </span>
                        </span>
                        {/*
                          „‎82% · חסרים 2 שדות” — **גלוי, ולא רק לקורא מסך.**

                          המספר היה כאן ב-`mv-visually-hidden`, כלומר מתווך
                          רואה אחוז ואינו יודע כמה שדות עומדים מאחוריו ולא
                          שהם בכלל ניתנים להשלמה. זו העמודה שכל תכליתה לומר
                          „מה חסר”, והמידע כבר הגיע מהשרת.

                          ‎**„שדות” ולא „שדות חובה”.** הניסוח נשא פעם את
                          המילה „חובה”, כי הציון היה משוקלל — 80% לשדות
                          החובה ועוד עשרה אחוזים על כותרת ועשרה על תיאור —
                          ולכן „כל השדות מלאים” הופיע ליד „80%”. מרגע
                          ש-`computeReadiness` הוא ‎`filled / 9`‎ בדיוק
                          (SPEC-3b §4), אין פער להסביר והסייג ירד.
                        */}
                        <span style={{ fontSize: "var(--type-caption)", color: "var(--color-text-muted)" }}>
                          {p.missingFields.length > 0
                            ? `חסרים ${p.missingFields.length} שדות`
                            : "כל השדות מלאים"}
                        </span>
                      </span>
                      <span>
                        <span className={`mv-pill ${statusDomain(p.status)}`}>
                          {STATUS_LABELS[p.status] ?? p.status}
                        </span>
                      </span>
                      {/*
                        התאמות הן **סגול** ולא ירוק (§2 של מערכת העיצוב:
                        „VIOLET — matching engine: matches, offers”). הירוק
                        שהיה כאן שייך לכסף ולשיתופי פעולה, ושורה אחת בשני
                        דומיינים היא בדיוק מה שהכלל אוסר.

                        אפס עובר לניטרלי — „Zero must never look like
                        failure”.
                      */}
                      <span>
                        <span
                          className={`mv-pill ${
                            p.suggestedMatchCount ? "mv-domain-violet" : "mv-domain-neutral"
                          }`}
                        >
                          {p.suggestedMatchCount
                            ? `${p.suggestedMatchCount} התאמות`
                            : "אין עדיין"}
                        </span>
                      </span>
                    </button>
                    </div>
                  );
                })}
              </div>
              </div>
            </>
          )}
          <CapNote show={filtering && items.length === 100} noun="נכסים" />
        </>
      )}
    </>
  );
}
