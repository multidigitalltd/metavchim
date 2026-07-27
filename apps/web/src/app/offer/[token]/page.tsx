"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";

/**
 * דף ההצעה ללקוח קצה (docs/06 §6) — ציבורי, בלי התחברות, לפי טוקן בלבד.
 * כרטיס הביקור של המתווך: מהיר, נגיש, ופעולה אחת ברורה לכל החלטה.
 */

interface PublicOffer {
  presentation: {
    title: string;
    city?: string;
    neighborhood?: string;
    rooms?: number;
    areaSqm?: number;
    floor?: number;
    priceAgorot?: number;
    features: string[];
    description?: string;
    agencyName: string;
  };
  status: string;
}

export default function PublicOfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [responded, setResponded] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiGet<PublicOffer>(`/public/offers/${token}`)
      .then((o) => {
        setOffer(o);
        if (o.status === "interested" || o.status === "declined") setResponded(o.status);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.status === 410
            ? "תוקף ההצעה פג — פנו למתווך לקבלת הצעה עדכנית."
            : "ההצעה לא נמצאה.",
        );
      });
  }, [token]);

  async function respond(response: "interested" | "declined") {
    setSubmitting(true);
    try {
      await apiPost(`/public/offers/${token}/respond`, { response });
      setResponded(response);
    } catch {
      setError("שליחת התגובה נכשלה — נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p role="alert" className="text-lg">{error}</p>
      </div>
    );
  }
  if (!offer) {
    return <p aria-live="polite" className="py-16 text-center">טוען את פרטי הנכס…</p>;
  }

  const p = offer.presentation;
  const detailItems = [
    p.rooms !== undefined && { label: "חדרים", value: String(p.rooms) },
    p.areaSqm !== undefined && { label: "שטח", value: `${p.areaSqm} מ"ר` },
    p.floor !== undefined && { label: "קומה", value: String(p.floor) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <article className="mx-auto max-w-lg">
      <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
        הצעת נכס מ{p.agencyName}
      </p>
      <h1 className="mb-1 text-2xl font-bold">{p.title}</h1>
      <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
        {[p.neighborhood, p.city].filter(Boolean).join(", ")}
      </p>

      <p className="mb-6 text-3xl font-bold">{formatPrice(p.priceAgorot)}</p>

      {detailItems.length > 0 ? (
        <dl className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
          {detailItems.map((item) => (
            <div key={item.label}>
              <dt className="inline font-medium">{item.label}: </dt>
              <dd className="inline">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {p.features.length > 0 ? (
        <ul className="mb-6 flex flex-wrap gap-2" aria-label="מאפייני הנכס">
          {p.features.map((feature) => (
            <li
              key={feature}
              className="rounded-full border px-3 py-1"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              ✓ {feature}
            </li>
          ))}
        </ul>
      ) : null}

      {p.description ? <p className="mb-8 whitespace-pre-line">{p.description}</p> : null}

      {responded ? (
        <p
          role="status"
          className="rounded-xl border p-4 text-center font-medium"
          style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
        >
          {responded === "interested"
            ? "תודה! המתווך יחזור אליכם בהקדם לתיאום צפייה."
            : "תודה על העדכון — לא נציע לכם את הנכס הזה שוב."}
        </p>
      ) : (
        <div className="flex flex-col gap-3" role="group" aria-label="מה דעתכם על הנכס?">
          <Button disabled={submitting} onClick={() => void respond("interested")} className="w-full">
            👍 מעוניין — שהמתווך יחזור אליי
          </Button>
          <Button
            disabled={submitting}
            variant="secondary"
            onClick={() => void respond("declined")}
            className="w-full"
          >
            לא רלוונטי עבורי
          </Button>
        </div>
      )}
    </article>
  );
}
