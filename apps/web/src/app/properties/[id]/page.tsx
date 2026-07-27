"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import {
  FIELD_LABELS,
  formatDate,
  formatPrice,
  PROPERTY_TYPE_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

interface PropertyDetail {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  priceAgorot?: number;
  entryDate?: string;
  status: string;
  marketingTitle?: string;
  readinessScore: number;
  missingFields: string[];
}

interface MatchRow {
  id: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
}

function scoreLabel(score: number): string {
  if (score >= 85) return "מומלץ לשליחה";
  if (score >= 70) return "ייתכן שמתאים";
  return "דורש בדיקה";
}

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    apiGet<PropertyDetail>(`/properties/${id}`)
      .then(setProperty)
      .catch(() => setError("הנכס לא נמצא"));
    apiGet<MatchRow[]>(`/properties/${id}/matches`)
      .then(setMatches)
      .catch(() => setMatches([]));
  }, [authLoading, id]);

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/properties" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!property) return <p aria-live="polite">טוען…</p>;

  const address = [property.street, property.neighborhood, property.city].filter(Boolean).join(", ");
  const features = [
    property.hasElevator && "מעלית",
    property.hasParking && "חניה",
    property.hasBalcony && "מרפסת",
    property.hasSafeRoom && 'ממ"ד',
  ].filter(Boolean) as string[];

  return (
    <>
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/properties" className="underline">נכסים</Link>
        <span aria-hidden="true"> / </span>
        <span>{address || "נכס"}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{property.marketingTitle ?? address}</h1>
          <p style={{ color: "var(--color-text-muted)" }}>
            {address} · {STATUS_LABELS[property.status] ?? property.status}
          </p>
        </div>
        <p className="text-2xl font-bold">{formatPrice(property.priceAgorot)}</p>
      </div>

      {property.missingFields.length > 0 ? (
        <section
          aria-labelledby="missing-heading"
          className="mb-6 rounded-xl border p-4"
          style={{ borderColor: "var(--color-danger)" }}
        >
          <h2 id="missing-heading" className="mb-2 font-semibold">
            הנכס {property.readinessScore}% מוכן — חסרים {property.missingFields.length} פרטים להשלמה:
          </h2>
          <ul className="flex flex-wrap gap-2">
            {property.missingFields.map((field) => (
              <li
                key={field}
                className="rounded-full border px-3 py-1 text-sm"
                style={{ borderColor: "var(--color-border)" }}
              >
                {FIELD_LABELS[field] ?? field}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mb-6 font-medium" style={{ color: "var(--color-success)" }}>
          ✓ הנכס מוכן לשיווק — {property.readinessScore}%
        </p>
      )}

      <section aria-labelledby="details-heading" className="mb-8">
        <h2 id="details-heading" className="mb-3 text-lg font-semibold">פרטי הנכס</h2>
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="inline font-medium">סוג: </dt><dd className="inline">{property.propertyType ? PROPERTY_TYPE_LABELS[property.propertyType] : "—"}</dd></div>
          <div><dt className="inline font-medium">חדרים: </dt><dd className="inline">{property.rooms ?? "—"}</dd></div>
          <div><dt className="inline font-medium">שטח: </dt><dd className="inline">{property.areaSqm ? `${property.areaSqm} מ"ר` : "—"}</dd></div>
          <div><dt className="inline font-medium">קומה: </dt><dd className="inline">{property.floor ?? "—"}{property.totalFloors ? ` מתוך ${property.totalFloors}` : ""}</dd></div>
          <div><dt className="inline font-medium">כניסה: </dt><dd className="inline">{formatDate(property.entryDate)}</dd></div>
          <div><dt className="inline font-medium">מאפיינים: </dt><dd className="inline">{features.length > 0 ? features.join(", ") : "—"}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="matches-heading">
        <h2 id="matches-heading" className="mb-3 text-lg font-semibold">
          קונים מתאימים {matches !== null ? `(${matches.length})` : ""}
        </h2>
        {matches === null ? (
          <p aria-live="polite">מחשב התאמות…</p>
        ) : matches.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>
            אין עדיין קונים מתאימים. <Link href="/buyers/new" className="underline">הוסיפו קונה</Link> — וההתאמות יחושבו אוטומטית.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border p-4"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div className="mb-1 flex flex-wrap items-center gap-3">
                  <span className="text-xl font-bold">{m.score}%</span>
                  <span
                    className="rounded-full px-3 py-0.5 text-sm font-medium"
                    style={{
                      background: m.score >= 85 ? "var(--color-primary)" : "var(--color-border)",
                      color: m.score >= 85 ? "var(--color-bg)" : "var(--color-text)",
                    }}
                  >
                    {scoreLabel(m.score)}
                  </span>
                  <Link href={`/buyers/${m.buyerId}`} className="underline">לפרופיל הקונה</Link>
                </div>
                <p style={{ color: "var(--color-text-muted)" }}>{m.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
