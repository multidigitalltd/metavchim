"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import {
  COMMISSION_SIDES,
  COMMISSION_SIDE_LABEL,
  DEFAULT_COMMISSION_SPLIT,
  demandChips,
  demandDetailRows,
  describeCommissionSide,
  describeCommissionSplit,
  describeCommissionTerms,
  commissionSplitOptionsWith,
  publisherStatedSplit,
  describeReferralRating,
  presentationChips,
  presentationDetailRows,
  referralReasonLabel,
  shekels,
  type CommissionTerms,
  type PayoutMode,  labelOf } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError, apiList } from "@/lib/api";
import { LEAD_INTENT_LABELS, leadSourceText } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadError } from "../load-error";
import { ActionToast, type ToastState } from "../action-toast";
import { ProposedSplitNote } from "./commission-terms-tabs";
import {
  EMPTY_FILTERS,
  filtersToQuery,
  hasActiveFilters,
  ListFilters,
  type ListFilterValues,
} from "../list-filters";
import { formatDate } from "@/lib/format";
import {
  IconBank,
  IconCheck,
  IconDiamond,
  IconDownload,
  IconEye,
  IconGlobe,
  IconHandshake,
  IconHome,
  IconInbox,
  IconList,
  IconLock,
  IconMail,
  IconMenu,
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
import { CollaborationGuide, ReferralRulesPanel } from "./guide";
import { NetworkHeader, type NetworkSummary } from "./network-header";
import { ReachBanner } from "./reach-banner";
import { DealsList } from "./deals-list";
import { NetChips } from "./net-chips";
import {
  NetFacts,
  NetHero,
  NetMeta,
  NetMoney,
  NetOffice,
  NetDetailsButton,
  NetNoMatch,
  NetPhotos,
  NetPlace,
  NetSay,
  splitNetworkChips,
} from "./net-card-parts";
import {
  ClientScoresView,
  ReferralConfirmation,
  ReferrerAccuracyBreakdown,
  type ReferralConfirmationValue,
} from "./client-rating";
import { BuyCredits } from "./buy-credits";

/**
 * רשת שיתופי הפעולה (אפיון §11-12).
 *
 * לשוניות ולא מסך אחד: שיתוף פעולה על ביקושים ועל נכסים (חינם)
 * והפניות לקוחות (בקרדיטים) הם מנגנונים שונים לגמרי, וההצגה שלהם
 * יחד היא מה שגרם למתווכים לחשוב ששת"פ עולה כסף.
 *
 * ## למה הרשת היא אזור אחד עם שתי תת-לשוניות
 *
 * הרשת הייתה חד-כיוונית: רק ביקושים התפרסמו. משרד יכול היה לומר
 * "יש לי קונה, למי יש נכס" ולא את ההפך, ולכן משרד עם נכס תקוע
 * ומשרד עם קונה מתאים לא נפגשו אלא במקרה.
 *
 * שני הכיוונים הם שתי שאלות שונות — **מה אני מחפש** מול **מה יש
 * לי** — ולכן הם נשארו שתי רשימות נפרדות. אבל כשהם היו שתי לשוניות
 * אחיות בשורה אחת עם "הצעות שקיבלתי" ו"הפניות לקוחות", אי אפשר היה
 * לראות מהמסך שהן שני חצאים של אותה רשת: "ביקושים ברשת" גם לא נקרא
 * כ"קונים". עכשיו יש אזור רשת אחד, ובתוכו הבחירה בין קונים לנכסים.
 */
type CoopTabKey = string;

/** תת-הלשוניות של אזור הרשת — שני הכיוונים של אותה רשת. */
const NETWORK_SUBTABS: [
  key: CoopTabKey,
  label: string,
  Icon: (p: { s?: number }) => React.ReactElement,
][] = [
  ["demands", "קונים ברשת", IconUser],
  ["listings", "נכסים ברשת", IconTag],
  /*
   * ההפניות הן הכיוון השלישי של אותה רשת — לקוח שעובר בין משרדים,
   * כמו נכס וביקוש. כלשונית עליונה נפרדת אף אחד לא מצא אותן
   * (בקשת המשתמש: "בתוך התגית של הרשת… תוסיף הפניות ברשת").
   */
  ["market", "הפניות ברשת", IconUsers],
];

const COOP_TABS: [
  key: CoopTabKey,
  label: string,
  Icon: (p: { s?: number }) => React.ReactElement,
][] = [
  ["network", "הרשת", IconGlobe],
  ["incoming", "הצעות שקיבלתי", IconMail],
  /*
   * הלשונית שסוגרת את הרשת: חיבור שאושר ממשיך כאן ולא בוואטסאפ.
   * היא יושבת אחרי "הצעות שקיבלתי" כי זה הסדר שבו הדברים קורים —
   * מציעים, מאשרים, עובדים.
   */
  ["deals", "עסקאות משותפות", IconHandshake],
];

/**
 * הלשונית הפעילה שייכת לאזור הרשת.
 *
 * ה-state ממשיך להחזיק "demands"/"listings"/"market" ולא "network":
 * הקישורים מההתראות ומהמסכים האחרים מפנים לתת-לשונית מסוימת, וסטייט
 * שמאבד אותה היה שולח כל התראה על נכס לרשימת הקונים.
 */
function isNetworkTab(tab: CoopTabKey): boolean {
  return tab === "demands" || tab === "listings" || tab === "market";
}

/** מפתחות תקפים בכתובת — כולל שתי תת-הלשוניות. */
const COOP_TAB_KEYS: readonly CoopTabKey[] = [
  ...NETWORK_SUBTABS.map(([key]) => key),
  ...COOP_TABS.map(([key]) => key).filter((key) => key !== "network"),
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
    if (requested !== null && COOP_TAB_KEYS.includes(requested))
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


/**
 * שורות חלוקת העמלה לפופאפ „כל הפרטים” — שורה לכל צד.
 *
 * שתי שורות ולא אחת מרוכזת: הפופאפ הוא המקום שבו המשרד השני בודק
 * על מה בדיוק הוא מסכים, וחלוקה שונה בין הצדדים חייבת להיקרא בלי
 * לפרק מחרוזת. הצ'יפ שעל הכרטיס עצמו נשאר מרוכז — שם אין מקום.
 */
function commissionDetailRows(
  terms: CommissionTerms,
): { label: string; value: string }[] {
  return COMMISSION_SIDES.map((side) => ({
    label: COMMISSION_SIDE_LABEL[side],
    value: describeCommissionSide(terms[side]),
  }));
}

/**
 * איפה הקונה מחפש — ערים, ואם אין, האזורים שסומנו על המפה.
 *
 * המודעה חייבת לומר אזור: בלעדיו הצד השני אינו יודע אם יש לו נכס
 * מתאים, וההתאמות שהמערכת מחשבת עליה חסרות משמעות. הפרסום נחסם
 * בשרת כשאין אף אחד מהשניים, כך שהנפילה ל„אזור לא צוין” כאן היא
 * רשת ביטחון למודעות שפורסמו לפני החסימה.
 */
function demandArea(demand: { cities: string[]; searchAreas?: { radiusKm: number; label?: string }[] }): string {
  if (demand.cities.length > 0) return demand.cities.join(" / ");
  const areas = demand.searchAreas ?? [];
  if (areas.length === 0) return "אזור לא צוין";
  return areas
    .map((area) => area.label ?? `רדיוס ${area.radiusKm} ק"מ`)
    .join(" / ");
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
  /** אזורי המפה שהקונה סימן — נקודה, רדיוס ותווית. */
  searchAreas?: { lat: number; lon: number; radiusKm: number; label?: string }[];
  notes?: string;
  dealType: string;
  /* הפרופיל המלא של הביקוש — כל מה שאינו מזהה אדם */
  propertyTypes: string[];
  areaSqmMin?: number;
  budgetMinAgorot?: number;
  /** חסר = הקונה טרם מסר תקציב. */
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  entryType?: string;
  entryBy?: string;
  financing?: string;
  maturity?: string;
  mustFeatures: string[];
  niceFeatures: string[];
  source: string;
  /** שם המקור לתצוגה, מקטלוג התמחור — לא שם ספק שכתוב במסך. */
  sourceLabel: string;
  /** כמה קרדיטים תעלה הצעה. 0 = חינם (ביקוש של משרד אחר). */
  creditsCost: number;
  /** אחוז העמלה שהמשרד המשתף מבקש; לצד השני נשאר המשלים. */
  commissionSplit: number;
  /**
   * חלוקת העמלה לכל צד. זה מה שמוצג; `commissionSplit` שלידו הוא
   * הכותרת בלבד — ברירת המחדל בבורר של ההצעה הנגדית.
   */
  terms: CommissionTerms;
  mine: boolean;
  /** המשרד שפרסם. חסר לביקוש ממקור חיצוני, שאינו משרד תיווך. */
  officeName?: string;
  /** לוגו המשרד המפרסם, כשהעלה כזה. */
  officeLogoUrl?: string;
  /**
   * הקונה שממנו נגזר הביקוש — **מגיע רק על הביקושים שלנו.**
   *
   * השרת שולח אותו בתנאי `mine`, בדיוק כמו `originPropertyId` בצד
   * הנכס. אצל משרד אחר הוא לא קיים בתשובה כלל, ולא "מוסתר במסך".
   */
  originBuyerId?: string;
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
  /** תמונות הנכס — כתובות חתומות קצרות-חיים מהשרת. */
  photos?: string[];
  commissionSplit: number;
  /**
   * חלוקת העמלה לכל צד. זה מה שמוצג; `commissionSplit` שלידו הוא
   * הכותרת בלבד — ברירת המחדל בבורר של ההצעה הנגדית.
   */
  terms: CommissionTerms;
  status: string;
  mine: boolean;
  /** המשרד שפרסם את הנכס לרשת. */
  officeName?: string;
  /** לוגו המשרד המפרסם, כשהעלה כזה. */
  officeLogoUrl?: string;
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
    /** חסר = הקונה טרם מסר תקציב. */
  budgetMaxAgorot?: number;
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
  /** המשרד שמציע את הקונה — מידע על משרד, לא על הלקוח */
  officeName?: string;
  /** הסיבה שנכתבה בדחייה — מוצגת על הכרטיס שנדחה */
  declineNote?: string;
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
  /** המשרד המציע (בנכנסות) או המקבל (ביוצאות) — מידע על משרד בלבד */
  officeName?: string;
  /** תמונות הנכס המוצע — חלק מהחשיפה המדורגת, רק בהצעות נכנסות */
  photos?: string[];
  /** הסיבה שנכתבה בדחייה */
  declineNote?: string;
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
  referrerRating?: {
    average: number;
    count: number;
    /**
     * אותו דיוק, לכל ממד בנפרד. יכול להיות ריק גם כשיש ממוצע:
     * הפירוט נצבר רק מאישורים חדשים ואין מילוי לאחור.
     */
    dimensions: { key: string; average: number; count: number }[];
  };
  /** הצהרת המפנה על איכות הלקוח — מוצגת לפני התשלום. */
  clientScores: Record<string, number>;
  confirmation?: ReferralConfirmationValue;
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
  // אישור חיבור פותח חדר עסקה, והמסך נכנס אליו מיד
  const router = useRouter();
  /*
   * ההתראה על הצעה חדשה הובילה ל-/collaboration והמסך נפתח תמיד על
   * "ביקושים ברשת" — כלומר על לשונית שאינה זו שההתראה דיברה עליה,
   * וההצעה נראתה כאילו איננה. הכתובת קובעת.
   */
  const [coopTab, setCoopTab] = useState<string>("demands");
  /*
   * כרטיסיות או שורות — העדפה אישית שנשמרת בדפדפן. יש מי שסורק
   * לוח ויש מי שקורא רשימה, ואין סיבה להכריע בשבילם (בקשת המשתמש).
   */
  const [netView, setNetView] = useState<"cards" | "rows">("cards");
  useEffect(() => {
    try {
      if (window.localStorage.getItem("mv-net-view") === "rows") setNetView("rows");
    } catch {
      // דפדפן בלי אחסון — ברירת המחדל מספיקה
    }
  }, []);
  function switchNetView(view: "cards" | "rows"): void {
    setNetView(view);
    try {
      window.localStorage.setItem("mv-net-view", view);
    } catch {
      // ההעדפה תחזיק עד רענון — עדיין עדיף מכלום
    }
  }
  const [netFilters, setNetFilters] = useState<ListFilterValues>(EMPTY_FILTERS);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [demands, setDemands] = useState<DemandRow[] | null>(null);
  const [netSummary, setNetSummary] = useState<NetworkSummary | null>(null);
  const [sharedLeads, setSharedLeads] = useState<SharedLeadRow[]>([]);
  const [buyingLead, setBuyingLead] = useState<string | null>(null);
  const [boughtLeadId, setBoughtLeadId] = useState<string | null>(null);
  const [coopOffers, setCoopOffers] = useState<CoopOfferRow[]>([]);
  /*
   * טופס „לא מתאים” פתוח — על הצעה או פנייה אחת בכל רגע. הדחייה
   * אינה נשלחת בלחיצה הראשונה: קודם נפתח שדה שבו כותבים למשרד
   * שהציע למה זה לא מתאים (בקשת המשתמש) — פידבק שמלמד אותו מה
   * כן להציע, במקום שתיקה שמורידה משרדים מהרשת.
   */
  const [declining, setDeclining] = useState<
    { kind: "offer" | "interest"; id: string } | null
  >(null);
  const [declineText, setDeclineText] = useState("");
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
  /*
   * הטקסט עצמו כבר אינו מוצג בשורה — החלונית הצפה מציגה אותו —
   * אבל ה-setter נשאר כנקודת כניסה אחת לכל ההודעות במסך.
   */
  const [, setMessageState] = useState<string | null>(null);
  /*
   * כישלון טעינה נשמר בנפרד לכל רשימה, ולא מכווץ ל-[].
   * מצב ריק אומר למתווך "אין כאן כלום, אין מה לעשות" — והוא עוזב.
   * תקלת רשת אינה מסקנה עסקית, ולכן היא מוצגת ככשל עם ניסיון חוזר.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [offersFailed, setOffersFailed] = useState(false);
  const [leadsFailed, setLeadsFailed] = useState(false);
  const [listingsFailed, setListingsFailed] = useState(false);

  /**
   * כל הודעה חדשה מוחקת את קישור "פתח את הליד" של הקנייה הקודמת.
   *
   * ההודעה מוצגת כחלונית צפה ולא כפסקה בראש המסך: אחרי שליחה
   * הרשימה נטענת מחדש והמסך זז, וההודעה הישנה נשארה מחוץ לשדה
   * הראייה — כלומר המתווך לא ידע אם ההצעה יצאה, ולחץ שוב.
   *
   * הטון נגזר מהטקסט ולא נמסר בכל קריאה: הצלחות במסך הזה מסומנות
   * ב-"✓", וכך אין סיכון שקריאה חדשה תישכח ותקבל את הטון הלא נכון.
   */
  function setMessage(text: string | null, leadId: string | null = null) {
    setMessageState(text);
    setBoughtLeadId(leadId);
    setToast(
      text === null
        ? null
        : { text, tone: text.startsWith("✓") ? "success" : "error" },
    );
  }

  /*
   * הסינון נוסע לשרת ולא מסונן במסך.
   *
   * הפיד חתוך ל-100 מודעות, ולכן סינון מקומי היה מחפש רק בתוך החלון
   * הזה — ומכריז "אין תוצאות" על מודעה שקיימת ברשת אך יושבת מחוצה
   * לו. תשובה שגויה כזו גרועה מאין סינון בכלל, כי המתווך מפסיק
   * לחפש (ביקורת Codex).
   *
   * `filtersToQuery` מחזיר מחרוזת שמתחילה ב-"&" כדי להיצמד לפרמטר
   * קיים; לנתיבים האלה אין פרמטר אחר, ולכן ה-"&" הופך ל-"?".
   */
  const netQuery = filtersToQuery(netFilters).replace(/^&/u, "?");

  const load = useCallback(() => {
    setLoadFailed(false);
    /*
     * ‏המספרים שבראש המסך — ספירות במסד ולא אורך רשימה. הפיד חסום
     * במאה שורות, ומשרד שרואה מאה ביקושים אינו יודע אם יש 100 או
     * 340. כישלון כאן אינו מסתיר את המסך: האריחים מציגים „…”
     * והרשימות ממשיכות כרגיל.
     */
    apiGet<NetworkSummary>("/collaboration/summary")
      .then(setNetSummary)
      .catch(() => setNetSummary(null));
    setOffersFailed(false);
    setLeadsFailed(false);
    setListingsFailed(false);
    /*
     * כישלון בטעינת הביקושים אינו "אין ביקושים ברשת".
     * קודם הוא הפך ל-[] והמסך הציג את מצב הריק — כלומר תקלת רשת
     * נראתה כמו מסקנה עסקית ("אין מה לעשות כאן"), והמתווך היה עוזב.
     */
    apiGet<DemandRow[]>(`/collaboration/demands${netQuery}`)
      .then(setDemands)
      .catch(() => setLoadFailed(true));
    apiGet<CoopOfferRow[]>("/collaboration/offers")
      .then(setCoopOffers)
      .catch(() => setOffersFailed(true));
    apiGet<ListingRow[]>(`/collaboration/listings${netQuery}`)
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
      .then((r) => setProperties(apiList(r.items, "items")))
      .catch(() => undefined);
    apiGet<{ items: BuyerOption[] }>("/buyers?limit=50")
      .then((r) => setBuyers(apiList(r.items, "items")))
      .catch(() => undefined);
    // שינוי הסינון טוען מחדש — הפיד מסונן בשרת ולא במסך
  }, [netQuery]);

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
       *
       * `publisherStatedSplit` ולא `commissionSplit`: הכותרת נופלת
       * ל-50 כשהמשרד המפרסם ניסח את צדו במילים, ואז „מה שהוא ביקש”
       * הוא מספר שהוא מעולם לא ביקש. במקרה הזה הערך נשאר ברירת
       * המחדל — וזה נאמר במפורש ליד הכפתור (`ProposedSplitNote`).
       */
      const demand = demands?.find((d) => d.id === demandId);
      await apiPost(`/collaboration/demands/${demandId}/offer`, {
        propertyId,
        commissionSplit:
          offerSplit[demandId] ??
          (demand === undefined
            ? DEFAULT_COMMISSION_SPLIT
            : (publisherStatedSplit(demand.terms, "buyer") ??
              DEFAULT_COMMISSION_SPLIT)),
      });
      setMessage("✓ ההצעה נשלחה. אם הקונה יתעניין — תקבלו התראה.");
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "שליחת ההצעה נכשלה");
    }
  }

  /**
   * תגובה להצעת נכס. „מעוניין” פותח חדר עסקה משותף, והמסך מנווט
   * אליו מיד: זו כל הנקודה של האישור, וסוכן שנשאר על אותה רשימה
   * לא ידע שנפתח לו משהו — וזה בדיוק המקום שבו ההמשך עבר לוואטסאפ.
   */
  async function respond(
    offerId: string,
    response: "interested" | "declined",
    note?: string,
  ) {
    try {
      const { dealId } = await apiPatch<{ ok: true; dealId: string | null }>(
        `/collaboration/offers/${offerId}/respond`,
        { response, ...(note === undefined || note === "" ? {} : { note }) },
      );
      setDeclining(null);
      if (dealId !== null) {
        router.push(`/collaboration/deals/${dealId}`);
        return;
      }
      load();
    } catch (err: unknown) {
      setMessage(err instanceof ApiError ? err.message : "העדכון נכשל");
    }
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
      /* אותו כלל בדיוק כמו בהצעה — ראו `sendOfferFor`. */
      const listing = listings?.find((l) => l.id === listingId);
      await apiPost(`/collaboration/listings/${listingId}/interest`, {
        buyerId,
        commissionSplit:
          interestSplit[listingId] ??
          (listing === undefined
            ? DEFAULT_COMMISSION_SPLIT
            : (publisherStatedSplit(listing.terms, "property") ??
              DEFAULT_COMMISSION_SPLIT)),
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
    note?: string,
  ) {
    try {
      const { dealId } = await apiPatch<{ dealId: string | null }>(
        `/collaboration/interests/${id}/respond`,
        { response, ...(note === undefined || note === "" ? {} : { note }) },
      );
      setDeclining(null);
      if (dealId !== null) {
        router.push(`/collaboration/deals/${dealId}`);
        return;
      }
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
        `לקלוט את ההפניה תמורת עמלת הפניה של ${price} קרדיטים?\n\n` +
          "פרטי הקשר ייחשפו מיד. העמלה היא על ההפניה עצמה — היא נגבית עכשיו, " +
          "אינה מוחזרת גם אם לא תיסגר עסקה, ואין עמלה נוספת בסגירה. " +
          "אחרי הקליטה תוכלו לדרג את ההפניה.",
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

  /*
   * ‎**„מתאימים לנכסים שלך” — נספר מהפיד, ולא מהשרת.**
   *
   * ‏הוא התווית של הקטע שמתחתיו, ולכן חייב להיות בדיוק מספר
   * הכרטיסים בו. ספירה שנייה בשרת הייתה מנוע התאמות שני, ומספיק
   * הבדל אחד בסינון כדי שהכותרת תאמר „6” מעל חמישה כרטיסים.
   *
   * ‎`null` כל עוד הפיד לא נטען — „עוד לא יודעים” אינו אפס.
   */
  const matchedDemands =
    demands === null
      ? null
      : demands.filter((d) => !d.mine && (d.myMatches?.length ?? 0) > 0);
  const unmatchedDemands =
    demands === null
      ? null
      : demands.filter((d) => !d.mine && (d.myMatches?.length ?? 0) === 0);
  const actionableCount = matchedDemands === null ? null : matchedDemands.length;

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
      {/*
        כרטיס הפתיחה — הכותרת, המספרים והחיסיון באובייקט אחד.

        קודם ישבו כאן שלושה בלוקים נפרדים: כותרת עם כפתור, באנר
        חיסיון, ואחריהם הלשוניות. מי שנחת במסך לא ידע אם הרשת עובדת
        בשבילו — לא היה בו ולו מספר אחד. „32 ביקושים ברשת” ו„12
        משרדים מחוברים” הם התשובה לשאלה שנשאלת בשנייה הראשונה.

        ‎`actionable` נגזר מהפיד ולא מהשרת, וזו הכרעה: הוא התווית של
        הקטע שמתחתיו וחייב להיות בדיוק מספר הכרטיסים בו.
      */}
      <NetworkHeader summary={netSummary} actionable={actionableCount} />

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
        {COOP_TABS.map(([key, label, Icon]) => {
          /*
           * כפתור "הרשת" פעיל בשתי תת-הלשוניות, ולחיצה עליו כשהוא
           * כבר פעיל אינה מאפסת את הבחירה — מי שנמצא ברשימת הנכסים
           * ולוחץ על "הרשת" לא ביקש לחזור לקונים.
           */
          const active =
            key === "network" ? isNetworkTab(coopTab) : coopTab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`coop-tab-${key}`}
              aria-selected={active}
              aria-controls={
                key === "network" ? "coop-panel-network" : `coop-panel-${key}`
              }
              aria-pressed={active}
              onClick={() =>
                setCoopTab(
                  key === "network"
                    ? isNetworkTab(coopTab)
                      ? coopTab
                      : "demands"
                    : key,
                )
              }
            >
              <Icon s={15} /> {label}
              {/* המונה סופר את שני הכיוונים — הצעות על הביקושים שלי
                ופניות על הנכסים שלי יושבות באותה לשונית */}
              {key === "incoming" &&
              incoming.length + openInterests.length > 0 ? (
                <span
                  className="mv-chip ms-1.5"
                  style={{ padding: "1px 7px", fontSize: "var(--type-caption)" }}
                >
                  {incoming.length + openInterests.length}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <ActionToast
        state={
          toast === null
            ? null
            : {
                ...toast,
                /* קליטת הפניה יוצרת ליד — הקישור אליו הוא הצעד הבא */
                ...(boughtLeadId === null
                  ? {}
                  : {
                      extra: (
                        <Link
                          href={`/leads/${boughtLeadId}`}
                          className="font-medium underline"
                        >
                          פתח את הליד ←
                        </Link>
                      ),
                    }),
              }
        }
        onClose={() => setToast(null)}
      />

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
            className="mv-net-grid"
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

                {/*
                  שני מקטעים עם כותרות (בקשת המשתמש): קודם תנאי
                  ההצעה — מי מציע ואיך נחלקת העמלה — ואז הנכס עצמו.
                  בלי ההפרדה הכרטיס נקרא כערימת תגיות אחת.
                */}
                <h4 className="mv-net-sec">פרטי ההצעה</h4>
                <ul className="mv-net-chips">
                  <li className="mv-net-chip mv-net-chip--primary">
                    <IconBank s={14} /> {offer.officeName ?? "משרד תיווך"}
                  </li>
                  {/* חלוקת העמלה לפני ההסכמה ולא אחריה */}
                  <li className="mv-net-chip mv-net-chip--money">
                    <IconCoins s={14} /> העמלה שלי {100 - offer.commissionSplit}
                    % · למציע {offer.commissionSplit}%
                  </li>
                  <li className="mv-net-chip" title="חשיפה מדורגת">
                    <IconLock s={14} /> כתובת מדויקת ופרטי קשר — רק אחרי אישור
                  </li>
                </ul>

                <h4 className="mv-net-sec">הנכס המוצע</h4>
                {offer.photos !== undefined && offer.photos.length > 0 ? (
                  <NetPhotos
                    photos={offer.photos}
                    alt={offer.presentation.title ?? "הנכס המוצע"}
                  />
                ) : null}
                {/* כל מה שאינו מזהה — לפני אישור החיבור, לא אחריו */}
                <NetChips chips={presentationChips(offer.presentation)} />
                <div className="mb-1">
                  <NetDetailsButton
                    title={offer.presentation.title ?? "נכס שהוצע לכם"}
                    {...(offer.presentation.priceAgorot === undefined
                      ? {}
                      : {
                          money: `${shekels(offer.presentation.priceAgorot)} ₪`,
                        })}
                    moneyLabel={
                      offer.presentation.dealType === "rent"
                        ? "שכר דירה"
                        : "מחיר"
                    }
                    details={[
                      ...presentationDetailRows(offer.presentation),
                      {
                        label: "חלוקת עמלה",
                        value: describeCommissionSplit(offer.commissionSplit),
                      },
                    ]}
                    notesLabel="הערות חשובות"
                    {...(offer.photos === undefined
                      ? {}
                      : { photos: offer.photos })}
                    id={offer.id}
                    {...(offer.officeName === undefined
                      ? {}
                      : { officeName: offer.officeName })}
                  />
                </div>

                <div className="mv-net-foot">
                  {offer.status === "sent" ? (
                    declining?.kind === "offer" &&
                    declining.id === offer.id ? (
                      <div className="w-full">
                        <label
                          htmlFor={`decline-offer-${offer.id}`}
                          className="mb-1 block text-[length:var(--type-caption)] font-medium"
                        >
                          למה ההצעה לא מתאימה? הסיבה תישלח למשרד שהציע
                        </label>
                        <textarea
                          id={`decline-offer-${offer.id}`}
                          rows={2}
                          maxLength={300}
                          className="w-full rounded-lg border p-2 text-[length:var(--type-caption)]"
                          style={{
                            borderColor: "var(--color-input-border)",
                            background: "var(--color-bg)",
                          }}
                          value={declineText}
                          onChange={(e) => setDeclineText(e.target.value)}
                          placeholder="למשל: המחיר גבוה מהתקציב של הקונה, או שהקומה לא מתאימה"
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            onClick={() =>
                              void respond(
                                offer.id,
                                "declined",
                                declineText.trim(),
                              )
                            }
                          >
                            שליחה ודחייה
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setDeclining(null)}
                          >
                            ביטול
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="flex gap-2">
                        <Button
                          onClick={() => void respond(offer.id, "interested")}
                        >
                          מעניין — פתח חיבור
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setDeclineText("");
                            setDeclining({ kind: "offer", id: offer.id });
                          }}
                        >
                          לא מתאים
                        </Button>
                      </span>
                    )
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
                      {offer.declineNote === undefined
                        ? ""
                        : ` — „${offer.declineNote}”`}
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
                className="mv-net-grid"
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

                    {/* אותו מבנה כמו בהצעות הנכסים — קודם תנאי ההצעה, ואז הקונה */}
                    <h4 className="mv-net-sec">פרטי ההצעה</h4>
                    <ul className="mv-net-chips">
                      <li className="mv-net-chip mv-net-chip--primary">
                        <IconBank s={14} /> {interest.officeName ?? "משרד תיווך"}
                      </li>
                      <li className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> העמלה שלי{" "}
                        {100 - interest.commissionSplit}% · למציע{" "}
                        {interest.commissionSplit}%
                      </li>
                      <li className="mv-net-chip" title="חשיפה מדורגת">
                        <IconLock s={14} /> שם הקונה ופרטי הקשר — רק אחרי אישור
                      </li>
                    </ul>

                    <h4 className="mv-net-sec">הקונה המוצע</h4>
                    {/* כל מה שידוע על הקונה למעט מה שמזהה אותו */}
                    <NetChips chips={demandChips(interest.presentation)} />
                    <div className="mb-1">
                      <NetDetailsButton
                        title={`קונה עבור „${interest.propertyTitle ?? "נכס שפרסמתם"}”`}
                        moneyLabel="תקציב"
                        details={[
                          ...demandDetailRows(interest.presentation),
                          {
                            label: "חלוקת עמלה",
                            value: describeCommissionSplit(
                              interest.commissionSplit,
                            ),
                          },
                        ]}
                        notesLabel="הערות חשובות"
                        id={interest.id}
                        {...(interest.officeName === undefined
                          ? {}
                          : { officeName: interest.officeName })}
                      />
                    </div>

                    <div className="mv-net-foot">
                      {interest.status === "sent" ? (
                        declining?.kind === "interest" &&
                        declining.id === interest.id ? (
                          <div className="w-full">
                            <label
                              htmlFor={`decline-interest-${interest.id}`}
                              className="mb-1 block text-[length:var(--type-caption)] font-medium"
                            >
                              למה הקונה לא מתאים? הסיבה תישלח למשרד שהציע
                            </label>
                            <textarea
                              id={`decline-interest-${interest.id}`}
                              rows={2}
                              maxLength={300}
                              className="w-full rounded-lg border p-2 text-[length:var(--type-caption)]"
                              style={{
                                borderColor: "var(--color-input-border)",
                                background: "var(--color-bg)",
                              }}
                              value={declineText}
                              onChange={(e) => setDeclineText(e.target.value)}
                              placeholder="למשל: הנכס כבר בהליך מתקדם עם קונה אחר"
                            />
                            <div className="mt-2 flex gap-2">
                              <Button
                                onClick={() =>
                                  void respondToInterest(
                                    interest.id,
                                    "declined",
                                    declineText.trim(),
                                  )
                                }
                              >
                                שליחה ודחייה
                              </Button>
                              <Button
                                variant="ghost"
                                onClick={() => setDeclining(null)}
                              >
                                ביטול
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <span className="flex gap-2">
                            <Button
                              onClick={() =>
                                void respondToInterest(
                                  interest.id,
                                  "interested",
                                )
                              }
                            >
                              מעניין — פתח חיבור
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setDeclineText("");
                                setDeclining({
                                  kind: "interest",
                                  id: interest.id,
                                });
                              }}
                            >
                              לא מתאים
                            </Button>
                          </span>
                        )
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
                          {interest.declineNote === undefined
                            ? ""
                            : ` — „${interest.declineNote}”`}
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

      {coopTab === "deals" ? <DealsList /> : null}


      {/*
        אזור הרשת — מסגרת אחת לשני הכיוונים.

        תת-הלשוניות והסינון יושבים כאן, מעל שתי הרשימות, כדי שהם
        יהיו אותו סרגל בשני הכיוונים ולא שני סרגלים שמתחילים להיפרד
        בשינוי הראשון.
      */}
      {isNetworkTab(coopTab) ? (
        <div
          id="coop-panel-network"
          role="tabpanel"
          aria-labelledby="coop-tab-network"
        >
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="mv-seg" role="tablist" aria-label="כיווני הרשת">
              {NETWORK_SUBTABS.map(([key, label, Icon]) => (
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
                </button>
              ))}
            </div>
            {coopTab === "market" ? null : (
              <div className="mv-seg" role="group" aria-label="אופן התצוגה">
                <button
                  type="button"
                  aria-pressed={netView === "cards"}
                  onClick={() => switchNetView("cards")}
                  title="תצוגת כרטיסיות"
                >
                  <IconMenu s={14} /> כרטיסיות
                </button>
                <button
                  type="button"
                  aria-pressed={netView === "rows"}
                  onClick={() => switchNetView("rows")}
                  title="תצוגת שורות"
                >
                  <IconList s={14} /> שורות
                </button>
              </div>
            )}
          </div>

          {/*
            אותו סרגל סינון של מסכי הרשימה, ובכוונה אותו רכיב: מתווך
            שלמד לסנן נכסים לא צריך ללמוד מסנן שני. הניסוח מתחלף לפי
            הכיוון — לקונה יש **תקציב** ולנכס יש **מחיר**.
          */}
          {coopTab === "market" ? null : (
          <ListFilters
            values={netFilters}
            onApply={setNetFilters}
            searchLabel={
              coopTab === "demands" ? "חיפוש בקונים ברשת" : "חיפוש בנכסים ברשת"
            }
            searchHint={
              coopTab === "demands"
                ? "עיר, שכונה, משרד מפרסם…"
                : "עיר, שכונה, כותרת, משרד מפרסם…"
            }
            priceLabel={coopTab === "demands" ? "תקציב" : "מחיר"}
          />
          )}

          {coopTab === "demands" ? (
            <section
              id="coop-panel-demands"
              role="tabpanel"
              aria-labelledby="coop-tab-demands"
            >
              <h2 id="demands-heading" className="mb-1 text-lg font-semibold">
                <IconUser s={17} /> קונים ברשת
              </h2>
              {/*
          שורה אחת במקום פסקה. הכלל המלא (ומה שקורה עם מקור חיצוני)
          חי בפאנל העמלות ובכרטיס הפתיחה — כאן צריך רק את מה שמשנה
          את ההחלטה בשנייה הראשונה.
        */}
              <p
                className="mb-3.5 text-[length:var(--type-body)]"
                style={{ color: "var(--color-text-soft)" }}
              >
                קונים של משרדים אחרים — <b>בלי שם ובלי טלפון</b>. יש לכם נכס
                מתאים? ההצעה חינם, והעמלה מתחלקת רק אם העסקה תיסגר.
              </p>

              {loadFailed ? (
                <LoadError
                  message="לא הצלחנו לטעון את הביקושים ברשת"
                  onRetry={load}
                />
              ) : demands === null ? (
                <p aria-live="polite">טוען…</p>
              ) : demands.length === 0 && hasActiveFilters(netFilters) ? (
                /*
                  רשימה ריקה בגלל הסינון היא הודעה אחרת מ"אין ביקושים
                  ברשת" — והיא מדויקת, כי השרת חיפש בכל הרשת ולא רק
                  ב-100 האחרונים.
                */
                <div className="mv-net-empty">
                  <span className="mv-net-empty-icon">
                    <IconSearch s={30} />
                  </span>
                  <p className="m-0 font-semibold">אין תוצאות לסינון הזה</p>
                  <p
                    className="m-0 mt-1 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    אף ביקוש ברשת לא עונה על הסינון הנוכחי.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => setNetFilters(EMPTY_FILTERS)}
                  >
                    נקה סינון
                  </Button>
                </div>
              ) : demands.length === 0 ? (
                <div className="mv-net-empty">
                  <span className="mv-net-empty-icon">
                    <IconSearch s={30} />
                  </span>
                  <p className="m-0 font-semibold">
                    אין כרגע ביקושים פעילים ברשת
                  </p>
                  <p
                    className="m-0 mt-1 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    שתפו קונה מכרטיס הקונה — וסוכנויות אחרות יוכלו להציע לו
                    נכסים.
                  </p>
                </div>
              ) : (
                <ul className={netView === "rows" ? "mv-net-rows" : "mv-net-grid"}>
                  {demands.map((demand) => (
                    <li
                      key={demand.id}
                      className={`mv-net-card${demand.mine ? " mv-net-card--mine" : ""}`}
                    >
                      {/*
                        הכרטיס נבנה מרשימת התגיות ולא מה-DTO: זהו
                        אותו מקור אחד שמחליט מה מוצג ומה לעולם לא
                        (`packages/shared/logic/network-card.ts`),
                        ומסלול שני היה עוקף אותו — כלומר מוציא את
                        החיסיון מהמקום שנבנה כדי לשמור עליו.
                      */}
                      {(() => {
                        const split = splitNetworkChips(demandChips(demand));
                        return (
                          <>
                            <div className="mv-net-top">
                              {demand.mine ? (
                                <span className="mv-net-badge mv-net-badge--quiet">
                                  <IconStar s={14} /> הביקוש שלך
                                </span>
                              ) : demand.creditsCost > 0 ? (
                                <span className="mv-net-badge">
                                  <IconCoins s={14} /> {demand.creditsCost} קרדיטים
                                </span>
                              ) : (
                                <span />
                              )}
                              <span className="flex flex-wrap items-center gap-2">
                                {demand.mine ? (
                                  /*
                                    הביקוש שלנו ⟵ הכרטיס שממנו הוא נגזר.
                                    מי שרואה מודעה שלו ורוצה לתקן דרישה
                                    צריך להגיע לכרטיס, לא לחפש אותו
                                    ברשימת הקונים לפי הזיכרון.
                                  */
                                  demand.originBuyerId === undefined ? null : (
                                    <Link
                                      href={`/buyers/${demand.originBuyerId}`}
                                      className="mv-net-chip mv-net-chip--primary"
                                      style={{ textDecoration: "none" }}
                                    >
                                      <IconUsers s={14} /> פתח את הכרטיס
                                    </Link>
                                  )
                                ) : (
                                  <span
                                    className="mv-net-chip"
                                    title="חלוקת העמלה שהמשרד המשתף ביקש — צד קונה וצד מוכר"
                                  >
                                    <IconHandshake s={14} />{" "}
                                    {describeCommissionTerms(demand.terms)}
                                  </span>
                                )}
                                {demand.officeName ? (
                                  <NetOffice
                                    name={demand.officeName}
                                    {...(demand.officeLogoUrl === undefined
                                      ? {}
                                      : { logoUrl: demand.officeLogoUrl })}
                                  />
                                ) : null}
                                {/*
                                  מקור חיצוני בתשלום, לפי העלות שהשרת החזיר ולא
                                  לפי שם ספק שכתוב בקוד. השוואה מפורשת ל-"kanko"
                                  הסתירה כל מקור שהפלטפורמה תמחרה מאז.
                                */}
                                {demand.creditsCost > 0 ? (
                                  <span
                                    className="mv-net-chip"
                                    title="ביקוש שהגיע ממקור חיצוני בתשלום"
                                  >
                                    <IconGlobe s={14} /> {demand.sourceLabel}
                                  </span>
                                ) : null}
                              </span>
                            </div>

                            <NetHero
                              icon={<IconUser s={22} />}
                              title={`קונה מחפש ${roomsLabel(demand.roomsMin, demand.roomsMax)}`}
                              subtitle={split.subtitle}
                            />
                            {/*
                              האזור נופל לאזורי המפה כשאין ערים: קונה שסימן
                              אזור ולא הקליד עיר הופיע כ„קונה מחפש 4 חדרים ב”
                              — משפט קטוע שאינו אומר לאן להציע.
                            */}
                            <NetPlace text={split.place === "" ? demandArea(demand) : split.place} />
                            {split.money === undefined ? null : (
                              <NetMoney label="תקציב" value={split.money.text} />
                            )}
                            <NetFacts facts={split.facts} />
                            <NetSay label="הערות חשובות" text={demand.notes} />
                            <div className="mv-net-cardfoot">
                              <NetMeta id={demand.id} />
                              <NetDetailsButton
                                title={`קונה מחפש ${roomsLabel(demand.roomsMin, demand.roomsMax)}`}
                                subtitle={split.subtitle}
                                {...(split.money === undefined ? {} : { money: split.money.text })}
                                moneyLabel="תקציב"
                                details={[
                                  ...demandDetailRows(demand),
                                  ...commissionDetailRows(demand.terms),
                                  ...(demand.creditsCost > 0
                                    ? [{ label: "מקור", value: demand.sourceLabel }]
                                    : []),
                                ]}
                                {...(demand.notes === undefined ? {} : { notes: demand.notes })}
                                notesLabel="הערות חשובות"
                                id={demand.id}
                                {...(demand.officeName ? { officeName: demand.officeName } : {})}
                              />
                            </div>
                          </>
                        );
                      })()}

                      {!demand.mine ? (
                        <>
                          {/* המערכת מחשבת אילו מהנכסים שלי מתאימים — במקום
                        לבחור מרשימה של עשרות ולבזבז קרדיט על ניחוש */}
                          {demand.myMatches && demand.myMatches.length > 0 ? (
                            <div className="mb-3">
                              <p
                                className="m-0 mb-2 text-[length:var(--type-body)] font-bold"
                                style={{ color: "var(--color-primary)" }}
                              >
                                <IconTarget s={16} /> {demand.myMatches.length}{" "}
                                מהנכסים שלכם מתאימים
                              </p>
                              {/*
                                גם כאן, ולא רק ליד הבורר: „הצע נכס זה”
                                שולח בלחיצה אחת, ובלי הבורר מולו הוא
                                שולח את **ברירת המחדל**. כשהמשרד
                                המפרסם ניסח את חלוקתו במילים, זהו אחוז
                                שאיש לא ביקש — והמסך חייב לומר זאת
                                לפני הלחיצה, לא אחריה.
                              */}
                              <ProposedSplitNote
                                terms={demand.terms}
                                kind="buyer"
                              />
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
                                      {/* קישור לכרטיס הנכס — כמו בצד הקונים:
                                      בודקים את הפרטים המדויקים לפני שמציעים */}
                                      <Link
                                        href={`/properties/${match.propertyId}`}
                                        target="_blank"
                                        className="mv-net-match-name"
                                        title="פתיחת כרטיס הנכס המלא בלשונית חדשה"
                                      >
                                        {match.title}
                                        <IconEye s={13} />
                                      </Link>
                                      <span
                                        className="block text-[length:var(--type-caption-lg)]"
                                        style={{
                                          color: "var(--color-text-soft)",
                                        }}
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
                            <NetNoMatch
                              what="אין לכם עדיין נכס שמתאים לביקוש הזה"
                              hint="אפשר להציע כל נכס אחר מהרשימה שלמטה — או לחזור כשייקלט נכס מתאים"
                            />
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
                                <IconPlus s={14} /> להציע נכס אחר / לשנות חלוקת
                                עמלה
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
                                  offerSplit[demand.id] ??
                                  publisherStatedSplit(demand.terms, "buyer") ??
                                  DEFAULT_COMMISSION_SPLIT
                                }
                                onChange={(e) =>
                                  setOfferSplit((prev) => ({
                                    ...prev,
                                    [demand.id]: Number(e.target.value),
                                  }))
                                }
                                className="mv-control"
                              >
                                {/*
                                  גם כאן הערך שהמשרד המפרסם הצהיר עליו
                                  נכלל ברשימה כשאינו נופל על החמישיות —
                                  אחרת הבורר היה נפתח על ערך אחר,
                                  וההצעה הייתה יוצאת על אחוז שלישי
                                  שאיש לא בחר.
                                */}
                                {commissionSplitOptionsWith(
                                  publisherStatedSplit(demand.terms, "buyer"),
                                ).map((share) => (
                                  <option key={share} value={share}>
                                    {describeCommissionSplit(share)}
                                  </option>
                                ))}
                              </select>
                              <ProposedSplitNote
                                terms={demand.terms}
                                kind="buyer"
                              />
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
                                      [p.street, p.city]
                                        .filter(Boolean)
                                        .join(", ")}
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
                className="mb-3.5 text-[length:var(--type-body)]"
                style={{ color: "var(--color-text-soft)" }}
              >
                נכסים של משרדים אחרים — <b>בלי כתובת מדויקת ובלי בעלים</b>. יש
                לכם קונה מתאים? הפנייה חינם, והעמלה מתחלקת רק אם העסקה תיסגר.
              </p>

              {listingsFailed ? (
                <LoadError
                  message="לא הצלחנו לטעון את הנכסים ברשת"
                  onRetry={load}
                />
              ) : listings === null ? (
                <p aria-live="polite">טוען…</p>
              ) : listings.length === 0 && hasActiveFilters(netFilters) ? (
                <div className="mv-net-empty">
                  <span className="mv-net-empty-icon">
                    <IconSearch s={30} />
                  </span>
                  <p className="m-0 font-semibold">אין תוצאות לסינון הזה</p>
                  <p
                    className="m-0 mt-1 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    אף נכס ברשת לא עונה על הסינון הנוכחי.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => setNetFilters(EMPTY_FILTERS)}
                  >
                    נקה סינון
                  </Button>
                </div>
              ) : listings.length === 0 ? (
                <div className="mv-net-empty">
                  <span className="mv-net-empty-icon">
                    <IconTag s={30} />
                  </span>
                  <p className="m-0 font-semibold">
                    אין כרגע נכסים מפורסמים ברשת
                  </p>
                  <p
                    className="m-0 mt-1 text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    פרסמו נכס מכרטיס הנכס — ומשרדים עם קונה מתאים יפנו אליכם.
                  </p>
                </div>
              ) : (
                <ul className={netView === "rows" ? "mv-net-rows" : "mv-net-grid"}>
                  {listings.map((listing) => (
                    <li
                      key={listing.id}
                      className={`mv-net-card${listing.mine ? " mv-net-card--mine" : ""}`}
                    >
                      {/* אותה בנייה בדיוק כמו בכרטיס הביקוש — מרשימת
                          התגיות המשותפת, ולא מה-DTO */}
                      {(() => {
                        const split = splitNetworkChips(presentationChips(listing));
                        return (
                          <>
                            <div className="mv-net-top">
                              {listing.mine ? (
                                <span className="mv-net-badge mv-net-badge--quiet">
                                  <IconStar s={14} /> הנכס שלך
                                </span>
                              ) : (
                                <span />
                              )}
                              <span className="flex flex-wrap items-center gap-2">
                                {listing.mine ? (
                                  /* הקישור לנכס נחשף רק לסוכנות המקור */
                                  listing.originPropertyId === undefined ? null : (
                                    <Link
                                      href={`/properties/${listing.originPropertyId}`}
                                      className="mv-net-chip mv-net-chip--primary"
                                      style={{ textDecoration: "none" }}
                                    >
                                      <IconHome s={14} /> פתח את הכרטיס
                                    </Link>
                                  )
                                ) : (
                                  <span
                                    className="mv-net-chip"
                                    title="חלוקת העמלה שהמשרד המפרסם ביקש"
                                  >
                                    <IconHandshake s={14} />{" "}
                                    {describeCommissionTerms(listing.terms)}
                                  </span>
                                )}
                                {/* מי פרסם — שם המשרד ולוגו; הבעלים נשאר חסוי */}
                                {listing.officeName ? (
                                  <NetOffice
                                    name={listing.officeName}
                                    {...(listing.officeLogoUrl === undefined
                                      ? {}
                                      : { logoUrl: listing.officeLogoUrl })}
                                  />
                                ) : null}
                              </span>
                            </div>

                            <NetHero
                              icon={<IconHome s={22} />}
                              title={listing.title ?? `נכס ב${listing.city ?? "רשת"}`}
                              subtitle={split.subtitle}
                            />
                            <NetPhotos
                              photos={listing.photos ?? []}
                              alt={listing.title ?? "תמונת הנכס"}
                            />
                            <NetPlace
                              text={
                                split.place === ""
                                  ? [listing.city, listing.neighborhood]
                                      .filter(Boolean)
                                      .join(" · ")
                                  : split.place
                              }
                            />
                            {split.money === undefined ? null : (
                              <NetMoney label="מחיר" value={split.money.text} />
                            )}
                            <NetFacts facts={split.facts} />
                            <NetSay label="מה מיוחד בנכס" text={listing.notes} />
                            <div className="mv-net-cardfoot">
                              <NetMeta id={listing.id} />
                              <NetDetailsButton
                                title={listing.title ?? `נכס ב${listing.city ?? "רשת"}`}
                                subtitle={split.subtitle}
                                {...(split.money === undefined ? {} : { money: split.money.text })}
                                moneyLabel={listing.dealType === "rent" ? "שכר דירה" : "מחיר"}
                                details={[
                                  ...presentationDetailRows(listing),
                                  ...commissionDetailRows(listing.terms),
                                ]}
                                {...(listing.notes === undefined ? {} : { notes: listing.notes })}
                                notesLabel="מה מיוחד בנכס"
                                photos={listing.photos ?? []}
                                id={listing.id}
                                {...(listing.officeName ? { officeName: listing.officeName } : {})}
                              />
                            </div>
                          </>
                        );
                      })()}

                      {!listing.mine ? (
                        <>
                          {listing.interestSent ? (
                            <p
                              className="mb-3 flex items-center gap-1.5 text-sm font-semibold"
                              style={{ color: "var(--color-primary)" }}
                            >
                              <IconCheck s={15} /> כבר פניתם על הנכס הזה —
                              התשובה תגיע ללשונית „הצעות שקיבלתי”.
                            </p>
                          ) : listing.myMatches &&
                            listing.myMatches.length > 0 ? (
                            <div className="mb-3">
                              <p
                                className="m-0 mb-2 text-[length:var(--type-body)] font-bold"
                                style={{ color: "var(--color-primary)" }}
                              >
                                <IconTarget s={16} /> {listing.myMatches.length}{" "}
                                מהקונים שלכם מתאימים
                              </p>
                              {/* אותו נימוק בדיוק כמו בצד ההצעה על ביקוש */}
                              <ProposedSplitNote
                                terms={listing.terms}
                                kind="property"
                              />
                              <ul className="flex list-none flex-col gap-2 p-0">
                                {listing.myMatches.map((match) => (
                                  <li
                                    key={match.buyerId}
                                    className="mv-net-match"
                                  >
                                    <span
                                      className="mv-net-score"
                                      aria-hidden="true"
                                    >
                                      {match.score}%
                                    </span>
                                    <span className="flex-1 min-w-[160px]">
                                      {/* קישור לכרטיס המלא — ההתאמה היא הצעה,
                                      וההחלטה דורשת את הפרטים המדויקים. נפתח
                                      בלשונית חדשה כדי לא לאבד את מקום הגלילה
                                      בפיד */}
                                      <Link
                                        href={`/buyers/${match.buyerId}`}
                                        target="_blank"
                                        className="mv-net-match-name"
                                        title="פתיחת כרטיס הקונה המלא בלשונית חדשה"
                                      >
                                        {match.name}
                                        <IconEye s={13} />
                                      </Link>
                                      <span
                                        className="block text-[length:var(--type-caption-lg)]"
                                        style={{
                                          color: "var(--color-text-soft)",
                                        }}
                                      >
                                        {match.explanation}
                                      </span>
                                    </span>
                                    <Button
                                      variant="secondary"
                                      onClick={() =>
                                        void sendInterest(
                                          listing.id,
                                          match.buyerId,
                                        )
                                      }
                                    >
                                      יש לי קונה — פנה
                                    </Button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <NetNoMatch
                              what="אין לכם עדיין קונה שמתאים לנכס הזה"
                              hint="אפשר לפנות עם כל קונה אחר מהרשימה שלמטה — או לחזור כשייקלט קונה מתאים"
                            />
                          )}

                          {!listing.interestSent ? (
                            <details className="mv-net-foot">
                              <summary
                                className="cursor-pointer text-sm font-medium"
                                style={{ color: "var(--color-primary)" }}
                              >
                                <span className="inline-flex items-center gap-1.5 align-middle">
                                  <IconPlus s={14} /> להציע קונה אחר / לשנות
                                  חלוקת עמלה
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
                                    publisherStatedSplit(
                                      listing.terms,
                                      "property",
                                    ) ??
                                    DEFAULT_COMMISSION_SPLIT
                                  }
                                  onChange={(e) =>
                                    setInterestSplit((prev) => ({
                                      ...prev,
                                      [listing.id]: Number(e.target.value),
                                    }))
                                  }
                                  className="mv-control"
                                >
                                  {/* אותו כלל כמו בצד ההצעה */}
                                  {commissionSplitOptionsWith(
                                    publisherStatedSplit(
                                      listing.terms,
                                      "property",
                                    ),
                                  ).map((share) => (
                                    <option key={share} value={share}>
                                      {describeCommissionSplit(share)}
                                    </option>
                                  ))}
                                </select>
                                <ProposedSplitNote
                                  terms={listing.terms}
                                  kind="property"
                                />
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

      {coopTab === "market" ? (
        <section
          id="coop-panel-market"
          role="tabpanel"
          aria-labelledby="coop-tab-market"
          className="mb-8"
        >
          <h2 id="lead-market-heading" className="mb-1 text-lg font-semibold">
            <IconHandshake s={17} /> הפניות ברשת
          </h2>
          <p
            className="mb-3 text-[length:var(--type-body)]"
            style={{ color: "var(--color-text-soft)" }}
          >
            לקוחות שמשרד אחר לא יכול לשרת — ואתם כן.
          </p>

          {/* ארבעת הכללים יושבים כאן — במקום שבו מחליטים אם לשלם */}
          <ReferralRulesPanel />
          {/*
            היתרה יושבת כאן ולא בראש המסך. כשהיא הופיעה בכותרת הכללית
            היא נראתה כמו "מה נשאר לי לשיתופי פעולה" — וזה בדיוק מה
            שגרם למתווכים לחשוב ששת"פ עולה קרדיטים. הקרדיטים שייכים
            למסך הזה בלבד.
          */}
          {/* היתרה בשורת צ'יפים קצרה — המשפטים הארוכים עברו לצעדים למעלה */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="mv-net-chip mv-net-chip--money">
              <IconDiamond s={14} /> היתרה שלכם:{" "}
              {balance === null ? "…" : `${balance} קרדיטים`}
            </span>
            <span
              className="text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              שת"פ עם משרד תיווך — חינם. קרדיטים רק על הפניות ומקורות חיצוניים.
            </span>
          </div>
          {/*
            התפוגה נאמרת ליד היתרה ולא במסך הגדרות. "היו לי 40 ועכשיו
            25" הוא בדיוק סוג ההפתעה שמייצרת פנייה לתמיכה, והמקום
            היחיד שבו היא נמנעת הוא המקום שבו מסתכלים על המספר.
          */}
          {expiry !== null && expiry.nextAt !== undefined ? (
            <p
              className="m-0 mt-1.5 text-[length:var(--type-caption)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {expiry.nextAmount} מהם פגים ב-
              {formatDate(expiry.nextAt)}. קרדיטים
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
              <h3 className="mb-2 mt-4 text-[length:var(--type-button)] font-semibold">
                <IconUpload s={15} /> ההפניות שפרסמתי
              </h3>
              <ul className="mv-net-grid mb-5">
                {myReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card mv-net-card--mine">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar">
                        <IconUpload s={20} />
                      </span>
                      <h4 className="mv-net-title">
                        {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent}
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
                      <ReferralConfirmation
                        sharedLeadId={lead.id}
                        role="referrer"
                        declared={lead.clientScores}
                        confirmation={lead.confirmation}
                      />
                    ) : (
                      <div className="mt-2">
                        <ClientScoresView
                          title="ההצהרה שלכם על הלקוח"
                          scores={lead.clientScores}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {receivedReferrals.length > 0 ? (
            <>
              <h3 className="mb-2 text-[length:var(--type-button)] font-semibold">
                <IconDownload s={15} /> הפניות שקלטתי
              </h3>
              <ul className="mv-net-grid mb-5">
                {receivedReferrals.map((lead) => (
                  <li key={lead.id} className="mv-net-card">
                    <div className="mv-net-head">
                      <span className="mv-net-avatar">
                        <IconDownload s={20} />
                      </span>
                      <h4 className="mv-net-title">
                        {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent}
                        {lead.city ? ` · ${lead.city}` : ""}
                      </h4>
                      <span className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> עמלת הפניה: {lead.priceCredits} קרדיטים
                      </span>
                    </div>
                    <p
                      className="mb-0 mt-1 text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      סיבת ההפניה: {referralReasonLabel(lead.reason)}
                      {lead.reasonDetail ? ` — ${lead.reasonDetail}` : ""}
                    </p>
                    {/* האישור כאן הוא מה שבונה את המוניטין שהלוח מציג */}
                    <ReferralConfirmation
                      sharedLeadId={lead.id}
                      role="receiver"
                      declared={lead.clientScores}
                      confirmation={lead.confirmation}
                      onSaved={() => load()}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {myReferrals.length > 0 || receivedReferrals.length > 0 ? (
            <h3 className="mb-2 text-[length:var(--type-button)] font-semibold">
              <IconGlobe s={15} /> הפניות פתוחות ברשת
            </h3>
          ) : null}
          <ul className="mv-net-grid">
            {openReferrals.map((lead) => (
              <li key={lead.id} className="mv-net-card">
                <div className="mv-net-head">
                  <span className="mv-net-avatar">
                    <IconUsers s={20} />
                  </span>
                  <h4 className="mv-net-title">
                    {labelOf(LEAD_INTENT_LABELS, lead.intent) ?? lead.intent}
                    {lead.city ? ` · ${lead.city}` : ""}
                  </h4>
                  <span className="mv-net-chip">
                    <IconSend s={14} />{" "}
                    {/*
                      ‎**בלוח ההפניות אין פירוט מקור, בכוונה** (ביקורת
                      Codex, P2). ‏`SharedLead` הוא **פרסום** בין
                      משרדים: כל שדה בו נבחר להיחשף — עיר, הערה, סיבה
                      ופירוטה. ‎`sourceNote` הוא רישום פנימי שהסוכן
                      כתב לעצמו, ולהעביר אותו למשרד אחר בלי שהוא בחר
                      לפרסם אותו זו הכרעת פרטיות ולא השלמת פיצ׳ר.
                      לכן כאן מוצג „אחר”, וזו גם התשובה הכנה: הליד
                      הגיע מערוץ שאינו ברשימה.
                    */}
                    {leadSourceText(lead.source)}
                  </span>
                  <span className="mv-net-chip mv-net-chip--money">
                    <IconCoins s={14} /> עמלת הפניה: {lead.priceCredits} קרדיטים
                  </span>
                  {/*
                    המוניטין של המשרד המפנה, ליד המחיר ולא בעמוד אחר:
                    התמורה נגבית גם אם לא ייסגר דבר, וזה המידע שקובע
                    אם כדאי לשלם אותה.
                  */}
                  <span
                    className="mv-net-chip"
                    title="כמה ההצהרות של המשרד הזה התאמתו אצל מי שקלט ממנו — לא כמה הלקוחות שלו טובים"
                  >
                    <IconStar s={14} />{" "}
                    {describeReferralRating(
                      lead.referrerRating?.average ?? null,
                      lead.referrerRating?.count ?? 0,
                    )}
                  </span>
                </div>
                {/*
                  הפירוט מתחת לשורת הצ'יפים ולא בתוכה: הוא ארבעה
                  ערכים, ובתוך שורה שכבר נושאת מחיר, עיר וכוונה הוא
                  היה נבלע בדיוק במקום שבו הוא אמור להאט את הקריאה.
                */}
                <ReferrerAccuracyBreakdown
                  dimensions={lead.referrerRating?.dimensions ?? []}
                />
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
                {/*
                  ההצהרה **מעל כפתור הקליטה**, לא מתחתיו ולא בעמוד
                  אחר. העמלה נגבית ברגע הלחיצה ואין החזרים, ולכן זה
                  המידע היחיד שאסור שיידרש בשבילו עוד קליק.
                */}
                <div className="mb-2">
                  <ClientScoresView
                    title="המשרד המפנה מצהיר על הלקוח"
                    scores={lead.clientScores}
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={buyingLead !== null}
                  onClick={() => void buyLead(lead.id, lead.priceCredits)}
                >
                  {buyingLead === lead.id
                    ? "קולט…"
                    : `קלוט את ההפניה (עמלה ${lead.priceCredits} קרדיטים)`}
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

        </div>
      ) : null}
    </>
  );
}
