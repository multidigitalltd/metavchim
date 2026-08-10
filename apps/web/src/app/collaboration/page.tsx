"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COMMISSION_SPLIT_OPTIONS,
  DEFAULT_COMMISSION_SPLIT,
  describeCommissionSplit,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import Link from "next/link";
import { LoadError } from "../load-error";

/** רשת שיתופי הפעולה (אפיון §11-12): ביקושים אנונימיים + קרדיטים. */

interface DemandMatch {
  propertyId: string;
  title: string;
  score: number;
  explanation: string;
}

interface DemandRow {
  id: string;
  cities: string[];
  neighborhoods?: string[];
  notes?: string;
  dealType: string;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  mustFeatures: string[];
  source: string;
  /** כמה קרדיטים תעלה הצעה. 0 = חינם (ביקוש של משרד אחר). */
  creditsCost: number;
  /** אחוז העמלה שהמשרד המשתף מבקש; לצד השני נשאר המשלים. */
  commissionSplit: number;
  mine: boolean;
  myMatches?: DemandMatch[];
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

interface SharedLeadRow {
  id: string;
  intent: string;
  source: string;
  city?: string;
  note?: string;
  priceCredits: number;
  status: string;
  mine: boolean;
  originLeadId?: string;
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
  const [sharedLeads, setSharedLeads] = useState<SharedLeadRow[]>([]);
  const [buyingLead, setBuyingLead] = useState<string | null>(null);
  const [boughtLeadId, setBoughtLeadId] = useState<string | null>(null);
  const [coopOffers, setCoopOffers] = useState<CoopOfferRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Record<string, string>>({});
  /*
   * החלוקה לכל ביקוש בנפרד. ברירת המחדל היא מה שהמשרד המשתף ביקש,
   * ואפשר להציע אחרת — זו הצעה עד שהצד השני מסמן "מעוניין".
   */
  const [offerSplit, setOfferSplit] = useState<Record<string, number>>({});
  const [message, setMessageState] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  /** כל הודעה חדשה מוחקת את קישור "פתח את הליד" של הקנייה הקודמת. */
  function setMessage(text: string | null, leadId: string | null = null) {
    setMessageState(text);
    setBoughtLeadId(leadId);
  }

  const load = useCallback(() => {
    setLoadFailed(false);
    /*
     * כישלון בטעינת הביקושים אינו "אין ביקושים ברשת".
     * קודם הוא הפך ל-[] והמסך הציג את מצב הריק — כלומר תקלת רשת
     * נראתה כמו מסקנה עסקית ("אין מה לעשות כאן"), והמתווך היה עוזב.
     */
    apiGet<DemandRow[]>("/collaboration/demands")
      .then(setDemands)
      .catch(() => setLoadFailed(true));
    apiGet<CoopOfferRow[]>("/collaboration/offers").then(setCoopOffers).catch(() => undefined);
    apiGet<SharedLeadRow[]>("/collaboration/leads").then(setSharedLeads).catch(() => undefined);
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
    await sendOfferFor(demandId, propertyId);
  }

  async function sendOfferFor(demandId: string, propertyId: string) {
    try {
      /*
       * החלוקה שהמשרד המשתף ביקש היא ברירת המחדל של ההצעה — הצעה
       * שמשנה אותה בשקט הייתה הפתעה לצד השני.
       */
      await apiPost(`/collaboration/demands/${demandId}/offer`, {
        propertyId,
        commissionSplit:
          offerSplit[demandId] ??
          demands?.find((d) => d.id === demandId)?.commissionSplit ??
          DEFAULT_COMMISSION_SPLIT,
      });
      setMessage("✓ ההצעה נשלחה. אם הקונה יתעניין — תקבלו התראה.");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "שליחת ההצעה נכשלה");
    }
  }

  async function respond(offerId: string, response: "interested" | "declined") {
    await apiPatch(`/collaboration/offers/${offerId}/respond`, { response });
    load();
  }

  async function buyLead(id: string, price: number) {
    /*
     * אישור מפורש לפני חיוב — קנייה בלחיצה אחת בלי שאלה היא בדיוק
     * איך מבזבזים קרדיטים בטעות.
     */
    if (!window.confirm(`לקנות את הליד תמורת ${price} קרדיטים? פרטי הקשר ייחשפו מיד.`)) return;
    setBuyingLead(id);
    try {
      const { leadId } = await apiPost<{ leadId: string }>(`/collaboration/leads/${id}/buy`, {});
      setMessage("✓ הליד נרכש — פרטי הקשר המלאים מחכים לכם בכרטיס הליד.", leadId);
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "הקנייה נכשלה");
    } finally {
      setBuyingLead(null);
    }
  }

  async function withdrawLead(id: string) {
    try {
      await apiDelete(`/collaboration/leads/${id}`);
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "ההסרה נכשלה");
    }
  }

  const incoming = coopOffers.filter((o) => o.direction === "incoming");
  const leadsForSale = sharedLeads.filter((l) => !l.mine && l.status === "active");
  const myListedLeads = sharedLeads.filter((l) => l.mine);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">שיתופי פעולה</h1>
        <div className="flex flex-wrap items-center gap-3">
          {/* הפרסום עצמו נעשה מכרטיס הקונה — הביקוש נגזר מדרישות
              אמיתיות ולא מטופס ריק. אבל מי שנוחת כאן צריך לדעת שזה
              קיים ואיפה, אחרת המסך נראה כמו רשימה לצפייה בלבד. */}
          <Link href="/buyers" className="mv-btn-action" style={{ textDecoration: "none" }}>
            + פרסם ביקוש
          </Link>
          <span className="rounded-full border px-4 py-1.5 font-medium" style={{ borderColor: "var(--color-border)" }}>
            💎 {balance ?? "…"} קרדיטים
          </span>
        </div>
      </div>

      <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
        פרסום ביקוש נעשה מכרטיס הקונה — כך הוא נושא את הדרישות האמיתיות שלו.
        בחרו קונה, ובכרטיס שלו לחצו על שיתוף לרשת.
      </p>

      {message ? (
        <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-primary)" }}>
          {message}
          {boughtLeadId ? (
            <>
              {" "}
              <Link href={`/leads/${boughtLeadId}`} className="font-medium underline">
                פתח את הליד ←
              </Link>
            </>
          ) : null}
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

      {leadsForSale.length > 0 || myListedLeads.length > 0 ? (
        <section aria-labelledby="lead-market-heading" className="mb-8">
          <h2 id="lead-market-heading" className="mb-1 text-lg font-semibold">🛒 שוק הלידים</h2>
          <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
            לידים שמשרדים אחרים מוכרים בקרדיטים. שם וטלפון נחשפים רק אחרי הקנייה;
            מכירת ליד נעשית מכרטיס הליד עצמו.
          </p>
          <ul className="flex flex-col gap-3">
            {myListedLeads.map((lead) => (
              <li key={lead.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "var(--color-border)" }}>הליד שלך</span>
                  {lead.status === "sold" ? (
                    <span className="font-medium" style={{ color: "var(--color-success)" }}>
                      ✓ נמכר — {lead.priceCredits} קרדיטים נוספו ליתרה
                    </span>
                  ) : lead.status === "withdrawn" ? (
                    <span style={{ color: "var(--color-text-muted)" }}>הוסר מהשוק</span>
                  ) : (
                    <>
                      <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "#f7efdd", color: "#7a5c1f" }}>
                        {lead.priceCredits} קרדיטים
                      </span>
                      <Button variant="ghost" onClick={() => void withdrawLead(lead.id)}>
                        הסר מהשוק
                      </Button>
                    </>
                  )}
                </div>
                {lead.note ? (
                  <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>{lead.note}</p>
                ) : null}
              </li>
            ))}
            {leadsForSale.map((lead) => (
              <li key={lead.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
                    מקור: {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                  </span>
                  <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "#f7efdd", color: "#7a5c1f" }}>
                    {lead.priceCredits} קרדיטים
                  </span>
                </div>
                {lead.note ? (
                  <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>{lead.note}</p>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={buyingLead !== null}
                  onClick={() => void buyLead(lead.id, lead.priceCredits)}
                >
                  {buyingLead === lead.id
                    ? "קונה…"
                    : `קנה ליד (${lead.priceCredits} קרדיטים)`}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="demands-heading">
        <h2 id="demands-heading" className="mb-1 text-lg font-semibold">ביקושים ברשת</h2>
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          קונים אנונימיים ממשרדי תיווך אחרים ומ-Kanko. הצעה למשרד אחר היא חינם, בכל
          המסלולים; ליד ממקור חיצוני עולה קרדיטים.
        </p>
        {loadFailed ? (
          <LoadError message="לא הצלחנו לטעון את הביקושים ברשת" onRetry={load} />
        ) : demands === null ? (
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
                  {/*
                    העלות ליד כל ביקוש ולא רק בכותרת: הכותרת מסבירה את
                    הכלל, והתווית הזו אומרת מה קורה בלחיצה הזו.
                  */}
                  {!demand.mine ? (
                    <span
                      className="rounded-full px-2 py-0.5 text-sm"
                      style={
                        demand.creditsCost > 0
                          ? { background: "#f7efdd", color: "#7a5c1f" }
                          : { background: "var(--color-primary-soft)", color: "var(--color-primary)" }
                      }
                    >
                      {demand.creditsCost > 0 ? `${demand.creditsCost} קרדיטים` : "חינם"}
                    </span>
                  ) : null}
                  {!demand.mine ? (
                    <span
                      className="rounded-full border px-2 py-0.5 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                      title="חלוקת העמלה שהמשרד המשתף ביקש"
                    >
                      עמלה {describeCommissionSplit(demand.commissionSplit)}
                    </span>
                  ) : null}
                  {demand.mine ? (
                    <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "var(--color-border)" }}>הביקוש שלך</span>
                  ) : null}
                </div>
                {demand.neighborhoods && demand.neighborhoods.length > 0 ? (
                  <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    שכונות: {demand.neighborhoods.join(", ")}
                  </p>
                ) : null}
                {demand.mustFeatures.length > 0 ? (
                  <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    חובה: {demand.mustFeatures.map((f) => FEATURE_LABELS[f] ?? f).join(", ")}
                  </p>
                ) : null}
                {demand.notes ? (
                  // התיאור החופשי של המשרד המשתף — "מה הקונה מחפש" במילים
                  <p className="mb-2 rounded-lg border p-2.5 text-sm" style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}>
                    „{demand.notes}”
                  </p>
                ) : null}
                {!demand.mine ? (
                  <>
                    {/*
                      החלוקה נבחרת לפני השליחה. ברירת המחדל היא מה
                      שהמשרד המשתף ביקש — הצעה שמשנה אותה בשקט הייתה
                      הפתעה לצד השני.
                    */}
                    <label className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                      <span>חלוקת עמלה בהצעה</span>
                      <select
                        value={offerSplit[demand.id] ?? demand.commissionSplit}
                        onChange={(e) =>
                          setOfferSplit((prev) => ({
                            ...prev,
                            [demand.id]: Number(e.target.value),
                          }))
                        }
                        className="rounded-lg border px-2 py-1.5"
                        style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                      >
                        {COMMISSION_SPLIT_OPTIONS.map((share) => (
                          <option key={share} value={share}>
                            {describeCommissionSplit(share)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {/* המערכת מחשבת אילו מהנכסים שלי מתאימים — במקום
                        לבחור מרשימה של עשרות ולבזבז קרדיט על ניחוש */}
                    {demand.myMatches && demand.myMatches.length > 0 ? (
                      <div className="mb-3">
                        <p className="mb-2 font-medium" style={{ color: "var(--color-success)" }}>
                          ✓ {demand.myMatches.length} מהנכסים שלכם מתאימים
                        </p>
                        <ul className="flex flex-col gap-2">
                          {demand.myMatches.map((match) => (
                            <li
                              key={match.propertyId}
                              className="rounded-lg border p-3"
                              style={{ borderColor: "var(--color-border)" }}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">
                                  {match.score}% · {match.title}
                                </span>
                                <Button
                                  variant="secondary"
                                  onClick={() => void sendOfferFor(demand.id, match.propertyId)}
                                >
                                  {demand.creditsCost > 0
                                    ? `הצע נכס זה (${demand.creditsCost} קרדיטים)`
                                    : "הצע נכס זה"}
                                </Button>
                              </div>
                              <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                                {match.explanation}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        אין לכם כרגע נכס פעיל שמתאים לביקוש הזה.
                      </p>
                    )}

                    <details>
                      <summary className="cursor-pointer text-sm" style={{ color: "var(--color-text-muted)" }}>
                        להציע נכס אחר
                      </summary>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
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
                          {demand.creditsCost > 0
                            ? `הצע נכס (${demand.creditsCost} קרדיטים)`
                            : "הצע נכס"}
                        </Button>
                      </div>
                    </details>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
