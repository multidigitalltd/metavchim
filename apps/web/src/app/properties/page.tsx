"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { formatPrice, PROPERTY_TYPE_LABELS, STATUS_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

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
}

export default function PropertiesPage() {
  const { loading: authLoading } = useRequireAuth();
  const [items, setItems] = useState<PropertyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<{ items: PropertyRow[] }>("/properties?limit=50")
      .then((res) => setItems(res.items))
      .catch(() => setError("טעינת הנכסים נכשלה"));
  }, [authLoading]);

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
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-start">
            <caption className="mv-visually-hidden">
              רשימת הנכסים במשרד: כתובת, פרטים, מחיר, סטטוס ומוכנות לשיווק
            </caption>
            <thead style={{ background: "var(--color-surface)" }}>
              <tr>
                <th scope="col" className="p-3 text-start">כתובת</th>
                <th scope="col" className="p-3 text-start">סוג</th>
                <th scope="col" className="p-3 text-start">חדרים</th>
                <th scope="col" className="p-3 text-start">מחיר</th>
                <th scope="col" className="p-3 text-start">סטטוס</th>
                <th scope="col" className="p-3 text-start">מוכנות</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-t" style={{ borderColor: "var(--color-border)" }}>
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
    </>
  );
}
