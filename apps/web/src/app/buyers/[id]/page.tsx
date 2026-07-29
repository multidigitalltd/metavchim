"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice, MATURITY_LABELS } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { TimelineSection } from "./timeline-section";
import { RelatedEntities } from "../../related-entities";

interface BuyerDetail {
  id: string;
  contact: { id: string; name: string; phone: string };
  requirements: {
    cities: string[];
    budgetMaxAgorot: number;
    roomsMin?: number;
    roomsMax?: number;
    features: Record<string, "must" | "nice">;
  };
  maturity: string;
  source: string;
  agentNotes?: string;
}

interface MatchRow {
  id: string;
  propertyId: string;
  score: number;
  explanation: string;
}

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
};

export default function BuyerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function shareToNetwork() {
    try {
      await apiPost("/collaboration/share", { buyerId: id });
      setShareStatus("✓ הקונה שותף ברשת כביקוש אנונימי — בלי שם, בלי טלפון, תקציב מעוגל");
    } catch (err: unknown) {
      setShareStatus(err instanceof ApiError ? err.message : "השיתוף נכשל");
    }
  }

  useEffect(() => {
    if (authLoading) return;
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then(setBuyer)
      .catch(() => setError("הקונה לא נמצא"));
    apiGet<MatchRow[]>(`/buyers/${id}/matches`)
      .then(setMatches)
      .catch(() => setMatches([]));
  }, [authLoading, id]);

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/buyers" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!buyer) return <p aria-live="polite">טוען…</p>;

  const musts = Object.entries(buyer.requirements.features).filter(([, l]) => l === "must");
  const nices = Object.entries(buyer.requirements.features).filter(([, l]) => l === "nice");

  return (
    <>
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/buyers" className="underline">קונים</Link>
        <span aria-hidden="true"> / </span>
        <span>{buyer.contact.name}</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{buyer.contact.name}</h1>
        <p style={{ color: "var(--color-text-muted)" }}>
          <span dir="ltr">{buyer.contact.phone}</span> · {MATURITY_LABELS[buyer.maturity] ?? buyer.maturity} · מקור: {buyer.source}
        </p>
      </div>

      <RelatedEntities contactId={buyer.contact.id} exclude={{ kind: "buyer", id: buyer.id }} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void shareToNetwork()}>
          🌐 שתף ברשת (אנונימי)
        </Button>
        {shareStatus ? <span role="status">{shareStatus}</span> : null}
      </div>

      <section aria-labelledby="req-heading" className="mb-8 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 id="req-heading" className="mb-3 text-lg font-semibold">מה הוא מחפש</h2>
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <div><dt className="inline font-medium">אזורים: </dt><dd className="inline">{buyer.requirements.cities.join(", ")}</dd></div>
          <div><dt className="inline font-medium">תקציב עד: </dt><dd className="inline">{formatPrice(buyer.requirements.budgetMaxAgorot)}</dd></div>
          <div><dt className="inline font-medium">חדרים: </dt><dd className="inline">{buyer.requirements.roomsMin ?? "—"}–{buyer.requirements.roomsMax ?? "—"}</dd></div>
          <div>
            <dt className="inline font-medium">חובה: </dt>
            <dd className="inline">{musts.length > 0 ? musts.map(([k]) => FEATURE_LABELS[k] ?? k).join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="inline font-medium">עדיפות: </dt>
            <dd className="inline">{nices.length > 0 ? nices.map(([k]) => FEATURE_LABELS[k] ?? k).join(", ") : "—"}</dd>
          </div>
        </dl>
      </section>

      <TimelineSection buyerId={id} />

      <section aria-labelledby="matches-heading">
        <h2 id="matches-heading" className="mb-3 text-lg font-semibold">
          נכסים מתאימים {matches !== null ? `(${matches.length})` : ""}
        </h2>
        {matches === null ? (
          <p aria-live="polite">מחשב התאמות…</p>
        ) : matches.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>אין עדיין נכסים מתאימים במאגר.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((m) => (
              <li key={m.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="mb-1 flex flex-wrap items-center gap-3">
                  <span className="text-xl font-bold">{m.score}%</span>
                  <Link href={`/properties/${m.propertyId}`} className="underline">לכרטיס הנכס</Link>
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
