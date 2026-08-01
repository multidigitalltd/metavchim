"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * שליחת הצעה בקול — מסך האישור. הפקודה כבר פוענחה בשרת לישויות
 * אמיתיות; כאן המתווך רואה בדיוק *איזה נכס* ל*איזה קונה*, ורק לחיצה
 * מפורשת יוצרת את ההצעה ופותחת את הוואטסאפ. דיבור לבדו לא שולח כלום.
 */

interface OfferCandidate {
  propertyId: string;
  propertyLabel: string;
  buyerId: string;
  buyerLabel: string;
  matchId: string;
  score: number;
  explanation: string;
  alreadyOffered: boolean;
}

interface OfferResolution {
  candidates: OfferCandidate[];
  unresolved: { property: boolean; buyer: boolean };
  note?: string;
}

function OfferVoiceContent() {
  const { loading: authLoading } = useRequireAuth();
  const transcript = useSearchParams().get("t") ?? "";
  const [resolution, setResolution] = useState<OfferResolution | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ matchId: string; url: string } | null>(null);

  useEffect(() => {
    if (authLoading || transcript.trim() === "") return;
    apiPost<OfferResolution>("/voice/offer-resolve", { transcript })
      .then(setResolution)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "זיהוי הנכס והקונה נכשל");
      });
  }, [authLoading, transcript]);

  /** שלב 1: יצירת ההצעה. שלב 2 (השליחה בוואטסאפ) בלחיצה נפרדת. */
  async function createOffer(candidate: OfferCandidate) {
    setBusy(true);
    setError(null);
    try {
      const offer = await apiPost<{ id: string; url: string }>("/offers", {
        matchId: candidate.matchId,
      });
      const { waUrl } = await apiPost<{ waUrl: string }>(`/offers/${offer.id}/whatsapp`, {});
      setSent({ matchId: candidate.matchId, url: offer.url });
      window.open(waUrl, "_blank", "noopener");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת ההצעה נכשלה");
    } finally {
      setBusy(false);
      setConfirmingId(null);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold">🎤 שליחת הצעה</h1>
      <p className="mb-1" style={{ color: "var(--color-text-muted)" }}>
        אמרתם: &quot;{transcript}&quot;
      </p>
      <p className="mb-6 text-sm" style={{ color: "var(--color-text-muted)" }}>
        בדקו שהנכס והקונה נכונים — ההצעה נשלחת רק בלחיצה מפורשת.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {sent ? (
        <div className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}>
          <p className="mb-2 font-semibold" style={{ color: "var(--color-success)" }}>
            ✓ ההצעה נוצרה והוואטסאפ נפתח
          </p>
          <p className="mb-2" style={{ color: "var(--color-text-muted)" }}>
            אם החלון לא נפתח, אפשר להעתיק את הקישור:
          </p>
          <p className="overflow-x-auto rounded-lg border p-2 font-mono text-sm" dir="ltr" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
            {sent.url}
          </p>
        </div>
      ) : null}

      {resolution === null ? (
        <p aria-live="polite">מזהה את הנכס והקונה…</p>
      ) : resolution.candidates.length === 0 ? (
        <div className="rounded-xl border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="mb-2 font-semibold">לא הצלחתי לזהות</p>
          <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
            {resolution.note ??
              (resolution.unresolved.property && resolution.unresolved.buyer
                ? "לא נמצאו הנכס והקונה במאגר."
                : resolution.unresolved.property
                  ? "הנכס לא נמצא במאגר."
                  : "הקונה לא נמצא במאגר.")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/properties"><Button variant="secondary">בחר נכס ידנית</Button></Link>
            <Link href="/voice"><Button variant="ghost">חזרה לפקודה קולית</Button></Link>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {resolution.candidates.map((c) => (
            <li
              key={c.matchId}
              className="rounded-xl border p-4"
              style={{
                borderColor: confirmingId === c.matchId ? "var(--color-danger)" : "var(--color-border)",
                background: "var(--color-surface)",
              }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="text-xl font-bold">{c.score}%</span>
                <div className="flex-1">
                  <p className="font-semibold">🏠 {c.propertyLabel}</p>
                  <p>👤 {c.buyerLabel}</p>
                </div>
              </div>
              <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {c.explanation}
              </p>

              {sent?.matchId === c.matchId ? (
                <p className="font-medium" style={{ color: "var(--color-success)" }}>✓ נשלח</p>
              ) : c.alreadyOffered ? (
                <p style={{ color: "var(--color-text-muted)" }}>
                  כבר נשלחה הצעה על ההתאמה הזו —{" "}
                  <Link href={`/properties/${c.propertyId}`} className="underline">לכרטיס הנכס</Link>
                </p>
              ) : confirmingId === c.matchId ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium" style={{ color: "var(--color-danger)" }}>
                    לשלוח את {c.propertyLabel} אל {c.buyerLabel}?
                  </span>
                  <Button variant="danger" disabled={busy} onClick={() => void createOffer(c)}>
                    {busy ? "שולח…" : "כן, שלח"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmingId(null)}>ביטול</Button>
                </div>
              ) : (
                <Button onClick={() => setConfirmingId(c.matchId)}>📤 שלח הצעה</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OfferVoicePage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <OfferVoiceContent />
    </Suspense>
  );
}
