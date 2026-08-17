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
import {
  IconCheck,
  IconDiamond,
  IconDownload,
  IconGift,
  IconGlobe,
  IconHandshake,
  IconHome,
  IconInbox,
  IconLock,
  IconMail,
  IconPlus,
  IconSearch,
  IconSend,
  IconStar,
  IconTag,
  IconTarget,
  IconUpload,
  IconUser,
  IconUsers,
  IconCoins,
  IconX,
} from "../icons";
import {
  CollaborationGuide,
  CommissionPanel,
  ReferralRulesPanel,
} from "./guide";
import { PrivacyBanner } from "./privacy-banner";
import { ReachBanner } from "./reach-banner";
import { NetChips } from "./net-chips";
import { ReferralRating, type ReferralRatingValue } from "./referral-rating";
import { BuyCredits } from "./buy-credits";
import { PayoutPanel } from "./payout-panel";

/**
 * רשת שיתופי הפעולה (אפיון §11-12).
 *
 * לשוניות ולא מסך אחד: שיתוף פעולה על ביקושים ועל נכסים (חינם)
 * והפניות לקוחות (בקרדיטים) הם מנגנונים שונים לגמרי, וההצגה שלהם
 * יחד היא מה שגרם למתווכים לחשוב ששת"פ עולה כסף.
 *
 * ## למה "נכסים ברשת" היא לשונית ולא סינון
 *
 * הרשת הייתה חד-כיוונית: רק ביקושים התפרסמו. משרד יכול היה לומר
 * "יש לי קונה, למי יש נכס" ולא את ההפך, ולכן משרד עם נכס תקוע
 * ומשרד עם קונה מתאים לא נפגשו אלא במקרה. שתי הלשוניות עומדות זו
 * לצד זו כי אלו שתי שאלות שונות: **מה אני מחפש** מול **מה יש לי**.
 */
const COOP_TABS: [
  key: string,
  label: string,
  Icon: (p: { s?: number }) => React.ReactElement,
][] = [
  ["demands", "ביקושים ברשת", IconSearch],
  ["listings", "נכסים ברשת", IconTag],
  ["incoming", "הצעות שקיבלתי", IconMail],
  ["market", "הפניות לקוחות", IconHandshake],
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
  /** הנכס כבר הוצע לביקוש הזה — מסומן במקום כפתור */
  offered?: boolean;
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

/**
 * הצילום של הנכס כפי שהרשת רואה אותו.
 *
 * אין כאן רחוב, מספר בית או בעלים — לא "מוסתרים במסך" אלא לא
 * קיימים בטבלה שהשרת קורא ממנה (`SharedListing`).
 */
interface ListingRow {
  id: string;
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
  features: string[];
  title?: string;
  notes?: string;
  commissionSplit: number;
  status: string;
  mine: boolean;
  originPropertyId?: string;
  /** הקונים שלי שמתאימים לנכס — אותו מנוע ואותו סף כמו בכיוון השני. */
  myMatches?: {
    buyerId: string;
    name: string;
    score: number;
    explanation: string;
  }[];
  /** כבר פניתי על הנכס הזה — אין להציע פעמיים. */
  interestSent?: boolean;
}

/** "יש לי קונה לנכס שלך" — הפנייה שהתקבלה על נכס שפרסמתי. */
interface InterestRow {
  id: string;
  listingId: string;
  propertyId?: string;
  propertyTitle?: string;
  /* צילום הקונה — בלי שם, טלפון או אימייל, בדיוק כמו ביקוש שמתפרסם */
  presentation: {
    dealType: string;
    cities: string[];
    neighborhoods?: string[];
    propertyTypes?: string[];
    budgetMaxAgorot: number;
    roomsMin?: number;
    roomsMax?: number;
    areaSqmMin?: number;
    entryType?: string;
    financing?: string;
    maturity?: string;
    mustFeatures: string[];
    niceFeatures?: string[];
  };
  commissionSplit: number;
  status: string;
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

/** קונה לבחירה ידנית כשההתאמה האוטומטית לא קלעה. */
interface BuyerOption {
  id: string;
  contact: { name: string };
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
  /* הכיוון השני של הרשת: נכסים שמשרדים אחרים פרסמו, ומי פנה על שלי */
  const [listings, setListings] = useState<ListingRow[] | null>(null);
  const [interests, setInterests] = useState<InterestRow[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
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
  /* אותו דפוס בדיוק בכיוון ההפוך: איזה קונה מציעים, ובאיזו חלוקה */
  const [selectedBuyer, setSelectedBuyer] = useState<Record<string, string>>(
    {},
  );
  const [interestSplit, setInterestSplit] = useState<Record<string, number>>(
    {},
  );
  const [message, setMessageState] = useState<string | null>(null);
  /*
   * כישלון טעינה נשמר בנפרד לכל רשימה, ולא מכווץ ל-[].
   * מצב ריק אומר למתווך "אין כאן כלום, אין מה לעשות" — והוא עוזב.
   * תקלת רשת אינה מסקנה עסקית, ולכן היא מוצגת ככשל עם ניסיון חוזר.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [offersFailed, setOffersFailed] = useState(false);
  const [leadsFailed, setLeadsFailed] = useState(false);
  const [listingsFailed, setListingsFailed] = useState(false);

  /** כל הודעה חדשה מוחקת את קישור "פתח את הליד" של הקנייה הקודמת. */
  function setMessage(text: string | null, leadId: string | null = null) {
    setMessageState(text);
    setBoughtLeadId(leadId);
  }

  const load = useCallback(() => {
    setLoadFailed(false);
    setOffersFailed(false);
    setLeadsFailed(false);
    setListingsFailed(false);
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
    apiGet<ListingRow[]>("/collaboration/listings")
      .then(setListings)
      .catch(() => setListingsFailed(true));
    /*
     * הפניות על הנכסים שלי יושבות באותה לשונית של ההצעות על
     * הביקושים שלי — שתיהן "מה הרשת שלחה אליי", וכישלון של אחת
     * מהן מסומן באותו דגל.
     */
    apiGet<InterestRow[]>("/collaboration/interests")
      .then(setInterests)
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
    apiGet<{ items: BuyerOption[] }>("/buyers?limit=50")
      .then((r) => setBuyers(r.items))
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

  /**
   * "יש לי קונה לנכס הזה" — התמונה המשלימה להצעת נכס על ביקוש.
   *
   * הקונה נשלח בלי שם, טלפון או אימייל, בדיוק כמו ביקוש שמתפרסם:
   * הצד השני מחליט על סמך **מה** הקונה מחפש ומה מצב המימון שלו, לא
   * על סמך מי הוא.
   */
  async function sendInterest(listingId: string, buyerId: string) {
    try {
      await apiPost(`/collaboration/listings/${listingId}/interest`, {
        buyerId,
        commissionSplit:
          interestSplit[listingId] ??
          listings?.find((l) => l.id === listingId)?.commissionSplit ??
          DEFAULT_COMMISSION_SPLIT,
      });
      setMessage("✓ הפנייה נשלחה. אם המשרד השני יתעניין — תקבלו התראה.");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "שליחת הפנייה נכשלה");
    }
  }

  async function respondToInterest(
    id: string,
    response: "interested" | "declined",
  ) {
    try {
      await apiPatch(`/collaboration/interests/${id}/respond`, { response });
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
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
  /* פניות שטרם נענו — הן שקובעות את המונה על הלשונית */
  const openInterests = interests.filter((i) => i.status === "sent");
  const openReferrals = sharedLeads.filter(
    (l) => l.role === "viewer" && l.status === "active",
  );
  const myReferrals = sharedLeads.filter((l) => l.role === "referrer");
  /* מה שקלטתי — כאן הוא מדורג, וכאן רואים מה הצד השני אמר */
  const receivedReferrals = sharedLeads.filter((l) => l.role === "receiver");

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 flex items-center gap-2 text-2xl font-bold">
          <IconHandshake s={22} /> שיתופי פעולה
        </h1>
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

      {/*
        ומיד אחריו — מה **שלכם** אינו נמצא שם.

        לראות את הרשת אינו דורש שיתוף; להיראות בה כן. סוכן שפותח את
        הפיד רואה נכסים וביקושים של אחרים, ואינו יודע שהנכס שלו —
        שמתאים לשלושה מהם — אינו מפורסם, ולכן אף אחד מהם לא יפנה
        אליו. הרכיב מציג את עצמו רק כשיש התאמה אמיתית מעל הסף.
      */}
      <ReachBanner />

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
        {COOP_TABS.map(([key, label, Icon]) => (
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
            <Icon s={15} /> {label}
            {/* המונה סופר את שני הכיוונים — הצעות על הביקושים שלי
                ופניות על הנכסים שלי יושבות באותה לשונית */}
            {key === "incoming" &&
            incoming.length + openInterests.length > 0 ? (
              <span
                className="mv-chip ms-1.5"
                style={{ padding: "1px 7px", fontSize: 11.5 }}
              >
                {incoming.length + openInterests.length}
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
          {/*
            כותרת שמכריזה על אפס היא רעש: "הצעות שהתקבלו (0)" מעל
            רשימה ריקה נראית כמו טעינה שנתקעה. הכותרת מופיעה רק
            כשיש מה למנות, ומצב הריק המשותף למטה מטפל בשאר.
          */}
          {incoming.length > 0 ? (
            <h2 id="incoming-heading" className="mb-3 text-lg font-semibold">
              <IconMail s={17} /> הצעות שהתקבלו על הביקושים שלך (
              {incoming.length})
            </h2>
          ) : null}
          {offersFailed ? (
            <LoadError
              message="לא הצלחנו לטעון את ההצעות שהתקבלו"
              onRetry={load}
            />
          ) : null}
          <ul
            className="flex list-none flex-col gap-3 p-0"
            aria-label="הצעות שהתקבלו על הביקושים שלך"
          >
            {incoming.map((offer) => (
              <li key={offer.id} className="mv-net-card">
                <div className="mv-net-head">
                  <span className="mv-net-avatar">
                    <IconHome s={20} />
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
                      <IconUser s={14} /> עבור {offer.buyerName}
                    </Link>
                  ) : null}
                </div>

                {/* כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
                <NetChips chips={presentationChips(offer.presentation)} />

                <div className="mv-net-foot">
                  {/* חלוקת העמלה לפני ההסכמה ולא אחריה */}
                  <span className="mv-net-chip mv-net-chip--money">
                    <IconCoins s={14} /> העמלה שלי {100 - offer.commissionSplit}
                    % · למציע {offer.commissionSplit}%
                  </span>
                  <span className="mv-net-chip" title="חשיפה מדורגת">
                    <IconLock s={14} /> כתובת מדויקת ושם הסוכנות — רק אחרי אישור
                  </span>
                  {offer.status === "sent" ? (
                    <span className="flex gap-2">
                      <Button
                        onClick={() => void respond(offer.id, "interested")}
                      >
                        מעניין — פתח חיבור
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void respond(offer.id, "declined")}
                      >
                        לא מתאים
                      </Button>
                    </span>
                  ) : offer.status === "interested" ? (
                    /* אושר ונדחה אינם אותו דבר בצבע ירוק — הצבע הוא
                       חצי מהמסר, והאייקון הוא החצי שנקרא ראשון */
                    <span
                      className="mv-net-chip mv-net-chip--good"
                      style={{ fontWeight: 700 }}
                    >
                      <IconCheck s={14} /> אושר — הסוכנויות מחוברות
                    </span>
                  ) : (
                    <span className="mv-net-chip">
                      <IconX s={14} /> נדחה
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {/*
            הכיוון השני של אותה לשונית: מי פנה על **הנכסים** שפרסמתי.
            שתי הרשימות יושבות יחד כי שתיהן עונות לאותה שאלה — "מה
            הרשת שלחה אליי, ועל מה אני צריך להשיב".
          */}
          {interests.length > 0 ? (
            <>
              <h2
                id="interests-heading"
                className={`mb-3 text-lg font-semibold${incoming.length > 0 ? " mt-6" : ""}`}
              >
                <IconUser s={17} /> קונים שהוצעו לנכסים שפרסמתם (
                {interests.length})
              </h2>
              <ul
                className="flex list-none flex-col gap-3 p-0"
                aria-labelledby="interests-heading"
              >
                {interests.map((interest) => (
                  <li key={interest.id} className="mv-net-card">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar">
                        <IconUser s={20} />
                      </span>
                      {/*
                        הכותרת אומרת **על איזה נכס** ולא מה הקונה
                        מחפש — זה כבר בשורת התגיות מתחתיה, ואילו
                        הנכס הוא מה שמאפשר לזהות את הפנייה בשנייה.
                      */}
                      <h3 className="mv-net-title">
                        קונה עבור „{interest.propertyTitle ?? "נכס שפרסמתם"}”
                      </h3>
                      {/* לאיזה נכס — משרד שפרסם חמישה נכסים קיבל חמש
                          פניות שנראו זהות, ולא ידע על מה מדובר */}
                      {interest.propertyId !== undefined ? (
                        <Link
                          href={`/properties/${interest.propertyId}`}
                          className="mv-net-chip mv-net-chip--primary"
                          style={{ textDecoration: "none" }}
                        >
                          <IconHome s={14} /> פתח את הנכס
                        </Link>
                      ) : null}
                    </div>

                    {/* כל מה שידוע על הקונה למעט מה שמזהה אותו */}
                    <NetChips chips={demandChips(interest.presentation)} />

                    <div className="mv-net-foot">
                      <span className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> העמלה שלי{" "}
                        {100 - interest.commissionSplit}% · למציע{" "}
                        {interest.commissionSplit}%
                      </span>
                      <span className="mv-net-chip" title="חשיפה מדורגת">
                        <IconLock s={14} /> שם הקונה ופרטי הקשר — רק אחרי אישור
                      </span>
                      {interest.status === "sent" ? (
                        <span className="flex gap-2">
                          <Button
                            onClick={() =>
                              void respondToInterest(interest.id, "interested")
                            }
                          >
                            מעניין — פתח חיבור
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              void respondToInterest(interest.id, "declined")
                            }
                          >
                            לא מתאים
                          </Button>
                        </span>
                      ) : interest.status === "interested" ? (
                        <span
                          className="mv-net-chip mv-net-chip--good"
                          style={{ fontWeight: 700 }}
                        >
                          <IconCheck s={14} /> אושר — הסוכנויות מחוברות
                        </span>
                      ) : (
                        <span className="mv-net-chip">
                          <IconX s={14} /> נדחה
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {incoming.length === 0 && interests.length === 0 && !offersFailed ? (
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon">
                <IconInbox s={30} />
              </span>
              <p className="m-0 font-semibold">עדיין לא התקבלו הצעות</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                פרסמו ביקוש מכרטיס קונה או נכס מכרטיס הנכס — ומשרדים עם צד שני
                מתאים יפנו אליכם כאן.
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
            <IconHandshake s={17} /> הפניות לקוחות
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
                <IconUpload s={15} /> ההפניות שפרסמתי
              </h3>
              <ul className="mb-5 flex list-none flex-col gap-3 p-0">
                {myReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card mv-net-card--mine">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar">
                        <IconUpload s={20} />
                      </span>
                      <h4 className="mv-net-title">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </h4>
                      <span className="mv-net-chip">
                        <IconStar s={14} /> ההפניה שלך
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
                          <IconCheck s={14} /> נקלטה —{" "}
                          {referralPayoutLabel(lead)} נוספו ליתרה
                        </span>
                      ) : lead.status === "withdrawn" ? (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          הוסרה מהלוח
                        </span>
                      ) : (
                        <>
                          <span className="mv-net-chip mv-net-chip--money">
                            <IconCoins s={14} /> {lead.priceCredits} קרדיטים ·
                            אליכם {referralPayoutLabel(lead)}
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
                <IconDownload s={15} /> הפניות שקלטתי
              </h3>
              <ul className="mb-5 flex list-none flex-col gap-3 p-0">
                {receivedReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar">
                        <IconDownload s={20} />
                      </span>
                      <h4 className="mv-net-title">
                        {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </h4>
                      <span className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> שילמתם {lead.priceCredits} קרדיטים
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
              <IconGlobe s={15} /> הפניות פתוחות ברשת
            </h3>
          ) : null}
          <ul className="flex list-none flex-col gap-3 p-0">
            {openReferrals.map((lead) => (
              <li key={lead.id} className="mv-net-card">
                <div className="mv-net-head">
                  <span className="mv-net-avatar">
                    <IconUsers s={20} />
                  </span>
                  <h4 className="mv-net-title">
                    {LEAD_INTENT_LABELS[lead.intent] ?? lead.intent}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </h4>
                  <span className="mv-net-chip">
                    <IconSend s={14} />{" "}
                    {LEAD_SOURCE_LABELS[lead.source] ?? lead.source}
                  </span>
                  <span className="mv-net-chip mv-net-chip--money">
                    <IconCoins s={14} /> {lead.priceCredits} קרדיטים
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
                    <IconStar s={14} />{" "}
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
              <span className="mv-net-empty-icon">
                <IconHandshake s={30} />
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
            <IconSearch s={17} /> ביקושים ברשת
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
            <p aria-live="polite">טוען…</p>
          ) : demands.length === 0 ? (
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon">
                <IconSearch s={30} />
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
                    <span className="mv-net-avatar">
                      <IconUser s={20} />
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
                        <IconStar s={14} /> הביקוש שלך
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
                            {demand.creditsCost > 0 ? (
                              <IconCoins s={14} />
                            ) : (
                              <IconGift s={14} />
                            )}
                          </span>{" "}
                          {demand.creditsCost > 0
                            ? `${demand.creditsCost} קרדיטים`
                            : "חינם"}
                        </span>
                        <span
                          className="mv-net-chip"
                          title="חלוקת העמלה שהמשרד המשתף ביקש"
                        >
                          <IconHandshake s={14} />{" "}
                          {describeCommissionSplit(demand.commissionSplit)}
                        </span>
                      </>
                    )}
                    {demand.source === "kanko" ? (
                      <span
                        className="mv-net-chip"
                        title="ביקוש שהגיע ממקור חיצוני בתשלום"
                      >
                        <IconGlobe s={14} /> Kanko
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
                            <IconTarget s={16} /> {demand.myMatches.length}{" "}
                            מהנכסים שלכם מתאימים
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
                                {/* נכס שכבר הוצע — סימון ולא כפתור. הצעה
                                    שנייה של אותו נכס לאותו ביקוש נדחית
                                    בשרת, ואין טעם להזמין אליה לחיצה */}
                                {match.offered ? (
                                  <span className="mv-chip">כבר הוצע</span>
                                ) : (
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
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p
                          className="mb-3 text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          אין לכם כרגע נכס פעיל שמתאים לביקוש הזה.
                        </p>
                      )}

                      <details className="mv-net-foot">
                        <summary
                          className="cursor-pointer text-sm font-medium"
                          style={{ color: "var(--color-primary)" }}
                        >
                          {/* עטיפת inline-flex ולא אייקון חשוף — summary
                              זקוק ל-list-item בשביל משולש הפתיחה, ולכן
                              הפנימיות הן שהופכות לשורה אחת */}
                          <span className="inline-flex items-center gap-1.5 align-middle">
                            <IconPlus s={14} /> להציע נכס אחר / לשנות חלוקת עמלה
                          </span>
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

      {/*
        הכיוון השני של הרשת.

        עד עכשיו משרד יכול היה לומר "יש לי קונה, למי יש נכס" ולא את
        ההפך — ולכן משרד עם נכס תקוע ומשרד עם קונה מתאים נפגשו רק
        במקרה. הלשונית הזו היא בדיוק אותו מנגנון בהיפוך: פיד של
        נכסים, ההתאמות מהקונים **שלי** מחושבות מראש, ובלחיצה אחת
        נשלחת פנייה בלי לחשוף מי הקונה.
      */}
      {coopTab === "listings" ? (
        <section
          id="coop-panel-listings"
          role="tabpanel"
          aria-labelledby="coop-tab-listings"
        >
          <h2 id="listings-heading" className="mb-1 text-lg font-semibold">
            <IconTag s={17} /> נכסים ברשת
          </h2>
          <p
            className="mb-3.5 text-[14.5px]"
            style={{ color: "var(--color-text-soft)" }}
          >
            נכסים של משרדים אחרים — <b>בלי כתובת מדויקת ובלי בעלים</b>. יש לכם
            קונה מתאים? הפנייה חינם, והעמלה מתחלקת רק אם העסקה תיסגר.
          </p>

          <CommissionPanel />

          {listingsFailed ? (
            <LoadError
              message="לא הצלחנו לטעון את הנכסים ברשת"
              onRetry={load}
            />
          ) : listings === null ? (
            <p aria-live="polite">טוען…</p>
          ) : listings.length === 0 ? (
            <div className="mv-net-empty">
              <span className="mv-net-empty-icon">
                <IconTag s={30} />
              </span>
              <p className="m-0 font-semibold">אין כרגע נכסים מפורסמים ברשת</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                פרסמו נכס מכרטיס הנכס — ומשרדים עם קונה מתאים יפנו אליכם.
              </p>
            </div>
          ) : (
            <ul className="flex list-none flex-col gap-3.5 p-0">
              {listings.map((listing) => (
                <li
                  key={listing.id}
                  className={`mv-net-card${listing.mine ? " mv-net-card--mine" : ""}`}
                >
                  <div className="mv-net-head">
                    <span className="mv-net-avatar">
                      <IconHome s={20} />
                    </span>
                    <h3 className="mv-net-title">
                      {listing.title ??
                        `נכס ב${listing.city ?? "רשת"}${
                          listing.neighborhood
                            ? ` · ${listing.neighborhood}`
                            : ""
                        }`}
                    </h3>
                    {listing.mine ? (
                      <>
                        <span className="mv-net-chip">
                          <IconStar s={14} /> הנכס שלך
                        </span>
                        {/* הקישור לנכס נחשף רק לסוכנות המקור */}
                        {listing.originPropertyId !== undefined ? (
                          <Link
                            href={`/properties/${listing.originPropertyId}`}
                            className="mv-net-chip mv-net-chip--primary"
                            style={{ textDecoration: "none" }}
                          >
                            <IconHome s={14} /> פתח את הכרטיס
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {/* פנייה על נכס אינה עולה קרדיטים — בשום מסלול */}
                        <span className="mv-net-chip mv-net-chip--good">
                          <IconGift s={14} /> חינם
                        </span>
                        <span
                          className="mv-net-chip"
                          title="חלוקת העמלה שהמשרד המפרסם ביקש"
                        >
                          <IconHandshake s={14} />{" "}
                          {describeCommissionSplit(listing.commissionSplit)}
                        </span>
                      </>
                    )}
                  </div>

                  {/*
                    כל מה שידוע על הנכס למעט רחוב, מספר בית ובעלים —
                    אותה רשימה בדיוק שההצעות משתמשות בה, מ-
                    `packages/shared/logic/network-card.ts`.
                  */}
                  <NetChips chips={presentationChips(listing)} />

                  {listing.notes ? (
                    <p className="mv-net-quote">„{listing.notes}”</p>
                  ) : null}

                  {!listing.mine ? (
                    <>
                      {listing.interestSent ? (
                        <p
                          className="mb-3 flex items-center gap-1.5 text-sm font-semibold"
                          style={{ color: "var(--color-primary)" }}
                        >
                          <IconCheck s={15} /> כבר פניתם על הנכס הזה — התשובה
                          תגיע ללשונית „הצעות שקיבלתי”.
                        </p>
                      ) : listing.myMatches && listing.myMatches.length > 0 ? (
                        <div className="mb-3">
                          <p
                            className="m-0 mb-2 text-[14.5px] font-bold"
                            style={{ color: "var(--color-primary)" }}
                          >
                            <IconTarget s={16} /> {listing.myMatches.length}{" "}
                            מהקונים שלכם מתאימים
                          </p>
                          <ul className="flex list-none flex-col gap-2 p-0">
                            {listing.myMatches.map((match) => (
                              <li key={match.buyerId} className="mv-net-match">
                                <span
                                  className="mv-net-score"
                                  aria-hidden="true"
                                >
                                  {match.score}%
                                </span>
                                <span className="flex-1 min-w-[160px]">
                                  <b className="block">{match.name}</b>
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
                                    void sendInterest(listing.id, match.buyerId)
                                  }
                                >
                                  יש לי קונה — פנה
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
                          אין לכם כרגע קונה שמתאים לנכס הזה.
                        </p>
                      )}

                      {!listing.interestSent ? (
                        <details className="mv-net-foot">
                          <summary
                            className="cursor-pointer text-sm font-medium"
                            style={{ color: "var(--color-primary)" }}
                          >
                            <span className="inline-flex items-center gap-1.5 align-middle">
                              <IconPlus s={14} /> להציע קונה אחר / לשנות חלוקת
                              עמלה
                            </span>
                          </summary>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <label
                              className="flex items-center gap-2 text-sm"
                              htmlFor={`isplit_${listing.id}`}
                            >
                              חלוקת עמלה
                            </label>
                            <select
                              id={`isplit_${listing.id}`}
                              value={
                                interestSplit[listing.id] ??
                                listing.commissionSplit
                              }
                              onChange={(e) =>
                                setInterestSplit((prev) => ({
                                  ...prev,
                                  [listing.id]: Number(e.target.value),
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
                              htmlFor={`buyer_${listing.id}`}
                              className="mv-visually-hidden"
                            >
                              בחר קונה לפנייה
                            </label>
                            <select
                              id={`buyer_${listing.id}`}
                              value={selectedBuyer[listing.id] ?? ""}
                              onChange={(event) =>
                                setSelectedBuyer((prev) => ({
                                  ...prev,
                                  [listing.id]: event.target.value,
                                }))
                              }
                              className="mv-control"
                            >
                              <option value="">בחר קונה לפנייה…</option>
                              {buyers.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.contact.name}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="secondary"
                              disabled={!selectedBuyer[listing.id]}
                              onClick={() => {
                                const buyerId = selectedBuyer[listing.id];
                                if (buyerId)
                                  void sendInterest(listing.id, buyerId);
                              }}
                            >
                              שלח פנייה
                            </Button>
                          </div>
                        </details>
                      ) : null}
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
