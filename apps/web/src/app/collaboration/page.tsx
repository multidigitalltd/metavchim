"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";

/** רשת שיתופי הפעולה (אפיון §11-12): ביקושים אנונימיים + קרדיטים. */

interface DemandRow {
  id: string;
  cities: string[];
  dealType: string;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  mustFeatures: string[];
  source: string;
  mine: boolean;
}

interface CoopOfferRow {
  id: string;
  direction: "incoming" | "outgoing";
  presentation: {
    city?: string;
    neighborhood?: string;
    rooms?: number;
    priceAgorot?: number;
    title?: string;
  };
  status: string;
}

interface PropertyOption {
  id: string;
  city?: string;
  street?: string;
  marketingTitle?: string;
}

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
};

export default function CollaborationPage() {
  const { loading: authLoading } = useRequireAuth();
  const [demands, setDemands] = useState<DemandRow[] | null>(null);
  const [coopOffers, setCoopOffers] = useState<CoopOfferRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<DemandRow[]>("/collaboration/demands").then(setDemands).catch(() => setDemands([]));
    apiGet<CoopOfferRow[]>("/collaboration/offers").then(setCoopOffers).catch(() => undefined);
    apiGet<{ balance: number }>("/collaboration/credits")
      .then((r) => setBalance(r.balance))
      .catch(() => undefined);
    apiGet<{ items: PropertyOption[] }>("/properties?limit=50")
      .then((r) => setProperties(r.items))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  async function sendOffer(demandId: string) {
    const propertyId = selectedProperty[demandId];
    if (!propertyId) return;
    try {
      await apiPost(`/collaboration/demands/${demandId}/offer`, { propertyId });
      setMessage("✓ ההצעה נשלחה לסוכנות (עלות: קרדיט אחד). אם הקונה יתעניין — תקבלו התראה.");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "שליחת ההצעה נכשלה");
    }
  }

  async function respond(offerId: string, response: "interested" | "declined") {
    await apiPatch(`/collaboration/offers/${offerId}/respond`, { response });
    load();
  }

  const incoming = coopOffers.filter((o) => o.direction === "incoming");

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">שיתופי פעולה</h1>
        <span className="rounded-full border px-4 py-1.5 font-medium" style={{ borderColor: "var(--color-border)" }}>
          💎 {balance ?? "…"} קרדיטים
        </span>
      </div>

      {message ? (
        <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}

      {incoming.length > 0 ? (
        <section aria-labelledby="incoming-heading" className="mb-8">
          <h2 id="incoming-heading" className="mb-3 text-lg font-semibold">
            🤝 הצעות שהתקבלו על הביקושים שלך ({incoming.length})
          </h2>
          <ul className="flex flex-col gap-3">
            {incoming.map((offer) => (
              <li key={offer.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-primary)", background: "var(--color-surface)" }}>
                <p className="mb-2 font-medium">
                  {offer.presentation.title ??
                    `${offer.presentation.rooms ?? "?"} חדרים ב${offer.presentation.neighborhood ?? offer.presentation.city ?? "?"}`}
                  {" · "}
                  {formatPrice(offer.presentation.priceAgorot)}
                </p>
                <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  כתובת מלאה ופרטי הסוכנות ייחשפו אחרי אישור החיבור (חשיפה מדורגת).
                </p>
                {offer.status === "sent" ? (
                  <div className="flex gap-2">
                    <Button onClick={() => void respond(offer.id, "interested")}>מעניין — פתח חיבור</Button>
                    <Button variant="ghost" onClick={() => void respond(offer.id, "declined")}>לא מתאים</Button>
                  </div>
                ) : (
                  <span className="font-medium" style={{ color: "var(--color-success)" }}>
                    {offer.status === "interested" ? "✓ אושר — הסוכנויות מחוברות" : "נדחה"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="demands-heading">
        <h2 id="demands-heading" className="mb-1 text-lg font-semibold">ביקושים ברשת</h2>
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          קונים אנונימיים מסוכנויות אחרות ומ-Kanko. יש לך נכס מתאים? שליחת הצעה עולה קרדיט אחד.
        </p>
        {demands === null ? (
          <p aria-live="polite">טוען…</p>
        ) : demands.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>
            אין ביקושים פעילים ברשת. שתפו קונה מפרופיל הקונה — וסוכנויות אחרות יוכלו להציע לו נכסים.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {demands.map((demand) => (
              <li key={demand.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    קונה מחפש {demand.roomsMin ?? "?"}–{demand.roomsMax ?? "?"} חדרים ב
                    {demand.cities.join(" / ")} עד {formatPrice(demand.budgetMaxAgorot)}
                  </span>
                  {demand.source === "kanko" ? (
                    <span className="rounded-full border px-2 py-0.5 text-sm" style={{ borderColor: "var(--color-border)" }}>Kanko</span>
                  ) : null}
                  {demand.mine ? (
                    <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "var(--color-border)" }}>הביקוש שלך</span>
                  ) : null}
                </div>
                {demand.mustFeatures.length > 0 ? (
                  <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    חובה: {demand.mustFeatures.map((f) => FEATURE_LABELS[f] ?? f).join(", ")}
                  </p>
                ) : null}
                {!demand.mine ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={`prop_${demand.id}`} className="mv-visually-hidden">
                      בחר נכס להצעה
                    </label>
                    <select
                      id={`prop_${demand.id}`}
                      value={selectedProperty[demand.id] ?? ""}
                      onChange={(event) =>
                        setSelectedProperty((prev) => ({ ...prev, [demand.id]: event.target.value }))
                      }
                      className="rounded-lg border px-3 py-2"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                    >
                      <option value="">בחר נכס להצעה…</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.marketingTitle ?? [p.street, p.city].filter(Boolean).join(", ")}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      disabled={!selectedProperty[demand.id]}
                      onClick={() => void sendOffer(demand.id)}
                    >
                      הצע נכס (קרדיט אחד)
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
