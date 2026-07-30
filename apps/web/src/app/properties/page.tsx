"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
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
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
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
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
                      <td className="p-2" style={{ width: "72px" }}>
                        {p.thumbnailUrl ? (
                          // img רגיל בכוונה: URL חתום זמני מהאחסון, לא לאופטימיזציית Next
                          <img
                            src={p.thumbnailUrl}
                            alt=""
                            className="h-12 w-16 rounded-lg object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="flex h-12 w-16 items-center justify-center rounded-lg text-xl"
                            style={{ background: "var(--color-surface)", color: "var(--color-text-muted)" }}
                          >
                            🏠
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <Link href={`/properties/${p.id}`} className="font-medium underline">
                          {[p.street, p.neighborhood, p.city].filter(Boolean).join(", ") || "ללא כתובת"}
                        </Link>
                      </td>
                      <td className="p-3">{p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : "—"}</td>
                      <td className="p-3">{p.rooms ?? "—"}</td>
                      <td className="p-3">{formatPrice(p.priceAgorot)}</td>
                      <td className="p-3">{STATUS_LABELS[p.status] ?? p.status}</td>
                      <td className="p-3">
                        <span
                          style={{
                            color: p.readinessScore >= 80 ? "var(--color-success)" : "var(--color-danger)",
                          }}
                        >
                          {p.readinessScore}%
                        </span>
                        {p.missingFields.length > 0 ? (
                          <span className="mv-visually-hidden">
                            {" "}
                            — חסרים {p.missingFields.length} פרטים
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CapNote show={filtering && items.length === 100} noun="נכסים" />
        </>
      )}
    </>
  );
}
