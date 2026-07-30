"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet } from "@/lib/api";
import { FIELD_LABELS, MATURITY_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * דשבורד "מה דורש טיפול היום?" (docs/06 §2) — פעולות נגזרות מהדאטה
 * האמיתי: נכסים לא מושלמים, קונים חמים. מודולי לידים/הצעות יוסיפו
 * פעולות משלהם כשיעלו.
 */

interface PropertyRow {
  id: string;
  city?: string;
  street?: string;
  readinessScore: number;
  missingFields: string[];
}

interface BuyerRow {
  id: string;
  contact: { name: string };
  maturity: string;
}

interface LeadRow {
  id: string;
  contact: { name: string };
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
}

interface AppointmentRow {
  id: string;
  kind: string;
  title?: string;
  startsAt: string;
  status: string;
}

interface Recommendation {
  priority: number;
  type: string;
  title: string;
  body: string;
  entityType?: "property" | "lead" | "buyer" | "offer" | "appointment";
  entityId?: string;
}

function recHref(rec: Recommendation): string | null {
  if (!rec.entityId) return null;
  switch (rec.entityType) {
    case "property":
      return `/properties/${rec.entityId}`;
    case "lead":
      return `/leads/${rec.entityId}`;
    case "buyer":
      return `/buyers/${rec.entityId}`;
    case "appointment":
      return "/calendar";
    default:
      return null;
  }
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useRequireAuth();
  const [properties, setProperties] = useState<PropertyRow[] | null>(null);
  const [buyers, setBuyers] = useState<BuyerRow[] | null>(null);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [today, setToday] = useState<AppointmentRow[] | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    apiGet<{ items: PropertyRow[] }>("/properties?limit=100")
      .then((r) => setProperties(r.items))
      .catch(() => setProperties([]));
    apiGet<{ items: BuyerRow[] }>("/buyers?limit=100")
      .then((r) => setBuyers(r.items))
      .catch(() => setBuyers([]));
    apiGet<{ items: LeadRow[] }>("/leads?limit=100")
      .then((r) => setLeads(r.items))
      .catch(() => setLeads([]));
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    apiGet<AppointmentRow[]>(`/appointments?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`)
      .then(setToday)
      .catch(() => setToday([]));
    apiGet<Recommendation[]>("/coach/recommendations")
      .then(setRecs)
      .catch(() => setRecs([]));
  }, [authLoading, user]);

  if (authLoading || !user) return <p aria-live="polite">טוען…</p>;

  const urgentLeads = (leads ?? []).filter((l) => l.requiresHuman).slice(0, 3);
  const newLeads = (leads ?? []).filter((l) => l.status === "new" && !l.requiresHuman).slice(0, 2);
  const incomplete = (properties ?? []).filter((p) => p.readinessScore < 80).slice(0, 3);
  const hotBuyers = (buyers ?? []).filter((b) => b.maturity === "very_hot" || b.maturity === "hot").slice(0, 3);
  const loading = properties === null || buyers === null || leads === null;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">שלום, {user.name}</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        מה דורש טיפול היום?
      </p>

      <section aria-labelledby="counts-heading" className="mb-8">
        <h2 id="counts-heading" className="mv-visually-hidden">מונים</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "לידים פתוחים", value: leads?.filter((l) => l.status === "new" || l.status === "in_progress").length, href: "/leads" },
            { label: "פגישות היום", value: today?.filter((a) => a.status === "scheduled").length, href: "/calendar" },
            { label: "קונים חמים", value: buyers?.filter((b) => b.maturity === "very_hot" || b.maturity === "hot").length, href: "/buyers" },
            { label: "נכסים להשלמה", value: properties?.filter((p) => p.readinessScore < 80).length, href: "/properties" },
          ].map((card) => (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-xl border p-4 no-underline"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <dt className="text-sm" style={{ color: "var(--color-text-muted)" }}>{card.label}</dt>
              <dd className="text-2xl font-bold">{card.value ?? "…"}</dd>
            </Link>
          ))}
        </dl>
      </section>

      {recs && recs.length > 0 ? (
        <section aria-labelledby="coach-heading" className="mb-8">
          <h2 id="coach-heading" className="mb-3 text-lg font-semibold">
            🧠 עוזר המכירות ממליץ
          </h2>
          <ul className="flex flex-col gap-3">
            {recs.slice(0, 5).map((rec, index) => {
              const href = recHref(rec);
              const card = (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
                  style={{
                    borderColor: rec.priority >= 90 ? "var(--color-danger)" : "var(--color-primary)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div>
                    <h3 className="font-semibold">{rec.title}</h3>
                    <p style={{ color: "var(--color-text-muted)" }}>{rec.body}</p>
                  </div>
                  {href ? <span aria-hidden="true">←</span> : null}
                </div>
              );
              return (
                <li key={`${rec.type}-${index}`}>
                  {href ? (
                    <Link href={href} className="block no-underline">{card}</Link>
                  ) : (
                    card
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="mb-3 text-lg font-semibold">פעולות מומלצות</h2>
        {loading ? (
          <p aria-live="polite">טוען…</p>
        ) : incomplete.length === 0 && hotBuyers.length === 0 && urgentLeads.length === 0 && newLeads.length === 0 ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <p className="mb-3">הכל מטופל ✓ — אפשר להוסיף נכס או קונה חדשים.</p>
            <div className="flex justify-center gap-3">
              <Link href="/properties/new"><Button>נכס חדש</Button></Link>
              <Link href="/buyers/new"><Button variant="secondary">קונה חדש</Button></Link>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {urgentLeads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}>
                <div>
                  <h3 className="font-semibold" style={{ color: "var(--color-danger)" }}>
                    ● ליד דורש טיפול אנושי: {l.contact.name}
                  </h3>
                  {l.requiresHumanReason ? (
                    <p style={{ color: "var(--color-text-muted)" }}>{l.requiresHumanReason}</p>
                  ) : null}
                </div>
                <Link href={`/leads/${l.id}`}><Button variant="danger">טפל עכשיו</Button></Link>
              </li>
            ))}
            {newLeads.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <h3 className="font-semibold">ליד חדש ממתין: {l.contact.name}</h3>
                <Link href={`/leads/${l.id}`}><Button>פתח ליד</Button></Link>
              </li>
            ))}
            {incomplete.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div>
                  <h3 className="font-semibold">
                    להשלים פרטים לנכס {[p.street, p.city].filter(Boolean).join(", ") || "ללא כתובת"}
                  </h3>
                  <p style={{ color: "var(--color-text-muted)" }}>
                    {p.readinessScore}% מוכן — חסרים:{" "}
                    {p.missingFields.slice(0, 4).map((field) => FIELD_LABELS[field] ?? field).join(", ")}
                    {p.missingFields.length > 4 ? ` ועוד ${p.missingFields.length - 4}` : ""}
                  </p>
                </div>
                <Link href={`/properties/${p.id}/edit`}><Button variant="secondary">השלם פרטים</Button></Link>
              </li>
            ))}
            {hotBuyers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div>
                  <h3 className="font-semibold">
                    <span style={{ color: "var(--color-danger)" }} aria-hidden="true">● </span>
                    לבדוק התאמות עבור {b.contact.name}
                    <span className="mv-visually-hidden"> (קונה {MATURITY_LABELS[b.maturity]})</span>
                  </h3>
                  <p style={{ color: "var(--color-text-muted)" }}>
                    קונה {MATURITY_LABELS[b.maturity] ?? b.maturity} — כדאי לוודא שקיבל הצעות רלוונטיות
                  </p>
                </div>
                <Link href={`/buyers/${b.id}`}><Button>צפה בהתאמות</Button></Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
