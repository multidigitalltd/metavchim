"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { CapNote, FilterSelect, ResultsCount, SearchField, SortSelect, textMatches } from "../list-controls";

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
  /** קונים שממתינים להצעה על הנכס — הפעולה הבאה של המתווך */
  suggestedMatchCount?: number;
}

function addressOf(p: PropertyRow): string {
  return [p.street, p.neighborhood, p.city].filter(Boolean).join(", ") || "ללא כתובת";
}

function Thumb({ url, size }: { url?: string; size: "sm" | "lg" }) {
  const box = size === "sm" ? "h-12 w-16" : "h-20 w-24";
  if (url) {
    // img רגיל בכוונה: מוזרם דרך ה-API, לא לאופטימיזציית Next
    return <img src={API_BASE + url} alt="" className={`${box} rounded-lg object-cover`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} flex items-center justify-center rounded-lg text-xl`}
      style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
    >
      🏠
    </span>
  );
}

/** תג "N קונים מתאימים" — קישור ישיר להתאמות של הנכס. */
function MatchesBadge({ id, count }: { id: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link
      href={`/matches?property=${id}`}
      className="inline-block rounded-full px-2.5 py-1 text-sm font-medium"
      style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
    >
      {count} קונים מתאימים ←
    </Link>
  );
}

function ReadinessText({ score, missing }: { score: number; missing: number }) {
  return (
    <span style={{ color: score >= 80 ? "var(--color-success)" : "var(--color-danger)" }}>
      {score}%{missing > 0 ? <span className="mv-visually-hidden"> — חסרים {missing} פרטים</span> : null}
    </span>
  );
}

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

export default function PropertiesPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<PropertyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("newest");

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: PropertyRow[] }>("/properties?limit=100")
      .then((res) => setItems(res.items))
      .catch(() => setError("טעינת הנכסים נכשלה"));
  }, [authLoading]);

  const visible = useMemo(() => {
    if (!items) return [];
    const filtered = items.filter(
      (p) =>
        textMatches(query, p.street, p.neighborhood, p.city) &&
        (!status || p.status === status) &&
        (!type || p.propertyType === type),
    );
    return sortRows(filtered, sort);
  }, [items, query, status, type, sort]);

  const filtering = query.trim() !== "" || status !== "" || type !== "" || sort !== "newest";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">נכסים</h1>
        <div className="flex gap-2">
          <Link href="/properties/voice">
            <Button>🎤 נכס בקול</Button>
          </Link>
          <Link href="/properties/new">
            <Button variant="secondary">➕ נכס חדש</Button>
          </Link>
          <Link href="/import">
            <Button variant="secondary">📄 ייבוא מקובץ</Button>
          </Link>
        </div>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : items === null ? (
        <p aria-live="polite">טוען נכסים…</p>
      ) : items.length === 0 ? (
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
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <SearchField
              label="חיפוש נכס"
              placeholder="🔍 רחוב, שכונה או עיר"
              value={query}
              onChange={setQuery}
            />
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
            <ResultsCount shown={visible.length} total={items.length} noun="נכסים" />
          </div>

          {visible.length === 0 ? (
            <div
              className="rounded-xl border p-8 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="mb-3">אף נכס לא תואם את הסינון.</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setType("");
                }}
              >
                נקה סינון
              </Button>
            </div>
          ) : (
            <>
            {/* מובייל: כרטיסים. טבלה בת 8 עמודות במסך 375px דורשת גלילה
                לצדדים — והמתווך עומד בשטח עם יד אחת פנויה (docs/06 §1.5) */}
            <ul className="flex flex-col gap-3 sm:hidden">
              {visible.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-surface)",
                    boxShadow: "var(--shadow-card)",
                  }}
                >
                  <div className="flex gap-3">
                    <Thumb url={p.thumbnailUrl} size="lg" />
                    <div className="min-w-0 flex-1">
                      <Link href={`/properties/${p.id}`} className="font-semibold underline">
                        {addressOf(p)}
                      </Link>
                      <p className="mt-1" style={{ color: "var(--color-text-muted)" }}>
                        {[
                          p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : null,
                          p.rooms ? `${p.rooms} חד׳` : null,
                          formatPrice(p.priceAgorot),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 text-sm">
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {STATUS_LABELS[p.status] ?? p.status} · מוכנות{" "}
                        </span>
                        <ReadinessText score={p.readinessScore} missing={p.missingFields.length} />
                      </p>
                    </div>
                  </div>
                  {p.suggestedMatchCount ? (
                    <div className="mt-3">
                      <MatchesBadge id={p.id} count={p.suggestedMatchCount} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            <div
              className="hidden overflow-x-auto rounded-xl border sm:block"
              style={{ borderColor: "var(--color-border)" }}
            >
              <table className="w-full text-start">
                <caption className="mv-visually-hidden">
                  רשימת הנכסים במשרד: כתובת, פרטים, מחיר, סטטוס ומוכנות לשיווק
                </caption>
                <thead style={{ background: "var(--color-surface)" }}>
                  <tr>
                    <th scope="col" className="p-3 text-start">
                      <span className="mv-visually-hidden">תמונה</span>
                    </th>
                    <th scope="col" className="p-3 text-start">כתובת</th>
                    <th scope="col" className="p-3 text-start">סוג</th>
                    <th scope="col" className="p-3 text-start">חדרים</th>
                    <th scope="col" className="p-3 text-start">מחיר</th>
                    <th scope="col" className="p-3 text-start">סטטוס</th>
                    <th scope="col" className="p-3 text-start">מוכנות</th>
                    <th scope="col" className="p-3 text-start">קונים מתאימים</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      <td className="p-2" style={{ width: "72px" }}>
                        <Thumb url={p.thumbnailUrl} size="sm" />
                      </td>
                      <td className="p-3">
                        <Link href={`/properties/${p.id}`} className="font-medium underline">
                          {addressOf(p)}
                        </Link>
                      </td>
                      <td className="p-3">{p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : "—"}</td>
                      <td className="p-3">{p.rooms ?? "—"}</td>
                      <td className="p-3">{formatPrice(p.priceAgorot)}</td>
                      <td className="p-3">{STATUS_LABELS[p.status] ?? p.status}</td>
                      <td className="p-3">
                        <ReadinessText score={p.readinessScore} missing={p.missingFields.length} />
                      </td>
                      <td className="p-3">
                        {p.suggestedMatchCount ? (
                          <MatchesBadge id={p.id} count={p.suggestedMatchCount} />
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          <CapNote show={filtering && items.length === 100} noun="נכסים" />
        </>
      )}
    </>
  );
}
