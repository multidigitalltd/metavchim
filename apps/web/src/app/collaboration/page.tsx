"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  COMMISSION_SPLIT_OPTIONS,
  DEFAULT_COMMISSION_SPLIT,
  demandChips,
  describeCommissionSplit,
  describeReferralRating,
  presentationChips,
  referralReasonLabel,
  shekels,
  type PayoutMode,
} from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { LEAD_INTENT_LABELS, LEAD_SOURCE_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoadError } from "../load-error";
import { IconDiamond } from "../icons";
import {
  CollaborationGuide,
  CommissionPanel,
  ReferralRulesPanel,
} from "./guide";
import { PrivacyBanner } from "./privacy-banner";
import { NetChips } from "./net-chips";
import { ReferralRating, type ReferralRatingValue } from "./referral-rating";
import { BuyCredits } from "./buy-credits";
import { PayoutPanel } from "./payout-panel";

/**
 * רשת שיתופי הפעולה (אפיון §11-12).
 *
 * שלוש לשוניות ולא מסך אחד: שיתוף פעולה על ביקושים (חינם) והפניות
 * לקוחות (בקרדיטים) הם שני מנגנונים שונים לגמרי, וההצגה שלהם יחד
 * היא מה שגרם למתווכים לחשוב ששת"פ עולה כסף.
 */
const COOP_TABS: [key: string, label: string, icon: string][] = [
  ["demands", "ביקושים ברשת", "🔎"],
  ["incoming", "הצעות שקיבלתי", "📬"],
  ["market", "הפניות לקוחות", "🤝"],
];

/**
 * סנכרון הלשונית מהכתובת.
 *
 * רכיב נפרד ובתוך `Suspense` — `useSearchParams` מחייב זאת בדף
 * שעובר prerender. קריאה חד-פעמית מ-`window.location` לא הספיקה:
 * משתמש שכבר נמצא במסך ולוחץ על ההתראה מקבל ניווט צד-לקוח, הרכיב
 * נשמר, האפקט אינו רץ שוב — והוא נשאר בלשונית הקודמת. כלומר בדיוק
 * התקלה שהשינוי הזה בא לתקן.
 */
function TabFromQuery({ onTab }: { onTab: (tab: string) => void }) {
  const params = useSearchParams();
  const requested = params.get("tab");
  useEffect(() => {
    if (requested !== null && COOP_TABS.some(([key]) => key === requested))
      onTab(requested);
  }, [requested, onTab]);
  return null;
}

/**
 * טווח החדרים בכותרת הביקוש. הגרסה הקודמת הדפיסה `?–?` כשלא הוזן
 * טווח — סימן שאלה גולמי שנקרא כתקלה, בעוד המשמעות היא שהקונה פשוט
 * לא הגביל את עצמו. ביקוש בלי הגבלת חדרים מתאים ליותר נכסים, לא
 * לפחות, ולכן הניסוח צריך להזמין הצעה ולא להרתיע.
 */
function roomsLabel(min?: number, max?: number): string {
  if (min === undefined && max === undefined) return "נכס";
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min} חדרים` : `${min}–${max} חדרים`;
  }
  return min !== undefined ? `${min} חדרים ומעלה` : `עד ${String(max)} חדרים`;
}

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
  /* הפרופיל המלא של הביקוש — כל מה שאינו מזהה אדם */
  propertyTypes: string[];
  areaSqmMin?: number;
  budgetMinAgorot?: number;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  entryType?: string;
  entryBy?: string;
  financing?: string;
  maturity?: string;
  mustFeatures: string[];
  niceFeatures: string[];
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
  /** אחוז העמלה שהמשרד המציע לוקח — מוצג לפני ההסכמה */
  commissionSplit: number;
  buyerId?: string;
  buyerName?: string;
  /*
   * הצילום המדורג של הנכס. הורחב לכל מה שאינו מזהה — אישור חיבור
   * הוא צעד שקשה לחזור ממנו, ולכן קומה, שטח, מצב ומועד כניסה צריכים
   * להיות ידועים לפניו ולא אחריו.
   */
  presentation: {
    city?: string;
    neighborhood?: string;
    propertyType?: string;
    dealType?: string;
    rooms?: number;
    areaSqm?: number;
    floor?: number;
    totalFloors?: number;
    condition?: string;
    priceAgorot?: number;
    entryType?: string;
    entryDate?: string;
    features?: string[];
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
  payoutMode?: PayoutMode;
  payoutCredits: number;
  payoutAgorot?: number;
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

/**
 * תפוגת הקרדיטים כפי שהשרת מדווח אותה.
 *
 * `months: 0` = התפוגה כבויה בפלטפורמה. `nextAt` חסר גם כשהתפוגה
 * פעילה אבל אין מנה חיה שפגה — למשל משרד שכל יתרתו נרכשה בכסף.
 */
interface CreditExpiry {
  months: number;
  nextAmount?: number;
  nextAt?: string;
}

/**
 * מה המשרד המפנה מקבל, בניסוח של המסלול שנבחר.
 *
 * שורות שפורסמו לפני מסלול הכסף אינן נושאות `payoutMode` — הן
 * קרדיטים, וזה מה שהיו אז.
 */
function referralPayoutLabel(lead: {
  payoutMode?: PayoutMode;
  payoutCredits: number;
  payoutAgorot?: number;
}): string {
  if (lead.payoutMode === "cash") return `${shekels(lead.payoutAgorot ?? 0)} ₪`;
  return `${lead.payoutCredits} קרדיטים`;
}

export default function CollaborationPage() {
  const { loading: authLoading } = useRequireAuth();
  /*
   * ההתראה על הצעה חדשה הובילה ל-/collaboration והמסך נפתח תמיד על
   * "ביקושים ברשת" — כלומר על לשונית שאינה זו שההתראה דיברה עליה,
   * וההצעה נראתה כאילו איננה. הכתובת קובעת.
   */
  const [coopTab, setCoopTab] = useState<string>("demands");
  const [demands, setDemands] = useState<DemandRow[] | null>(null);
  const [sharedLeads, setSharedLeads] = useState<SharedLeadRow[]>([]);
  const [buyingLead, setBuyingLead] = useState<string | null>(null);
  const [boughtLeadId, setBoughtLeadId] = useState<string | null>(null);
  const [coopOffers, setCoopOffers] = useState<CoopOfferRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  /** תמחור הקרדיטים כפי שהוגדר בפלטפורמה — לרכישה מכאן. */
  const [pricing, setPricing] = useState<{
    unitPriceAgorot: number;
    packages: { credits: number; priceAgorot: number }[];
  } | null>(null);
  /** מה עומד לפוג מהיתרה ומתי. חסר = אין תפוגה, או שאין מנה שפגה. */
  const [expiry, setExpiry] = useState<CreditExpiry | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<
    Record<string, string>
  >({});
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
    apiGet<{
      balance: number;
      unitPriceAgorot: number;
      packages: { credits: number; priceAgorot: number }[];
      expiry?: CreditExpiry;
    }>("/collaboration/credits")
      .then((r) => {
        setBalance(r.balance);
        setPricing({
          unitPriceAgorot: r.unitPriceAgorot,
          packages: r.packages,
        });
        setExpiry(r.expiry ?? null);
      })
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
      const { leadId } = await apiPost<{ leadId: string }>(
        `/collaboration/leads/${id}/buy`,
        {},
      );
      setMessage(
        "✓ ההפניה נקלטה — פרטי הקשר המלאים מחכים לכם בכרטיס הליד.",
        leadId,
      );
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
  const openReferrals = sharedLeads.filter(
    (l) => l.role === "viewer" && l.status === "active",
  );
  const myReferrals = sharedLeads.filter((l) => l.role === "referrer");
  /* מה שקלטתי — כאן הוא מדורג, וכאן רואים מה הצד השני אמר */
  const receivedReferrals = sharedLeads.filter((l) => l.role === "receiver");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-2xl font-bold">🤝 שיתופי פעולה</h1>
        {/* הפרסום עצמו נעשה מכרטיס הקונה — הביקוש נגזר מדרישות
            אמיתיות ולא מטופס ריק. אבל מי שנוחת כאן צריך לדעת שזה
            קיים ואיפה, אחרת המסך נראה כמו רשימה לצפייה בלבד. */}
        <Link
          href="/buyers"
          className="mv-btn-action"
          style={{ textDecoration: "none" }}
        >
          + פרסם ביקוש
        </Link>
      </div>

      {/*
        החיסיון הוא השורה הראשונה של האזור, ולא פאנל מתקפל בתוך
        לשונית אחת. "הם ייקחו לי את הלקוח" הוא החשש שעוצר מתווכים
        מלשתף, והתשובה לו הייתה מוסתרת מאחורי לחיצה — כלומר מי שהיסס
        פשוט לא לחץ. הבאנר יושב מעל הלשוניות כי הכלל חל על שלושתן.
      */}
      <PrivacyBanner />

      <CollaborationGuide />

      {/*
        שלוש לשוניות ולא מסך אחד ארוך.
        שני מנגנונים שונים חיו כאן יחד — שת"פ חינם והפניות לקוחות
        בתמורה — ומי שנחת על המסך לא ידע מה שייך למה. ההפרדה היא
        גם הפתרון לבלבול בקרדיטים: הם מופיעים בלשונית אחת בלבד.
      */}
      <Suspense fallback={null}>
        <TabFromQuery onTab={setCoopTab} />
      </Suspense>

      <div className="mv-seg mb-[18px]" role="tablist" aria-label="אזורי הרשת">
        {COOP_TABS.map(([key, label, icon]) => (
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
            <span aria-hidden="true">{icon}</span> {label}
            {key === "incoming" && incoming.length > 0 ? (
              <span
                className="mv-chip ms-1.5"
                style={{ padding: "1px 7px", fontSize: 11.5 }}
              >
                {incoming.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {message ? (
        <p
          role="status"
          className="mb-4 rounded-lg border p-3"
          style={{ borderColor: "var(--color-primary)" }}
        >
          {message}
          {boughtLeadId ? (
            <>
              {" "}
              <Link
                href={`/leads/${boughtLeadId}`}
                className="font-medium underline"
              >
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
            📬 הצעות שהתקבלו על הביקושים שלך ({incoming.length})
          </h2>
          {offersFailed ? (
            <LoadError
              message="לא הצלחנו לטעון את ההצעות שהתקבלו"
              onRetry={load}
            />
          ) : null}
          <ul className="flex list-none flex-col gap-3 p-0">
            {incoming.map((offer) => (
              <li key={offer.id} className="mv-net-card">
                <div className="mv-net-head">
                  <span className="mv-net-avatar" aria-hidden="true">
                    🏡
                  </span>
                  <h3 className="mv-net-title">
                    {offer.presentation.title ?? "נכס שהוצע לכם"}
                  </h3>
                  {/*
                    לאיזה קונה ההצעה — לא פרט שולי. משרד ששיתף חמישה
                    ביקושים קיבל חמש הצעות שנראו זהות, ולא ידע לאיזה
                    לקוח להתקשר.
                  */}
                  {offer.buyerId !== undefined ? (
                    <Link
                      href={`/buyers/${offer.buyerId}`}
                      className="mv-net-chip mv-net-chip--primary"
                      style={{ textDecoration: "none" }}
                    >
                      <span aria-hidden="true">👤</span> עבור {offer.buyerName}
                    </Link>
                  ) : null}
                </div>

                {/* כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
                <NetChips chips={presentationChips(offer.presentation)} />

                <div className="mv-net-foot">
                  {/* חלוקת העמלה לפני ההסכמה ולא אחריה */}
                  <span className="mv-net-chip mv-net-chip--money">
                    <span aria-hidden="true">🪙</span> העמלה שלי{" "}
                    {100 - offer.commissionSplit}% · למציע{" "}
                    {offer.commissionSplit}%
                  </span>
                  <span className="mv-net-chip" title="חשיפה מדורגת">
                    <span aria-hidden="true">🔒</span> כתובת מדויקת ושם הסוכנות
                    — רק אחרי אישור
                  </span>
                  {offer.status === "sent" ? (
                    <span className="flex gap-2">
                      <Button
                        onClick={() => void respond(offer.id, "interested")}
                      >
                        ✓ מעניין — פתח חיבור
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void respond(offer.id, "declined")}
                      >
                        לא מתאים
                      </Button>
                    </span>
                  ) : (
                    <span
                      className="font-medium"
                      style={{ color: "var(--color-success)" }}
                    >
                      {offer.status === "interested"
                        ? "✅ אושר — הסוכנויות מחוברות"
                        : "✕ נדחה"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {incoming.length === 0 && !offersFailed ? (
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon" aria-hidden="true">
                📭
              </span>
              <p className="m-0 font-semibold">עדיין לא התקבלו הצעות</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                פרסמו ביקוש מכרטיס קונה — ומשרדים עם נכס מתאים יציעו אותו כאן.
              </p>
            </div>
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
            🤝 הפניות לקוחות
          </h2>
          <p
            className="mb-3 text-[14.5px]"
            style={{ color: "var(--color-text-soft)" }}
          >
            לקוחות שמשרדים אחרים לא יכולים לשרת. שם וטלפון נחשפים רק אחרי
            הקליטה, ו<b>התשלום הוא על ההפניה — לא על סגירת עסקה</b>.
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
            style={{
              borderColor: "var(--color-border)",
              background: "var(--color-surface)",
            }}
          >
            <span style={{ color: "var(--color-primary)" }}>
              <IconDiamond s={16} />
            </span>
            <b className="text-[13.5px]">
              היתרה שלכם: {balance === null ? "…" : `${balance} קרדיטים`}
            </b>
            <span
              className="text-[12.5px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              · קרדיטים יורדים על הפניית לקוח ועל הצעה לביקוש שמסומן במקור
              חיצוני בלבד. שיתוף פעולה עם משרד תיווך אינו עולה קרדיטים.
            </span>
          </div>
          {/*
            התפוגה נאמרת ליד היתרה ולא במסך הגדרות. "היו לי 40 ועכשיו
            25" הוא בדיוק סוג ההפתעה שמייצרת פנייה לתמיכה, והמקום
            היחיד שבו היא נמנעת הוא המקום שבו מסתכלים על המספר.
          */}
          {expiry !== null && expiry.nextAt !== undefined ? (
            <p
              className="m-0 mt-1.5 text-[12.5px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {expiry.nextAmount} מהם פגים ב-
              {new Date(expiry.nextAt).toLocaleDateString("he-IL")}. קרדיטים
              שנרכשו בכסף אינם פגים.
            </p>
          ) : null}
          {/*
            הרכישה יושבת מתחת ליתרה ולא במסך אחר: הרגע שבו מגלים שאין
            מספיק הוא הרגע שבו רוצים לקנות.
          */}
          {pricing !== null ? (
            <BuyCredits
              unitPriceAgorot={pricing.unitPriceAgorot}
              packages={pricing.packages}
            />
          ) : null}
          {/*
            היתרה הכספית לצד יתרת הקרדיטים, ולא במסך אחר: אלה שתי
            תוצאות של אותה פעולה — הפניה שנמכרה — ומי שמחפש את
            הכסף שלו מחפש אותו כאן.
          */}
          <PayoutPanel />
          {leadsFailed ? (
            <LoadError
              message="לא הצלחנו לטעון את לוח ההפניות"
              onRetry={load}
            />
          ) : null}

          {/*
            שלוש קבוצות ולא רשימה אחת: מה שאני מפנה, מה שקלטתי (ושם
            אני מדרג), ומה שפתוח לקליטה. בלי ההפרדה, ההפניה שקלטתי
            נראית כמו עוד שורה בלוח — ואף אחד לא מדרג שורה בלוח.
          */}
          {myReferrals.length > 0 ? (
            <>
              <h3 className="mb-2 mt-4 text-[15px] font-semibold">
                📤 ההפניות שפרסמתי
              </h3>
              <ul className="mb-5 flex list-none flex-col gap-3 p-0">
                {myReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card mv-net-card--mine">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar" aria-hidden="true">
                        📤
                      </span>
                      <h4 className="mv-net-title">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </h4>
                      <span className="mv-net-chip">
                        <span aria-hidden="true">⭐</span> ההפניה שלך
                      </span>
                      {lead.status === "sold" ? (
                        <span
                          className="font-medium"
                          style={{ color: "var(--color-success)" }}
                        >
                          {/*
                            הניסוח לפי המסלול שנבחר. "0 קרדיטים נוספו
                            ליתרה" על הפניה שנמכרה בכסף הוא בדיוק
                            ההפך ממה שקרה.
                          */}
                          ✓ נקלטה — {referralPayoutLabel(lead)} נוספו ליתרה
                        </span>
                      ) : lead.status === "withdrawn" ? (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          הוסרה מהלוח
                        </span>
                      ) : (
                        <>
                          <span className="mv-net-chip mv-net-chip--money">
                            <span aria-hidden="true">🪙</span>{" "}
                            {lead.priceCredits} קרדיטים · אליכם{" "}
                            {referralPayoutLabel(lead)}
                          </span>
                          <Button
                            variant="ghost"
                            onClick={() => void withdrawLead(lead.id)}
                          >
                            הסר מהלוח
                          </Button>
                        </>
                      )}
                    </div>
                    <p
                      className="mb-0 mt-1 text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
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
              <h3 className="mb-2 text-[15px] font-semibold">
                📥 הפניות שקלטתי
              </h3>
              <ul className="mb-5 flex list-none flex-col gap-3 p-0">
                {receivedReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar" aria-hidden="true">
                        📥
                      </span>
                      <h4 className="mv-net-title">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </h4>
                      <span className="mv-net-chip mv-net-chip--money">
                        <span aria-hidden="true">🪙</span> שילמתם{" "}
                        {lead.priceCredits} קרדיטים
                      </span>
                    </div>
                    <p
                      className="mb-0 mt-1 text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
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
            <h3 className="mb-2 text-[15px] font-semibold">
              🌐 הפניות פתוחות ברשת
            </h3>
          ) : null}
          <ul className="flex list-none flex-col gap-3 p-0">
            {openReferrals.map((lead) => (
              <li key={lead.id} className="mv-net-card">
                <div className="mv-net-head">
                  <span className="mv-net-avatar" aria-hidden="true">
                    🧑
                  </span>
                  <h4 className="mv-net-title">
                    {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </h4>
                  <span className="mv-net-chip">
                    <span aria-hidden="true">📡</span>{" "}
                    {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                  </span>
                  <span className="mv-net-chip mv-net-chip--money">
                    <span aria-hidden="true">🪙</span> {lead.priceCredits}{" "}
                    קרדיטים
                  </span>
                  {/*
                    המוניטין של המשרד המפנה, ליד המחיר ולא בעמוד אחר:
                    התמורה נגבית גם אם לא ייסגר דבר, וזה המידע שקובע
                    אם כדאי לשלם אותה.
                  */}
                  <span
                    className="mv-net-chip"
                    title="ממוצע הדירוגים שנתנו משרדים שקלטו הפניות מהמשרד הזה"
                  >
                    <span aria-hidden="true">⭐</span>{" "}
                    {describeReferralRating(
                      lead.referrerRating?.average ?? null,
                      lead.referrerRating?.count ?? 0,
                    )}
                  </span>
                </div>
                <p
                  className="mb-2 text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  סיבת ההפניה: <b>{referralReasonLabel(lead.reason)}</b>
                  {lead.reasonDetail ? ` — ${lead.reasonDetail}` : ""}
                </p>
                {lead.note ? (
                  <p
                    className="mb-2 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {lead.note}
                  </p>
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
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon" aria-hidden="true">
                🤝
              </span>
              <p className="m-0 font-semibold">אין כרגע הפניות פתוחות ברשת</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                זו לשונית נפרדת — ביקוש של משרד תיווך אחר אינו עולה קרדיטים.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {coopTab === "demands" ? (
        <section
          id="coop-panel-demands"
          role="tabpanel"
          aria-labelledby="coop-tab-demands"
        >
          <h2 id="demands-heading" className="mb-1 text-lg font-semibold">
            🔎 ביקושים ברשת
          </h2>
          {/*
          שורה אחת במקום פסקה. הכלל המלא (ומה שקורה עם מקור חיצוני)
          חי בפאנל העמלות ובכרטיס הפתיחה — כאן צריך רק את מה שמשנה
          את ההחלטה בשנייה הראשונה.
        */}
          <p
            className="mb-3.5 text-[14.5px]"
            style={{ color: "var(--color-text-soft)" }}
          >
            קונים של משרדים אחרים — <b>בלי שם ובלי טלפון</b>. יש לכם נכס מתאים?
            ההצעה חינם, והעמלה מתחלקת רק אם העסקה תיסגר.
          </p>

          <CommissionPanel />

          {loadFailed ? (
            <LoadError
              message="לא הצלחנו לטעון את הביקושים ברשת"
              onRetry={load}
            />
          ) : demands === null ? (
            <p aria-live="polite">⏳ טוען…</p>
          ) : demands.length === 0 ? (
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon" aria-hidden="true">
                🔍
              </span>
              <p className="m-0 font-semibold">אין כרגע ביקושים פעילים ברשת</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                שתפו קונה מכרטיס הקונה — וסוכנויות אחרות יוכלו להציע לו נכסים.
              </p>
            </div>
          ) : (
            <ul className="flex list-none flex-col gap-3.5 p-0">
              {demands.map((demand) => (
                <li
                  key={demand.id}
                  className={`mv-net-card${demand.mine ? " mv-net-card--mine" : ""}`}
                >
                  <div className="mv-net-head">
                    <span className="mv-net-avatar" aria-hidden="true">
                      👤
                    </span>
                    {/*
                    הכותרת אומרת מה מחפשים ואיפה — כל השאר עבר
                    לתגיות. קודם היא נשאה גם חדרים, גם ערים וגם תקציב
                    בתוך משפט אחד, ובמובייל היא נשברה לשלוש שורות.
                  */}
                    <h3 className="mv-net-title">
                      קונה מחפש {roomsLabel(demand.roomsMin, demand.roomsMax)} ב
                      {demand.cities.join(" / ")}
                    </h3>
                    {demand.mine ? (
                      <span className="mv-net-chip">
                        <span aria-hidden="true">⭐</span> הביקוש שלך
                      </span>
                    ) : (
                      <>
                        {/*
                        העלות ליד כל ביקוש ולא רק בכותרת: הכותרת
                        מסבירה את הכלל, והתווית הזו אומרת מה קורה
                        בלחיצה הזו.
                      */}
                        <span
                          className={`mv-net-chip ${demand.creditsCost > 0 ? "mv-net-chip--money" : "mv-net-chip--good"}`}
                        >
                          <span aria-hidden="true">
                            {demand.creditsCost > 0 ? "🪙" : "🎁"}
                          </span>{" "}
                          {demand.creditsCost > 0
                            ? `${demand.creditsCost} קרדיטים`
                            : "חינם"}
                        </span>
                        <span
                          className="mv-net-chip"
                          title="חלוקת העמלה שהמשרד המשתף ביקש"
                        >
                          <span aria-hidden="true">🤝</span>{" "}
                          {describeCommissionSplit(demand.commissionSplit)}
                        </span>
                      </>
                    )}
                    {demand.source === "kanko" ? (
                      <span
                        className="mv-net-chip"
                        title="ביקוש שהגיע ממקור חיצוני בתשלום"
                      >
                        <span aria-hidden="true">🌐</span> Kanko
                      </span>
                    ) : null}
                  </div>

                  {/*
                  כל מה שידוע על הביקוש, למעט מה שמזהה אדם. הרשימה
                  נבנית ב-`packages/shared/logic/network-card.ts` —
                  מקום אחד שאפשר לבדוק, ולא JSX שמתפצל בין מסכים.
                */}
                  <NetChips chips={demandChips(demand)} />

                  {demand.notes ? (
                    <p className="mv-net-quote">„{demand.notes}”</p>
                  ) : null}

                  {!demand.mine ? (
                    <>
                      {/* המערכת מחשבת אילו מהנכסים שלי מתאימים — במקום
                        לבחור מרשימה של עשרות ולבזבז קרדיט על ניחוש */}
                      {demand.myMatches && demand.myMatches.length > 0 ? (
                        <div className="mb-3">
                          <p
                            className="m-0 mb-2 text-[14.5px] font-bold"
                            style={{ color: "var(--color-primary)" }}
                          >
                            🎯 {demand.myMatches.length} מהנכסים שלכם מתאימים
                          </p>
                          <ul className="flex list-none flex-col gap-2 p-0">
                            {demand.myMatches.map((match) => (
                              <li
                                key={match.propertyId}
                                className="mv-net-match"
                              >
                                <span
                                  className="mv-net-score"
                                  aria-hidden="true"
                                >
                                  {match.score}%
                                </span>
                                <span className="flex-1 min-w-[160px]">
                                  <b className="block">{match.title}</b>
                                  <span
                                    className="text-[13px]"
                                    style={{ color: "var(--color-text-soft)" }}
                                  >
                                    {match.explanation}
                                  </span>
                                </span>
                                <Button
                                  variant="secondary"
                                  onClick={() =>
                                    void sendOfferFor(
                                      demand.id,
                                      match.propertyId,
                                    )
                                  }
                                >
                                  {demand.creditsCost > 0
                                    ? `הצע נכס זה (${demand.creditsCost} קרדיטים)`
                                    : "הצע נכס זה"}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p
                          className="mb-3 text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          📭 אין לכם כרגע נכס פעיל שמתאים לביקוש הזה.
                        </p>
                      )}

                      <details className="mv-net-foot">
                        <summary
                          className="cursor-pointer text-sm font-medium"
                          style={{ color: "var(--color-primary)" }}
                        >
                          ➕ להציע נכס אחר / לשנות חלוקת עמלה
                        </summary>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {/*
                          החלוקה נבחרת לפני השליחה. ברירת המחדל היא מה
                          שהמשרד המשתף ביקש — הצעה שמשנה אותה בשקט
                          הייתה הפתעה לצד השני.
                        */}
                          <label
                            className="flex items-center gap-2 text-sm"
                            htmlFor={`split_${demand.id}`}
                          >
                            חלוקת עמלה
                          </label>
                          <select
                            id={`split_${demand.id}`}
                            value={
                              offerSplit[demand.id] ?? demand.commissionSplit
                            }
                            onChange={(e) =>
                              setOfferSplit((prev) => ({
                                ...prev,
                                [demand.id]: Number(e.target.value),
                              }))
                            }
                            className="mv-control"
                          >
                            {COMMISSION_SPLIT_OPTIONS.map((share) => (
                              <option key={share} value={share}>
                                {describeCommissionSplit(share)}
                              </option>
                            ))}
                          </select>
                          <label
                            htmlFor={`prop_${demand.id}`}
                            className="mv-visually-hidden"
                          >
                            בחר נכס להצעה
                          </label>
                          <select
                            id={`prop_${demand.id}`}
                            value={selectedProperty[demand.id] ?? ""}
                            onChange={(event) =>
                              setSelectedProperty((prev) => ({
                                ...prev,
                                [demand.id]: event.target.value,
                              }))
                            }
                            className="mv-control"
                          >
                            <option value="">בחר נכס להצעה…</option>
                            {properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.marketingTitle ??
                                  [p.street, p.city].filter(Boolean).join(", ")}
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
