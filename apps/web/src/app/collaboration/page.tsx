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
  commissionSplitOptionsWith,
  publisherStatedSplit,
  describeReferralRating,
  formatIsraeliNumber,
  presentationChips,
  presentationDetailRows,
  referralReasonLabel,
  shekels,
  type CommissionTerms,
  type PayoutMode,
  labelOf,
  FOLLOW_EMPTY_NOTE,
  FOLLOW_EMPTY_TITLE,
} from "@metavchim/shared";
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
  IconCheck,
  IconClock,
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
import { EntityTabs } from "../entity-tabs";
import { CollaborationGuide, ReferralRulesPanel } from "./guide";
import { FollowButton } from "./follow-button";
import { NetworkHeader, type NetworkSummary } from "./network-header";
import { ReachBanner } from "./reach-banner";
import { DealsList } from "./deals-list";
import { NetChips } from "./net-chips";
import {
  bestMatchScore,
  NetFacts,
  NetHero,
  NetMatchBadge,
  NetMatchStrip,
  NetMeta,
  NetMoney,
  NetDetailsButton,
  NetNoMatch,
  NetOfficeHead,
  NetPhotos,
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
   * ‎**הצד השני של „הצעות שקיבלתי”, ולא היה לו מסך.**
   *
   * ‏מתווך ששלח הצעה על ביקוש ברשת לא ראה אותה יותר לעולם: היא
   * נשלחה, והמסך חזר לפיד. מה הצעתי, למי, באיזו חלוקה, והאם הצד
   * השני בכלל ענה — כל זה היה קיים ב-`/collaboration/offers` עם
   * ‎`direction: "outgoing"` ופשוט לא הוצג באף מקום.
   */
  ["sent", "הצעות ששלחתי", IconUpload],
  /*
   * הלשונית שסוגרת את הרשת: חיבור שאושר ממשיך כאן ולא בוואטסאפ.
   * היא יושבת אחרי "הצעות שקיבלתי" כי זה הסדר שבו הדברים קורים —
   * מציעים, מאשרים, עובדים.
   */
  ["deals", "עסקאות משותפות", IconHandshake],
];

/**
 * ‏שורת התקציר של רצועת ההתאמות — „2 קונים · הגבוה 94”.
 *
 * ‏הרצועה סגורה כברירת מחדל (כך בקובץ העיצוב), והשורה הזו היא מה
 * שמאפשר זאת: כמה יש, וכמה טובה הטובה שבהן. זו כל ההחלטה אם לפתוח,
 * ובלעדיה רצועה סגורה הייתה כותרת בלי מידע.
 */
function matchSummary(
  count: number,
  one: string,
  many: string,
  best: number | null,
): string {
  const what = count === 1 ? one : `${formatIsraeliNumber(count)} ${many}`;
  return best === null ? what : `${what} · ${count === 1 ? "ציון" : "הגבוה"} ${best}`;
}

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
  /** ‏האם אני עוקב אחרי הביקוש הזה — מצב שלי, לא של המשרד המפרסם. */
  following?: boolean;
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

/**
 * ‎**מה קרה להצעה ששלחתי.**
 *
 * ‏שלושה מצבים ושלושה צבעים, כי הצבע נקרא לפני המילה: ממתין
 * (ענבר), אושר (ירוק), נדחה (ניטרלי). „נדחה” בניטרלי ולא באדום —
 * זו תשובה עסקית ולא תקלה, והסיבה שהצד השני כתב נקראת לצידה.
 *
 * ‏הסטטוסים הם אלה שהשרת מחזיר: `"sent"` ממתין, `"interested"`
 * אושר, וכל השאר נדחה. אותה הבחנה בדיוק כמו בצד הנכנס.
 */
function SentOfferStatus({
  status,
  declineNote,
}: {
  status: string;
  declineNote?: string;
}): React.JSX.Element {
  if (status === "sent") {
    return (
      <span className="mv-pill mv-domain-amber flex items-center gap-1.5">
        <IconClock s={13} /> ממתין לתשובה
      </span>
    );
  }
  if (status === "interested") {
    return (
      <span className="mv-pill mv-domain-green flex items-center gap-1.5">
        <IconCheck s={13} /> אושר — הסוכנויות מחוברות
      </span>
    );
  }
  return (
    <span className="mv-pill mv-domain-neutral flex items-center gap-1.5">
      <IconX s={13} /> נדחה
      {declineNote === undefined ? "" : ` — „${declineNote}”`}
    </span>
  );
}

/**
 * ‎**כותרת קטע בפיד הביקושים.**
 *
 * ‏אריח, כותרת, שורת הסבר ומונה — אותה שפה כמו כותרות הכרטיסים
 * בשאר המערכת. המונה בקצה ולא בכותרת: „מתאימים לנכסים שלך (6)”
 * קורא את המספר כחלק מהשם, ובקצה הוא נקרא כמצב.
 */
/**
 * ‏כותרת של לשונית — אריח, שם, מונה, ומשפט אחד בקצה.
 *
 * ‏ארבע הלשוניות פתחו בכותרת `h2` חשופה מעל רשימה, ולכן כל אחת
 * נראתה כמו מסך אחר. בקובץ העיצוב כולן אותו כרטיס: אריח בצבע
 * הלשונית, השם, גלולת מונה, ובקצה השני משפט שאומר מה יש כאן.
 */
function CoopSection({
  id,
  tab,
  domain,
  tile,
  title,
  count,
  note,
  children,
}: {
  id: string;
  /** הלשונית שפותחת את הפאנל — ל-`aria-labelledby`. */
  tab: string;
  domain: string;
  tile: React.ReactNode;
  title: string;
  /** ‏„4 ממתינות לתשובה”. `undefined` = אין מה למנות. */
  count?: string;
  note: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={tab}
      className="mv-card mv-card--pad mb-[18px]"
    >
      <div className="mv-card-head">
        <span className={`mv-tile mv-tile--44 ${domain}`} aria-hidden="true">
          {tile}
        </span>
        <h2 className="mv-card-head__title">{title}</h2>
        {count === undefined ? null : (
          <span className={`mv-pill ${domain}`}>{count}</span>
        )}
        <p className="mv-card-head__note">{note}</p>
      </div>
      {children}
    </section>
  );
}

function DemandSection({
  id,
  icon,
  title,
  subtitle,
  count,
  domain,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count: number;
  /** ‏הקטע שאפשר לפעול עליו נצבע; השאר ניטרלי. */
  domain: "violet" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-6" aria-labelledby={`${id}-heading`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className={`mv-tile mv-tile--44 mv-domain-${domain}`} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={`${id}-heading`}
            className="m-0 text-[length:var(--type-panel)] font-extrabold"
          >
            {title}
          </h2>
          <p
            className="m-0 mt-0.5 text-[length:var(--type-caption-lg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            {subtitle}
          </p>
        </div>
        {/* ‏„1 ביקושים” אינו עברית — יחיד מקבל את הצורה שלו */}
        <span className={`mv-pill mv-domain-${domain}`}>
          {count === 1 ? "ביקוש אחד" : `${count} ביקושים`}
        </span>
      </div>
      {children}
    </section>
  );
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
  /*
    ‏אילו כרטיסי נכס פתחו את בורר „בקש שיתוף”. מפה ולא `<details>`:
    הכפתור שפותח אותו יושב בתחתית הכרטיס והבורר מעליו, ו-`<details>`
    מחייב שהמפעיל יהיה בתוכו.
  */
  const [askOpen, setAskOpen] = useState<Record<string, boolean>>({});
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
  const myDemands = demands === null ? null : demands.filter((d) => d.mine);
  const actionableCount = matchedDemands === null ? null : matchedDemands.length;

  /**
   * ‎**המספר שעל תת-הלשונית.** `null` = טרם נטען, וזה אינו אפס.
   *
   * ‏שלוש התת-לשוniות הן שלושה כיוונים של אותה רשת, ובלי מספר על
   * אף אחת מהן צריך ללחוץ על כל אחת כדי לדעת אם יש בה משהו. הספירה
   * מהשרת ולא מהפיד: הפיד חסום במאה שורות.
   */
  const subtabCount = (key: CoopTabKey): number | null => {
    if (netSummary === null) return null;
    if (key === "demands") return netSummary.demands;
    if (key === "listings") return netSummary.listings;
    return netSummary.referrals;
  };

  const incoming = coopOffers.filter((o) => o.direction === "incoming");
  /* ‏מה שאני שלחתי — אותה רשימה, הכיוון ההפוך */
  const outgoing = coopOffers.filter((o) => o.direction === "outgoing");
  /* ‏המונה סופר את מה שעוד פתוח: הצעה שכבר נענתה אינה מטלה */
  const awaitingReply = outgoing.filter((o) => o.status === "sent").length;
  /* פניות שטרם נענו — הן שקובעות את המונה על הלשונית */
  const openInterests = interests.filter((i) => i.status === "sent");
  const openReferrals = sharedLeads.filter(
    (l) => l.role === "viewer" && l.status === "active",
  );
  const myReferrals = sharedLeads.filter((l) => l.role === "referrer");
  /* מה שקלטתי — כאן הוא מדורג, וכאן רואים מה הצד השני אמר */
  const receivedReferrals = sharedLeads.filter((l) => l.role === "receiver");

  /**
   * ‎**רשימת ביקושים אחת — נקראת שלוש פעמים.**
   *
   * ‏המסך מציג עכשיו שלוש קבוצות: מה שיש לי נכס עבורו, מה שאין,
   * ומה שאני פרסמתי. הכרטיס עצמו זהה בשלושתן — אותם צ׳יפים, אותו
   * חיסיון, אותן פעולות — ולכן הוא נכתב פעם אחת. שלושה עותקים של
   * הבלוק הזה היו נפרדים בעדכון הראשון, ובדיוק בשדה שאסור לו
   * להיפרד: מה מוצג ומה לא.
   */
  const demandList = (rows: DemandRow[]): React.JSX.Element => (
    <ul className={netView === "rows" ? "mv-net-rows" : "mv-net-grid"}>
      {rows.map((demand) => {
        /*
          הכרטיס נבנה מרשימת התגיות ולא מה-DTO: זהו אותו מקור אחד
          שמחליט מה מוצג ומה לעולם לא
          (`packages/shared/logic/network-card.ts`), ומסלול שני היה
          עוקף אותו — כלומר מוציא את החיסיון מהמקום שנבנה כדי לשמור
          עליו.
        */
        const split = splitNetworkChips(demandChips(demand));
        const place = split.place === "" ? demandArea(demand) : split.place;
        const title = `קונה מחפש ${roomsLabel(demand.roomsMin, demand.roomsMax)}`;
        const best = bestMatchScore(demand.myMatches);
        const matches = demand.myMatches ?? [];

        /*
          ‎**„להציע נכס אחר” — ליד ההצעה, לא בתחתית הכרטיס.**

          בקובץ העיצוב תחתית הכרטיס היא מזהה ושתי גלולות, ותו לא.
          הבורר הזה אינו פעולה שלישית אלא הגרסה הידנית של אותה
          פעולה בדיוק — „הצע נכס” — ולכן מקומו לצידה: בתוך רצועת
          ההתאמות כשיש התאמות, ומיד אחרי „אין התאמה” כשאין. הוא
          נשאר מקופל, כי המסלול הרגיל הוא ההתאמה שהמערכת מצאה.
        */
        const offerMore = (
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
        );

        return (
          <li
            key={demand.id}
            className={`mv-net-card ${
              best === null ? "mv-domain-neutral" : "mv-domain-violet"
            }${demand.mine ? " mv-net-card--mine" : ""}`}
          >
            <div className="mv-net-top">
              {/*
                ‏מי פרסם — ראשון, ובעיגול. ההחלטה אם בכלל לקרוא
                מודעה נופלת על שם המשרד, וכצ'יפ בין צ'יפים הוא היה
                פרט אחרון.
              */}
              {demand.officeName ? (
                <NetOfficeHead
                  name={demand.officeName}
                  place={place}
                  {...(demand.officeLogoUrl === undefined
                    ? {}
                    : { logoUrl: demand.officeLogoUrl })}
                />
              ) : (
                <span />
              )}
              {demand.mine ? (
                <span className="mv-net-badge mv-net-badge--quiet">
                  <IconStar s={14} /> הביקוש שלך
                </span>
              ) : (
                <NetMatchBadge score={best} label="נכס" domain="mv-domain-violet" />
              )}
            </div>

            <NetHero
              title={title}
              /*
                האזור נופל לאזורי המפה כשאין ערים: קונה שסימן אזור
                ולא הקליד עיר הופיע כ„קונה מחפש 4 חדרים ב” — משפט
                קטוע שאינו אומר לאן להציע.
              */
              subtitle={[place, split.subtitle].filter((part) => part !== "").join(" · ")}
              aside={
                <>
                  {demand.mine && demand.originBuyerId !== undefined ? (
                    /*
                      הביקוש שלנו ⟵ הכרטיס שממנו הוא נגזר. מי שרואה
                      מודעה שלו ורוצה לתקן דרישה צריך להגיע לכרטיס,
                      לא לחפש אותו ברשימת הקונים לפי הזיכרון.
                    */
                    <Link
                      href={`/buyers/${demand.originBuyerId}`}
                      className="mv-net-chip mv-net-chip--primary"
                      style={{ textDecoration: "none" }}
                    >
                      <IconUsers s={14} /> פתח את הכרטיס
                    </Link>
                  ) : null}
                  {/*
                    מקור חיצוני בתשלום, לפי העלות שהשרת החזיר ולא לפי
                    שם ספק שכתוב בקוד. השוואה מפורשת ל-"kanko" הסתירה
                    כל מקור שהפלטפורמה תמחרה מאז.
                  */}
                  {demand.creditsCost > 0 ? (
                    <>
                      <span className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> {demand.creditsCost} קרדיטים
                      </span>
                      <span
                        className="mv-net-chip"
                        title="ביקוש שהגיע ממקור חיצוני בתשלום"
                      >
                        <IconGlobe s={14} /> {demand.sourceLabel}
                      </span>
                    </>
                  ) : null}
                </>
              }
            />
            {split.money === undefined ? null : (
              <NetMoney label="תקציב" value={split.money.text} />
            )}
            <NetFacts facts={split.facts} />
            <NetSay label="הערות חשובות" text={demand.notes} />

            {demand.mine ? null : matches.length > 0 ? (
              /* המערכת מחשבת אילו מהנכסים שלי מתאימים — במקום לבחור
                 מרשימה של עשרות ולבזבז קרדיט על ניחוש */
              <NetMatchStrip
                count={matches.length}
                title="הנכסים שלך שמתאימים"
                summary={matchSummary(matches.length, "נכס אחד", "נכסים", best)}
                domain="mv-domain-violet"
                icon={<IconHome s={16} />}
              >
                {/*
                  גם כאן, ולא רק ליד הבורר: „הצע נכס זה” שולח בלחיצה
                  אחת, ובלי הבורר מולו הוא שולח את **ברירת המחדל**.
                  כשהמשרד המפרסם ניסח את חלוקתו במילים, זהו אחוז שאיש
                  לא ביקש — והמסך חייב לומר זאת לפני הלחיצה, לא אחריה.
                */}
                <ProposedSplitNote terms={demand.terms} kind="buyer" />
                  <ul className="flex list-none flex-col gap-2 p-0">
                    {matches.map((match) => (
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
              </NetMatchStrip>
            ) : (
              <NetNoMatch what={FOLLOW_EMPTY_TITLE} hint={FOLLOW_EMPTY_NOTE} />
            )}

            {/*
              ‏אותו טעם כמו בכרטיס הנכס: הבורר יושב מחוץ לרצועה
              הסגורה. בתוכה הוא היה מגיע רק אחרי פתיחה שלה, כלומר
              המסלול הידני להצעת נכס נעלם ממי שלא ידע לחפש אותו.
            */}
            {demand.mine ? null : offerMore}

            {/*
              ‏תחתית הכרטיס: המזהה בשורה משלו, ומתחתיו שתי גלולות
              שוות — „כל הפרטים” ו„עקוב אחרי הביקוש”. שוות ובכוונה:
              אלה שתי דרכים סבירות להמשיך, ולא פעולה ראשית ומשנית.

              ‎**המעקב בשני הענפים, לא רק בזה שאין בו התאמה.** הוא ישב
              בתוך „אין לכם נכס מתאים”, וברגע שנכנס נכס מתאים הכרטיס
              עבר לענף השני — כלומר מי שקיבל את ההתראה שביקש כבר לא
              יכול היה להפסיק לעקוב, והמעקב הנסתר המשיך לתפוס מקום
              במכסת ה-40 שלו (ביקורת Codex).
            */}
            <div className="mv-net-cardfoot">
              <NetMeta id={demand.id} />
              <div className="mv-net-actions">
                <NetDetailsButton
                  title={title}
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
                {demand.mine ? null : (
                  <FollowButton
                    demandId={demand.id}
                    following={demand.following === true}
                    onChanged={(following) => {
                      setDemands((current) =>
                        current === null
                          ? current
                          : current.map((row) =>
                              row.id === demand.id ? { ...row, following } : row,
                            ),
                      );
                    }}
                  />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );

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

      {/*
        שלוש לשוניות ולא מסך אחד ארוך.
        שני מנגנונים שונים חיו כאן יחד — שת"פ חינם והפניות לקוחות
        בתמורה — ומי שנחת על המסך לא ידע מה שייך למה. ההפרדה היא
        גם הפתרון לבלבול בקרדיטים: הם מופיעים בלשונית אחת בלבד.
      */}
      <Suspense fallback={null}>
        <TabFromQuery onTab={setCoopTab} />
      </Suspense>

      {/*
        ‎**גלולות נפרדות, והפעילה כהה** — אותה שפה של סרגלי הלשוניות
        בכרטיסי הישויות, ולפי קובץ העיצוב. מתג-מקטעים אחד (‏`mv-seg`)
        אמר „בחירה בתוך רשימה”, וזו אינה בחירה אלא מעבר בין ארבעה
        אזורים שאין ביניהם דבר משותף מלבד הרשת.
      */}
      <div className="mv-tabrow">
        <EntityTabs
          label="אזורי הרשת"
          active={coopTab}
          /*
            ‏„הרשת” פעילה בשלוש תת-הלשוניות. בלי זה מי שנמצא ברשימת
            הנכסים היה רואה סרגל בלי שום לשונית מסומנת.
          */
          isActive={(key) => (key === "network" ? isNetworkTab(coopTab) : coopTab === key)}
          idPrefix="coop-tab"
          panelPrefix="coop-panel"
          tabs={COOP_TABS.map(([key, label, Icon]) => ({
            key,
            label,
            icon: <Icon s={15} />,
            /*
              ‏„שקיבלתי” סופר את שני הכיוונים — הצעות על הביקושים שלי
              ופניות על הנכסים שלי יושבות באותה לשונית. „ששלחתי” סופר
              רק את מה שעוד ממתין לתשובה: הצעה שנענתה אינה מטלה,
              והמונה הוא רשימת מטלות.
            */
            ...(key === "incoming" ? { count: incoming.length + openInterests.length } : {}),
            ...(key === "sent" ? { count: awaitingReply } : {}),
          }))}
          onSelect={(key) =>
            setCoopTab(
              key === "network"
                ? isNetworkTab(coopTab)
                  ? coopTab
                  : "demands"
                : key,
            )
          }
        />
        {/*
          ‏ההסבר אינו לשונית ואינו מחליף אזור — הוא נפתח מעל המסך —
          ולכן הוא יושב מחוץ ל-`role="tablist"` ובאותה שורה, בקצה.
        */}
        <CollaborationGuide />
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
        <CoopSection
          id="coop-panel-incoming"
          tab="coop-tab-incoming"
          domain="mv-domain-green"
          tile={<IconMail s={20} />}
          title="הצעות שקיבלתי"
          /*
            מונה שמכריז על אפס הוא רעש: „0 ממתינות” מעל רשימה ריקה
            נראה כמו טעינה שנתקעה. הוא מופיע רק כשיש מה למנות.
          */
          {...(incoming.length + openInterests.length > 0
            ? { count: `${incoming.length + openInterests.length} ממתינות לתשובה` }
            : {})}
          note="משרד אחר מציע לך שיתוף על ביקוש או נכס שלך"
        >
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
              <li key={offer.id} className="mv-net-card mv-domain-green">
                {/* אותו פס עליון של כרטיסי הפיד: מי מציע, ומה מצב ההצעה */}
                <div className="mv-net-top">
                  <NetOfficeHead
                    name={offer.officeName ?? "משרד תיווך"}
                    place={offer.presentation.city ?? ""}
                  />
                  <span className="mv-pill mv-domain-green">
                    עמלה {describeCommissionSplit(offer.commissionSplit)}
                  </span>
                </div>
                <NetHero
                  title={offer.presentation.title ?? "נכס שהוצע לכם"}
                  aside={
                    /*
                      לאיזה קונה ההצעה — לא פרט שולי. משרד ששיתף חמישה
                      ביקושים קיבל חמש הצעות שנראו זהות, ולא ידע לאיזה
                      לקוח להתקשר.
                    */
                    offer.buyerId === undefined ? null : (
                      <Link
                        href={`/buyers/${offer.buyerId}`}
                        className="mv-net-chip mv-net-chip--primary"
                        style={{ textDecoration: "none" }}
                      >
                        <IconUser s={14} /> עבור {offer.buyerName}
                      </Link>
                    )
                  }
                />

                {/*
                  שני מקטעים עם כותרות (בקשת המשתמש): קודם תנאי
                  ההצעה — מי מציע ואיך נחלקת העמלה — ואז הנכס עצמו.
                  בלי ההפרדה הכרטיס נקרא כערימת תגיות אחת.
                */}
                {/* חלוקת העמלה והחשיפה המדורגת — לפני ההסכמה ולא אחריה */}
                <ul className="mv-net-chips">
                  <li className="mv-net-chip mv-net-chip--money">
                    <IconCoins s={14} /> העמלה שלי {100 - offer.commissionSplit}
                    % · למציע {offer.commissionSplit}%
                  </li>
                  <li className="mv-net-chip" title="חשיפה מדורגת">
                    <IconLock s={14} /> כתובת מדויקת ופרטי קשר — רק אחרי אישור
                  </li>
                </ul>

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
                      <span className="mv-net-actions w-full">
                        <button
                          type="button"
                          className="mv-net-act mv-net-act--go"
                          onClick={() => void respond(offer.id, "interested")}
                        >
                          <IconCheck s={15} /> אישור שיתוף
                        </button>
                        <button
                          type="button"
                          className="mv-net-act"
                          onClick={() => {
                            setDeclineText("");
                            setDeclining({ kind: "offer", id: offer.id });
                          }}
                        >
                          דחייה
                        </button>
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
                  <li key={interest.id} className="mv-net-card mv-domain-green">
                    {/* אותו פס עליון של כרטיסי הפיד: מי מציע, ובאיזו חלוקה */}
                    <div className="mv-net-top">
                      <NetOfficeHead name={interest.officeName ?? "משרד תיווך"} />
                      <span className="mv-pill mv-domain-green">
                        עמלה {describeCommissionSplit(interest.commissionSplit)}
                      </span>
                    </div>
                    {/*
                      הכותרת אומרת **על איזה נכס** ולא מה הקונה מחפש —
                      זה כבר בשורת התגיות מתחתיה, ואילו הנכס הוא מה
                      שמאפשר לזהות את הפנייה בשנייה.
                    */}
                    <NetHero
                      title={`קונה עבור „${interest.propertyTitle ?? "נכס שפרסמתם"}”`}
                      aside={
                        /* לאיזה נכס — משרד שפרסם חמישה נכסים קיבל חמש
                           פניות שנראו זהות, ולא ידע על מה מדובר */
                        interest.propertyId === undefined ? null : (
                          <Link
                            href={`/properties/${interest.propertyId}`}
                            className="mv-net-chip mv-net-chip--primary"
                            style={{ textDecoration: "none" }}
                          >
                            <IconHome s={14} /> פתח את הנכס
                          </Link>
                        )
                      }
                    />

                    <ul className="mv-net-chips">
                      <li className="mv-net-chip mv-net-chip--money">
                        <IconCoins s={14} /> העמלה שלי{" "}
                        {100 - interest.commissionSplit}% · למציע{" "}
                        {interest.commissionSplit}%
                      </li>
                      <li className="mv-net-chip" title="חשיפה מדורגת">
                        <IconLock s={14} /> שם הקונה ופרטי הקשר — רק אחרי אישור
                      </li>
                    </ul>

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
                          <span className="mv-net-actions w-full">
                            <button
                              type="button"
                              className="mv-net-act mv-net-act--go"
                              onClick={() =>
                                void respondToInterest(
                                  interest.id,
                                  "interested",
                                )
                              }
                            >
                              <IconCheck s={15} /> אישור שיתוף
                            </button>
                            <button
                              type="button"
                              className="mv-net-act"
                              onClick={() => {
                                setDeclineText("");
                                setDeclining({
                                  kind: "interest",
                                  id: interest.id,
                                });
                              }}
                            >
                              דחייה
                            </button>
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
        </CoopSection>
      ) : null}

      {/*
        ‎**„הצעות ששלחתי” — המסך שלא היה.**

        ‏אין כאן פעולות: ההחלטה בידי הצד השני, וכפתור „בטל הצעה” הוא
        מנגנון שאינו קיים בשרת. מה שכן צריך להיות כאן הוא התשובה
        לשאלה „מה שלחתי ומה קרה איתו” — הנכס, המשרד שקיבל, החלוקה
        שהצעתי, והסטטוס. עד עכשיו התשובה לא הייתה בשום מקום.
      */}
      {coopTab === "sent" ? (
        <CoopSection
          id="coop-panel-sent"
          tab="coop-tab-sent"
          domain="mv-domain-green"
          tile={<IconSend s={20} />}
          title="הצעות ששלחתי"
          {...(outgoing.length > 0 ? { count: `${outgoing.length} הצעות` } : {})}
          note="מעקב אחרי מה שהצעת למשרדים אחרים"
        >
          {offersFailed ? (
            <LoadError message="לא הצלחנו לטעון את ההצעות ששלחתם" onRetry={load} />
          ) : null}
          {outgoing.length === 0 && !offersFailed ? (
            /*
              ‏מצב ריק שאומר מה לעשות ולא „אין נתונים”: מי שנחת כאן
              מחפש הצעה ששלח, ואם אין — הצעד הבא הוא הפיד.
            */
            <div className="mv-card mv-card--pad text-center">
              <p className="m-0 text-base font-semibold">עוד לא שלחתם הצעה לרשת</p>
              <p
                className="m-0 mt-1 text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                בלשונית „הרשת” המערכת מסמנת אילו מהנכסים שלכם מתאימים לכל ביקוש —
                ומשם ההצעה נשלחת בלחיצה אחת.
              </p>
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => setCoopTab("demands")}
              >
                לקונים ברשת
              </Button>
            </div>
          ) : (
            <ul className="mv-net-lines" aria-label="הצעות ששלחתם על ביקושים ברשת">
              {outgoing.map((offer) => {
                /*
                  ‏אותו מסלול בדיוק כמו בכרטיסי הפיד: הצילום עובר דרך
                  ‎`presentationChips` ולא נקרא ישירות מה-DTO. בלי זה
                  סוג הנכס הופיע כ-`apartment` — הערך שבמסד ולא
                  התווית — כי הרשימה שממירה אותו יושבת שם.
                */
                const split = splitNetworkChips(presentationChips(offer.presentation));
                const what = offer.presentation.title ?? "הנכס שהצעתם";
                return (
                  <li key={offer.id} className="mv-net-line">
                    <span className="mv-net-office__avatar mv-domain-neutral" aria-hidden="true">
                      {(offer.officeName ?? what).trim().slice(0, 1)}
                    </span>
                    <span className="mv-net-line__main">
                      <span className="mv-net-line__title">
                        {/*
                          ‏למי שלחתי — הפרט שבלעדיו הרשימה אינה
                          שימושית. משרד ששלח חמש הצעות רואה חמש שורות
                          שנראות דומות, וזה מה שמבדיל ביניהן.
                        */}
                        {offer.officeName ? `הצעת ${what} ל${offer.officeName}` : `הצעת ${what}`}
                      </span>
                      <span className="mv-net-line__sub">
                        {[split.subtitle, split.place, split.money?.text]
                          .filter((part) => part !== undefined && part !== "")
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="mv-net-line__aside">
                      <span className="mv-net-line__meta">
                        עמלה {describeCommissionSplit(offer.commissionSplit)}
                      </span>
                      <SentOfferStatus
                        status={offer.status}
                        {...(offer.declineNote === undefined
                          ? {}
                          : { declineNote: offer.declineNote })}
                      />
                      <NetDetailsButton
                        title={what}
                        subtitle={split.subtitle}
                        {...(split.money === undefined ? {} : { money: split.money.text })}
                        moneyLabel="מחיר"
                        details={presentationDetailRows(offer.presentation)}
                        notesLabel="מה מיוחד בנכס"
                        id={offer.id}
                        {...(offer.officeName ? { officeName: offer.officeName } : {})}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CoopSection>
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
          {/*
            ‎**כיוון החיפוש והחיפוש עצמו — כרטיס אחד.**

            הם היו שני בלוקים נפרדים: פס תת-לשוניות באוויר, וכרטיס
            סינון מתחתיו. בפועל זו פעולה אחת — „מה אני מחפש, ואיפה” —
            וקובץ העיצוב מציג אותה כך: הכיוון למעלה, שדה החיפוש
            מתחתיו, באותה מסגרת.
          */}
          <div className="mv-card mv-card--pad mb-[18px]">
            <div
              className="mv-subtabs"
              role="tablist"
              aria-label="כיווני הרשת"
            >
              {NETWORK_SUBTABS.map(([key, label, Icon]) => {
                /*
                  ‏המספר הוא של כל הרשת ולא של מה שנטען: הפיד חסום
                  במאה שורות, וספירת הכרטיסים שעל המסך הייתה אומרת
                  „100” על רשת של 340. מ-`/collaboration/summary`,
                  אותו מקור שממנו האריחים בכרטיס הפתיחה.
                */
                const count = subtabCount(key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`coop-tab-${key}`}
                    aria-selected={coopTab === key}
                    aria-controls={`coop-panel-${key}`}
                    onClick={() => setCoopTab(key)}
                  >
                    <Icon s={16} /> {label}
                    {count === null ? null : (
                      <span className="mv-subtab-count">{formatIsraeliNumber(count)}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/*
              אותו סרגל סינון של מסכי הרשימה, ובכוונה אותו רכיב: מתווך
              שלמד לסנן נכסים לא צריך ללמוד מסנן שני. הניסוח מתחלף לפי
              הכיוון — לקונה יש **תקציב** ולנכס יש **מחיר**.

              ‏„הפניות ברשת” אינו פיד שמסננים אלא רשימת הלקוחות שעברו
              בין המשרדים, ולכן שם השורה אינה מוצגת.
            */}
            {coopTab === "market" ? null : (
              <div className="mt-3.5">
                <ListFilters
                  layout="inline"
                  values={netFilters}
                  onApply={setNetFilters}
                  searchLabel={
                    coopTab === "demands" ? "חיפוש בקונים ברשת" : "חיפוש בנכסים ברשת"
                  }
                  searchHint="חיפוש לפי עיר, סוג נכס או שם משרד"
                  priceLabel={coopTab === "demands" ? "תקציב" : "מחיר"}
                  /*
                    ‎**תצוגת הכרטיסיות/שורות ירדה מהפס העליון אל כאן.**
                    בקובץ העיצוב שורת הכיוונים נקייה, והמתג הוא העדפת
                    תצוגה ולא כיוון חיפוש — מקומו ליד הסינון.
                  */
                  view={
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
                  }
                />
              </div>
            )}
          </div>

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
                <>
                  {/*
                    ‎**שתי קבוצות, ולא רשימה אחת.**

                    ‏עד עכשיו כל הביקושים ישבו ברשימה אחת, ומתווך היה
                    צריך לפתוח כרטיס אחרי כרטיס כדי לגלות באילו מהם
                    יש לו מה להציע. ההפרדה עושה את זה בעין: למעלה מה
                    שאפשר לפעול עליו עכשיו, למטה מה ששווה לעקוב
                    אחריו.
                  */}
                  <DemandSection
                    id="coop-matched"
                    icon={<IconTarget s={18} />}
                    title="מתאימים לנכסים שלך"
                    subtitle="ביקושים ממשרדים אחרים שהמערכת הצליבה מול המאגר שלך"
                    count={matchedDemands?.length ?? 0}
                    domain="violet"
                  >
                    {matchedDemands === null || matchedDemands.length === 0 ? (
                      <p
                        className="m-0 text-[length:var(--type-body)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        אין כרגע ביקוש ברשת שיש לכם נכס מתאים עבורו. הקטע שמתחת
                        מראה את שאר הביקושים — אפשר לעקוב אחריהם.
                      </p>
                    ) : (
                      demandList(matchedDemands)
                    )}
                  </DemandSection>

                  {unmatchedDemands === null || unmatchedDemands.length === 0 ? null : (
                    <DemandSection
                      id="coop-unmatched"
                      icon={<IconList s={18} />}
                      title="עוד ביקושים ברשת"
                      subtitle="אין להם התאמה במאגר שלכם כרגע — שווה מעקב אם ייכנס נכס מתאים"
                      count={unmatchedDemands.length}
                      domain="neutral"
                    >
                      {demandList(unmatchedDemands)}
                    </DemandSection>
                  )}

                  {/*
                    ‏הביקושים שלי בקטע נפרד ולא מעורבבים: „אין לכם נכס
                    מתאים” על ביקוש שאני עצמי פרסמתי הוא משפט חסר
                    מובן, והפעולה שלו אחרת לגמרי — לפתוח את כרטיס
                    הקונה, לא להציע.
                  */}
                  {myDemands === null || myDemands.length === 0 ? null : (
                    <DemandSection
                      id="coop-mine"
                      icon={<IconStar s={18} />}
                      title="הביקושים שלכם ברשת"
                      subtitle="מה שפרסמתם — כך משרדים אחרים רואים אותו"
                      count={myDemands.length}
                      domain="neutral"
                    >
                      {demandList(myDemands)}
                    </DemandSection>
                  )}
                </>
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
                  {listings.map((listing) => {
                    /* אותה בנייה בדיוק כמו בכרטיס הביקוש — מרשימת
                       התגיות המשותפת, ולא מה-DTO */
                    const split = splitNetworkChips(presentationChips(listing));
                    const place =
                      split.place === ""
                        ? [listing.city, listing.neighborhood].filter(Boolean).join(" · ")
                        : split.place;
                    const title = listing.title ?? `נכס ב${listing.city ?? "רשת"}`;
                    const best = bestMatchScore(listing.myMatches);
                    const matches = listing.myMatches ?? [];

                    /*
                      ‏„להציע קונה אחר” — ליד ההצעה ולא בתחתית הכרטיס,
                      מאותו טעם בדיוק כמו בצד הביקושים.
                    */
                    const askMore =
                      listing.interestSent || askOpen[listing.id] !== true ? null : (
                  <div className="mv-net-ask" id={`ask_${listing.id}`}>
                    <p className="m-0 mb-2 text-[length:var(--type-caption-lg)] font-bold">
                      בקשת שיתוף — בחרו קונה וחלוקת עמלה
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
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
                  </div>
                    );

                    return (
                    <li
                      key={listing.id}
                      className={`mv-net-card ${
                        best === null ? "mv-domain-neutral" : "mv-domain-blue"
                      }${listing.mine ? " mv-net-card--mine" : ""}`}
                    >
                            <div className="mv-net-top">
                              {/* מי פרסם — שם המשרד ולוגו; הבעלים נשאר חסוי */}
                              {listing.officeName ? (
                                <NetOfficeHead
                                  name={listing.officeName}
                                  place={place}
                                  {...(listing.officeLogoUrl === undefined
                                    ? {}
                                    : { logoUrl: listing.officeLogoUrl })}
                                />
                              ) : (
                                <span />
                              )}
                              {listing.mine ? (
                                <span className="mv-net-badge mv-net-badge--quiet">
                                  <IconStar s={14} /> הנכס שלך
                                </span>
                              ) : (
                                /* אותו תג בדיוק כמו בצד הקונים — כאן
                                   הוא סופר קונים שלי ולא נכסים שלי */
                                <NetMatchBadge score={best} label="קונה" domain="mv-domain-blue" />
                              )}
                            </div>

                            <NetHero
                              title={title}
                              subtitle={[
                                split.subtitle,
                                ...split.rest.slice(0, 2).map((chip) => chip.text),
                              ]
                                .filter((part) => part !== "")
                                .join(" · ")}
                              aside={
                                listing.mine && listing.originPropertyId !== undefined ? (
                                  /* הקישור לנכס נחשף רק לסוכנות המקור */
                                  <Link
                                    href={`/properties/${listing.originPropertyId}`}
                                    className="mv-net-chip mv-net-chip--primary"
                                    style={{ textDecoration: "none" }}
                                  >
                                    <IconHome s={14} /> פתח את הכרטיס
                                  </Link>
                                ) : null
                              }
                            />
                            <NetPhotos
                              photos={listing.photos ?? []}
                              alt={title}
                            />
                            {split.money === undefined ? null : (
                              <NetMoney label="מחיר מבוקש" value={split.money.text} />
                            )}
                            <NetFacts facts={split.facts} />
                            <NetSay label="מה מיוחד בנכס" text={listing.notes} />

                            {listing.mine ? null : listing.interestSent ? (
                              <div className="mv-net-nomatch" role="note">
                                <b className="mv-net-nomatch__head">
                                  <IconCheck s={16} /> כבר פניתם על הנכס הזה
                                </b>
                                <span className="mv-net-nomatch__hint">
                                  התשובה תגיע ללשונית „הצעות שקיבלתי”.
                                </span>
                              </div>
                            ) : matches.length > 0 ? (
                              <NetMatchStrip
                                count={matches.length}
                                title="הקונים שלך שמתאימים"
                                summary={matchSummary(matches.length, "קונה אחד", "קונים", best)}
                                domain="mv-domain-blue"
                                icon={<IconUser s={16} />}
                              >
                                {/* אותו נימוק בדיוק כמו בצד ההצעה על ביקוש */}
                                <ProposedSplitNote terms={listing.terms} kind="property" />
                  <ul className="flex list-none flex-col gap-2 p-0">
                    {matches.map((match) => (
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
                              </NetMatchStrip>
                            ) : (
                              <>
                                <NetNoMatch
                                  what="אין לכם עדיין קונה שמתאים לנכס הזה"
                                  hint="אפשר לפנות עם כל קונה אחר מהרשימה שלמטה — או לחזור כשייקלט קונה מתאים"
                                />
                              </>
                            )}

                            {/*
                              ‎**הבורר מחוץ לרצועה, לא בתוכה.**

                              הוא ישב בתוך `NetMatchStrip`, והרצועה סגורה
                              כברירת מחדל — כלומר „בקש שיתוף” הדליק
                              ‎`aria-expanded` ושום דבר לא הופיע על המסך
                              (ביקורת Codex). הפעולה שהכפתור מבטיח חייבת
                              להיות במקום שאינו תלוי במצב של רכיב אחר.
                            */}
                            {askMore}

                            <div className="mv-net-cardfoot">
                              <NetMeta id={listing.id} />
                              <div className="mv-net-actions">
                                <NetDetailsButton
                                  title={title}
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
                                {listing.mine ? null : listing.interestSent ? (
                                  <span className="mv-net-act mv-net-act--on">
                                    <IconCheck s={15} /> כבר פניתם
                                  </span>
                                ) : (
                                  /*
                                    ‏„בקש שיתוף” — הפעולה שהמסך קיים
                                    בשבילה, ולכן היא זו שמקבלת מילוי.
                                    היא פותחת את הבורר שמעל תחתית
                                    הכרטיס במקום להיות עוד קישור קטן
                                    בתוכו.
                                  */
                                  <button
                                    type="button"
                                    className="mv-net-act mv-net-act--go"
                                    aria-expanded={askOpen[listing.id] === true}
                                    aria-controls={`ask_${listing.id}`}
                                    onClick={() =>
                                      setAskOpen((prev) => ({
                                        ...prev,
                                        [listing.id]: prev[listing.id] !== true,
                                      }))
                                    }
                                  >
                                    <IconPlus s={15} /> בקש שיתוף
                                  </button>
                                )}
                              </div>
                            </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}

      {coopTab === "market" ? (
        <CoopSection
          id="coop-panel-market"
          tab="coop-tab-market"
          domain="mv-domain-green"
          tile={<IconHandshake s={20} />}
          title="הפניות ברשת"
          {...(netSummary === null || netSummary.referrals === 0
            ? {}
            : { count: `${formatIsraeliNumber(netSummary.referrals)} הפניות` })}
          note="לקוחות שהופנו אליך או ממך למשרד אחר, עם דמי ההפניה שנקבעו"
        >
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
        </CoopSection>
      ) : null}

        </div>
      ) : null}
    </>
  );
}
