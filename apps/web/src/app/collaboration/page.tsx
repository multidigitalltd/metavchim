"use client";

import { useCallback, useEffect, useState } from "react";
import {
  COMMISSION_SPLIT_OPTIONS,
  DEFAULT_COMMISSION_SPLIT,
  describeCommissionSplit,
  referralReasonLabel,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import Link from "next/link";
import { LoadError } from "../load-error";
import { IconDiamond, IconHandshake, IconStar } from "../icons";
import { CollaborationGuide, CommissionPanel, PrivacyPanel, ReferralRulesPanel } from "./guide";
import { ReferralRating, type ReferralRatingValue } from "./referral-rating";

/**
 * רשת שיתופי הפעולה (אפיון §11-12).
 *
 * שלוש לשוניות ולא מסך אחד: שיתוף פעולה על ביקושים (חינם) והפניות
 * לקוחות (בקרדיטים) הם שני מנגנונים שונים לגמרי, וההצגה שלהם יחד
 * היא מה שגרם למתווכים לחשוב ששת"פ עולה כסף.
 */
const COOP_TABS: [key: string, label: string][] = [
  ["demands", "ביקושים ברשת"],
  ["incoming", "הצעות שקיבלתי"],
  ["market", "הפניות לקוחות"],
];


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
  reason: string;
  reasonDetail?: string;
  priceCredits: number;
  platformFeeCredits: number;
  payoutCredits: number;
  status: string;
  mine: boolean;
  /** התפקיד שלי מול ההפניה — קובע מה מוצג ומה אפשר לעשות */
  role: "referrer" | "receiver" | "viewer";
  originLeadId?: string;
  /** המוניטין של המשרד המפנה — הדבר החשוב ביותר לפני תשלום */
  referrerRating?: { average: number; count: number };
  myRating?: ReferralRatingValue;
  counterpartRating?: ReferralRatingValue;
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
  const [coopTab, setCoopTab] = useState<string>("demands");
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
  /*
   * כישלון טעינה נשמר בנפרד לכל רשימה, ולא מכווץ ל-[].
   * מצב ריק אומר למתווך "אין כאן כלום, אין מה לעשות" — והוא עוזב.
   * תקלת רשת אינה מסקנה עסקית, ולכן היא מוצגת ככשל עם ניסיון חוזר.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [offersFailed, setOffersFailed] = useState(false);
  const [leadsFailed, setLeadsFailed] = useState(false);

  /** כל הודעה חדשה מוחקת את קישור "פתח את הליד" של הקנייה הקודמת. */
  function setMessage(text: string | null, leadId: string | null = null) {
    setMessageState(text);
    setBoughtLeadId(leadId);
  }

  const load = useCallback(() => {
    setLoadFailed(false);
    setOffersFailed(false);
    setLeadsFailed(false);
    /*
     * כישלון בטעינת הביקושים אינו "אין ביקושים ברשת".
     * קודם הוא הפך ל-[] והמסך הציג את מצב הריק — כלומר תקלת רשת
     * נראתה כמו מסקנה עסקית ("אין מה לעשות כאן"), והמתווך היה עוזב.
     */
    apiGet<DemandRow[]>("/collaboration/demands")
      .then(setDemands)
      .catch(() => setLoadFailed(true));
    apiGet<CoopOfferRow[]>("/collaboration/offers")
      .then(setCoopOffers)
      .catch(() => setOffersFailed(true));
    apiGet<SharedLeadRow[]>("/collaboration/leads")
      .then(setSharedLeads)
      .catch(() => setLeadsFailed(true));
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
     * אישור מפורש לפני חיוב, ובו **שתי** העובדות שאי אפשר לגלות
     * אחרי התשלום: שהוא נגבה עכשיו, ושאינו מותנה בסגירת עסקה.
     * קליטה בלחיצה אחת בלי שאלה היא בדיוק איך מבזבזים קרדיטים בטעות.
     */
    if (
      !window.confirm(
        `לקלוט את ההפניה תמורת ${price} קרדיטים?\n\n` +
          "פרטי הקשר ייחשפו מיד. התשלום הוא על ההפניה עצמה — הוא נגבה עכשיו, " +
          "ואינו מוחזר גם אם לא תיסגר עסקה. אחרי הקליטה תוכלו לדרג את ההפניה.",
      )
    ) {
      return;
    }
    setBuyingLead(id);
    try {
      const { leadId } = await apiPost<{ leadId: string }>(`/collaboration/leads/${id}/buy`, {});
      setMessage("✓ ההפניה נקלטה — פרטי הקשר המלאים מחכים לכם בכרטיס הליד.", leadId);
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "קליטת ההפניה נכשלה");
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
  const openReferrals = sharedLeads.filter((l) => l.role === "viewer" && l.status === "active");
  const myReferrals = sharedLeads.filter((l) => l.role === "referrer");
  /* מה שקלטתי — כאן הוא מדורג, וכאן רואים מה הצד השני אמר */
  const receivedReferrals = sharedLeads.filter((l) => l.role === "receiver");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-bold">שיתופי פעולה</h1>
        {/* הפרסום עצמו נעשה מכרטיס הקונה — הביקוש נגזר מדרישות
            אמיתיות ולא מטופס ריק. אבל מי שנוחת כאן צריך לדעת שזה
            קיים ואיפה, אחרת המסך נראה כמו רשימה לצפייה בלבד. */}
        <Link href="/buyers" className="mv-btn-action" style={{ textDecoration: "none" }}>
          + פרסם ביקוש
        </Link>
      </div>

      <CollaborationGuide />

      {/*
        שלוש לשוניות ולא מסך אחד ארוך.
        שני מנגנונים שונים חיו כאן יחד — שת"פ חינם והפניות לקוחות
        בתמורה — ומי שנחת על המסך לא ידע מה שייך למה. ההפרדה היא
        גם הפתרון לבלבול בקרדיטים: הם מופיעים בלשונית אחת בלבד.
      */}
      <div className="mv-seg mb-[18px]" role="tablist" aria-label="אזורי הרשת">
        {COOP_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`coop-tab-${key}`}
            aria-selected={coopTab === key}
            aria-controls={`coop-panel-${key}`}
            aria-pressed={coopTab === key}
            onClick={() => setCoopTab(key)}
          >
            {label}
            {key === "incoming" && incoming.length > 0 ? (
              <span className="mv-chip ms-1.5" style={{ padding: "1px 7px", fontSize: 11.5 }}>
                {incoming.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

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

      {coopTab === "incoming" ? (
        <section
          id="coop-panel-incoming"
          role="tabpanel"
          aria-labelledby="coop-tab-incoming"
          className="mb-8"
        >
          <h2 id="incoming-heading" className="mb-3 text-lg font-semibold">
            <IconHandshake s={16} /> הצעות שהתקבלו על הביקושים שלך ({incoming.length})
          </h2>
          {offersFailed ? (
            <LoadError message="לא הצלחנו לטעון את ההצעות שהתקבלו" onRetry={load} />
          ) : null}
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
          {incoming.length === 0 && !offersFailed ? (
            <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
              עדיין לא התקבלו הצעות. פרסמו ביקוש מכרטיס קונה, ומשרדים שיש להם נכס
              מתאים יציעו אותו כאן.
            </p>
          ) : null}
        </section>
      ) : null}

      {coopTab === "market" ? (
        <section
          id="coop-panel-market"
          role="tabpanel"
          aria-labelledby="coop-tab-market"
          className="mb-8"
        >
          <h2 id="lead-market-heading" className="mb-1 text-lg font-semibold">
            <IconHandshake s={16} /> הפניות לקוחות
          </h2>
          <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
            לקוחות שמשרדים אחרים לא יכולים לשרת ומפנים אליכם — כל אחד עם הסיבה
            שבגללה הוא מופנה ועם התמורה שהמשרד המפנה מבקש. שם וטלפון נחשפים רק
            אחרי הקליטה. <b>התשלום הוא על ההפניה ואינו מותנה בסגירת עסקה</b>, ולכן
            שני הצדדים מדרגים אותה אחר כך. הפניה משלכם מפרסמים מכרטיס הליד עצמו.
          </p>

          {/* ארבעת הכללים יושבים כאן — במקום שבו מחליטים אם לשלם */}
          <ReferralRulesPanel />
          {/*
            היתרה יושבת כאן ולא בראש המסך. כשהיא הופיעה בכותרת הכללית
            היא נראתה כמו "מה נשאר לי לשיתופי פעולה" — וזה בדיוק מה
            שגרם למתווכים לחשוב ששת"פ עולה קרדיטים. הקרדיטים שייכים
            למסך הזה בלבד.
          */}
          <div
            className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border p-3"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <span style={{ color: "var(--color-primary)" }}>
              <IconDiamond s={16} />
            </span>
            <b className="text-[13.5px]">
              היתרה שלכם: {balance === null ? "…" : `${balance} קרדיטים`}
            </b>
            <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
              · קרדיטים יורדים על הפניית לקוח ועל הצעה לביקוש שמסומן במקור חיצוני
              בלבד. שיתוף פעולה עם משרד תיווך אינו עולה קרדיטים.
            </span>
          </div>
          {leadsFailed ? (
            <LoadError message="לא הצלחנו לטעון את לוח ההפניות" onRetry={load} />
          ) : null}

          {/*
            שלוש קבוצות ולא רשימה אחת: מה שאני מפנה, מה שקלטתי (ושם
            אני מדרג), ומה שפתוח לקליטה. בלי ההפרדה, ההפניה שקלטתי
            נראית כמו עוד שורה בלוח — ואף אחד לא מדרג שורה בלוח.
          */}
          {myReferrals.length > 0 ? (
            <>
              <h3 className="mb-2 mt-4 text-[15px] font-semibold">ההפניות שפרסמתי</h3>
              <ul className="mb-5 flex flex-col gap-3">
                {myReferrals.map((lead) => (
                  <li key={lead.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "var(--color-border)" }}>
                        ההפניה שלך
                      </span>
                      {lead.status === "sold" ? (
                        <span className="font-medium" style={{ color: "var(--color-success)" }}>
                          ✓ נקלטה — {lead.payoutCredits} קרדיטים נוספו ליתרה
                        </span>
                      ) : lead.status === "withdrawn" ? (
                        <span style={{ color: "var(--color-text-muted)" }}>הוסרה מהלוח</span>
                      ) : (
                        <>
                          <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "#f7efdd", color: "#7a5c1f" }}>
                            {lead.priceCredits} קרדיטים · אליכם {lead.payoutCredits}
                          </span>
                          <Button variant="ghost" onClick={() => void withdrawLead(lead.id)}>
                            הסר מהלוח
                          </Button>
                        </>
                      )}
                    </div>
                    <p className="mb-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      סיבת ההפניה: {referralReasonLabel(lead.reason)}
                      {lead.reasonDetail ? ` — ${lead.reasonDetail}` : ""}
                      {lead.note ? ` · ${lead.note}` : ""}
                    </p>
                    {lead.status === "sold" ? (
                      <ReferralRating
                        sharedLeadId={lead.id}
                        role="given"
                        mine={lead.myRating}
                        counterpart={lead.counterpartRating}
                        onSaved={() => load()}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {receivedReferrals.length > 0 ? (
            <>
              <h3 className="mb-2 text-[15px] font-semibold">הפניות שקלטתי</h3>
              <ul className="mb-5 flex flex-col gap-3">
                {receivedReferrals.map((lead) => (
                  <li key={lead.id} className="rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-sm" style={{ background: "var(--color-border)" }}>
                        שילמתם {lead.priceCredits} קרדיטים
                      </span>
                    </div>
                    <p className="mb-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                      סיבת ההפניה: {referralReasonLabel(lead.reason)}
                      {lead.reasonDetail ? ` — ${lead.reasonDetail}` : ""}
                    </p>
                    {/* הדירוג כאן הוא מה שבונה את המוניטין שהלוח מציג */}
                    <ReferralRating
                      sharedLeadId={lead.id}
                      role="received"
                      mine={lead.myRating}
                      counterpart={lead.counterpartRating}
                      onSaved={() => load()}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {myReferrals.length > 0 || receivedReferrals.length > 0 ? (
            <h3 className="mb-2 text-[15px] font-semibold">הפניות פתוחות ברשת</h3>
          ) : null}
          <ul className="flex flex-col gap-3">
            {openReferrals.map((lead) => (
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
                  {/*
                    המוניטין של המשרד המפנה, ליד המחיר ולא בעמוד אחר:
                    התמורה נגבית גם אם לא ייסגר דבר, וזה המידע שקובע
                    אם כדאי לשלם אותה.
                  */}
                  <span
                    className="rounded-full border px-2 py-0.5 text-sm"
                    style={{ borderColor: "var(--color-border)" }}
                    title="ממוצע הדירוגים שנתנו משרדים שקלטו הפניות מהמשרד הזה"
                  >
                    <IconStar s={13} />{" "}
                    {lead.referrerRating
                      ? `${lead.referrerRating.average} (${lead.referrerRating.count})`
                      : "משרד שטרם דורג"}
                  </span>
                </div>
                <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                  סיבת ההפניה: <b>{referralReasonLabel(lead.reason)}</b>
                  {lead.reasonDetail ? ` — ${lead.reasonDetail}` : ""}
                </p>
                {lead.note ? (
                  <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>{lead.note}</p>
                ) : null}
                <Button
                  variant="secondary"
                  disabled={buyingLead !== null}
                  onClick={() => void buyLead(lead.id, lead.priceCredits)}
                >
                  {buyingLead === lead.id
                    ? "קולט…"
                    : `קלוט את ההפניה (${lead.priceCredits} קרדיטים)`}
                </Button>
              </li>
            ))}
          </ul>
          {openReferrals.length === 0 &&
          myReferrals.length === 0 &&
          receivedReferrals.length === 0 &&
          !leadsFailed ? (
            <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
              אין כרגע הפניות פתוחות ברשת. שימו לב שזו לשונית נפרדת — ביקוש של
              משרד תיווך אחר אינו עולה קרדיטים.
            </p>
          ) : null}
        </section>
      ) : null}

      {coopTab === "demands" ? (
      <section id="coop-panel-demands" role="tabpanel" aria-labelledby="coop-tab-demands">
        <h2 id="demands-heading" className="mb-1 text-lg font-semibold">
          <IconHandshake s={16} /> ביקושים ברשת
        </h2>
        <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
          קונים של משרדי תיווך אחרים, בלי שם ובלי טלפון. יש לכם נכס שמתאים לאחד
          מהם? הציעו אותו — <b>ההצעה חינם</b>, ואם העסקה תיסגר תתחלקו בעמלה עם
          המשרד השני. היוצא מן הכלל היחיד הוא ביקוש שמסומן „Kanko”: הוא הגיע
          ממקור חיצוני בתשלום, וכל שורה כזו נושאת תווית מחיר משלה.
        </p>

        {/*
          שני ההסברים שנשאלים הכי הרבה יושבים כאן ולא בעמוד עזרה:
          זה המקום שבו מחליטים אם לשתף, וזה הרגע שבו החשש עולה.
        */}
        <PrivacyPanel />
        <CommissionPanel />

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
      ) : null}
    </>
  );
}
