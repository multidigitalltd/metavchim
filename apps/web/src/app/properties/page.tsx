"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
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
  status: string;
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

/* צבעי פס המוכנות מהעיצוב; צבע הטקסט לצידו מועמק ל-AA (docs/06 §4) */
function readinessColors(score: number): { bar: string; text: string } {
  if (score >= 85) return { bar: "#12A150", text: "var(--color-primary)" };
  if (score >= 70) return { bar: "#c98a2e", text: "#8a6414" };
  return { bar: "#b0512c", text: "#b0512c" };
}

const GRID = "2.2fr 0.9fr 0.7fr 1fr 1.2fr 0.9fr 0.6fr";

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
  const { loading: authLoading } = useRequireAuth();
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
      .then((res) => setItems(res.items))
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
            <Link href="/import" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "14px" }}>
              <IconSheet s={15} /> ייבוא מאקסל
            </Link>
          ) : null}
          {canVoice ? (
            <Link href="/properties/voice" className="mv-btn-plain" style={{ minHeight: 38, paddingInline: 14, fontSize: "14px" }}>
              <IconMic s={15} /> נכס בקול
            </Link>
          ) : null}
          <Link href="/properties/new" className="mv-btn-action" style={{ minHeight: 38 }}>
            <IconPlus s={15} /> נכס חדש
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : items === null ? (
        <p aria-live="polite">טוען נכסים…</p>
      ) : items.length === 0 && !hasActiveFilters(filters) ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-3 text-lg font-semibold">עדיין אין נכסים</p>
          <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
            הוסיפו את הנכס הראשון — ותוך שניות תראו קונים מתאימים.
          </p>
          <Link href="/properties/new">
            <Button>הוסף נכס ראשון</Button>
          </Link>
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
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף נכס לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setCity("הכל");
                  setStatus("");
                  setType("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
              {/* מובייל: כרטיסים. טבלת grid במסך 375px דורשת גלילה לצדדים —
                  והמתווך עומד בשטח עם יד אחת פנויה (docs/06 §1.5) */}
              <ul className="flex flex-col gap-3 sm:hidden">
                {visible.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex gap-3">
                      <Thumb url={p.thumbnailUrl} />
                      <div className="min-w-0 flex-1">
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
                                background: readinessColors(p.readinessScore).bar,
                              }}
                            />
                          </span>
                          <span className="font-bold" style={{ color: readinessColors(p.readinessScore).text, fontSize: "14px" }}>
                            {p.readinessScore}%
                          </span>
                        </p>
                      </div>
                    </div>
                    {p.suggestedMatchCount ? (
                      <Link
                        href={`/matches?property=${p.id}`}
                        className="mv-pill mt-3 inline-block no-underline"
                        style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                      >
                        {p.suggestedMatchCount} קונים מתאימים ←
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>

              {/* שולחני: טבלת ה-grid מהעיצוב */}
              <div className="mv-list-card hidden sm:block">
                <div className="mv-list-head" style={{ gridTemplateColumns: GRID }}>
                  <span>כתובת</span>
                  <span>עיר</span>
                  <span>חדרים</span>
                  <span>מחיר</span>
                  <span>מוכנות לשיווק</span>
                  <span>סטטוס</span>
                  <span>התאמות</span>
                </div>
                {visible.map((p) => {
                  const ready = readinessColors(p.readinessScore);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`mv-list-row${isNew(p) ? " mv-list-row--new" : ""}`}
                      style={{ gridTemplateColumns: GRID }}
                      onClick={() => router.push(`/properties/${p.id}`)}
                    >
                      <span className="flex items-center gap-2 truncate text-[15.5px] font-bold">
                        {addressOf(p)}
                        {isNew(p) ? (
                          <span className="mv-tag" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                            חדש
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-[15px]" style={{ color: "var(--color-text-soft)" }}>
                        {p.city ?? "—"}
                      </span>
                      <span className="text-[15px]" style={{ color: "var(--color-text-soft)" }}>
                        {p.rooms ?? "—"}
                      </span>
                      <span className="text-sm font-bold">{formatPrice(p.priceAgorot)}</span>
                      <span className="flex items-center gap-2">
                        <span className="mv-progress">
                          <span style={{ width: `${p.readinessScore}%`, background: ready.bar }} />
                        </span>
                        <span className="font-bold" style={{ color: ready.text, fontSize: "14px" }}>
                          {p.readinessScore}%
                        </span>
                        {p.missingFields.length > 0 ? (
                          <span className="mv-visually-hidden">חסרים {p.missingFields.length} פרטים</span>
                        ) : null}
                      </span>
                      <span className="text-[14.5px]" style={{ color: "var(--color-text-soft)" }}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      <span className="text-[14.5px] font-extrabold" style={{ color: "var(--color-primary)" }}>
                        {p.suggestedMatchCount || "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <CapNote show={filtering && items.length === 100} noun="נכסים" />
        </>
      )}
    </>
  );
}
