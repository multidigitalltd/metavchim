"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  use,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  describeEntry,
  labelOf,
  propertyEvaluableCriteria,
  PropertyStatusSchema,
  type MatchCriterion,
  type OccupancyState,
  type PropertyFields,
  type PropertyStatus,
  type ScoreComponent,
} from "@metavchim/shared";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import {
  formatDate,
  formatPrice,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { MatchExplanation } from "../../match-explanation";
import {
  MatchesEmptyState,
  matchGateMissing,
  outOfMarket,
  propertySideOnlyMissing,
} from "../matches-empty-state";
import { useFeature } from "@/lib/use-features";
import { ReadinessCard } from "./readiness-card";
import { DetailsCard, type DetailField } from "./details-card";
import { PropertyTimeline } from "./property-timeline";
import { MediaSection } from "./media-section";
import { PropertyTwins } from "./property-twins";
import { NetworkDemandMatches } from "../network-demand-matches";
import { NetworkShareSection } from "../../network-share-section";
import { AgreementsPanel } from "../../agreements-panel";
import { DocumentsPanel } from "../../documents-panel";
import { EntityTasks, type TaskListResponse } from "../../entity-tasks";
import { PropertyOwner, type OwnerContact } from "../property-owner";
import { OwnerActivity } from "./owner-activity";
import { PropertyOccupant, type OccupantContact } from "../property-occupant";
import { LocationPicker } from "../location-picker";
import { ExclusivityPanel } from "../exclusivity-panel";
import { EntityNotes } from "../../entity-notes";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
import { RelatedEntities } from "../../related-entities";
import { IconThumbUp, IconMap } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * כרטיס הנכס לפי קובץ העיצוב: כרטיס כותרת עם מחיר ופעולות (עריכה /
 * צור דף נחיתה / מצא לי קונים), ולוח דו-טורי — פרטי הנכס והקונים
 * המתאימים משמאל, מוכנות לשיווק ותמונות בטור הצדדי.
 */

interface PropertyDetail {
  id: string;
  city?: string;
  neighborhood?: string;
  street?: string;
  latitude?: number;
  longitude?: number;
  /** בארכיון — רק אז מוצגת מחיקה לצמיתות. */
  archived?: boolean;
  locationSource?: "pin" | "geocode";
  /*
   * ‎**הטיפוסים של החבילה, ולא `string`.**
   *
   * השרת מאמת את השדות האלה מול אותן סכמות בדיוק, ולכן `string`
   * כאן לא היה „זהירות” אלא ויתור: הוא אילץ `as` בכל מקום שנדרשה
   * המשמעות (ראו „כניסה / מסירה” למטה, שנשען על מצב הכניסה ולא רק
   * על קיומו), וכל `as` כזה הוא טענה על נתון שלא נבדקה.
   */
  propertyType?: PropertyFields["propertyType"];
  dealType?: PropertyFields["dealType"];
  entryType?: PropertyFields["entryType"];
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  priceAgorot?: number;
  entryDate?: string;
  entryNote?: string;
  internalNotes?: string;
  /*
   * ‎**הטיפוס מהחבילה, ולא `string`** — מאותו נימוק כמו מצב הכניסה
   * למעלה. בלעדיו מפת התוויות דורשת `as` על נתון שהגיע מה-API,
   * וזו טענה שלא נבדקה. עם הטיפוס, סטטוס חדש בסכמה נופל
   * בקומפילציה במפה ולא נשמט בשקט למסך.
   */
  status: PropertyStatus;
  marketingTitle?: string;
  readinessScore: number;
  missingFields: string[];
  ownerContact?: OwnerContact;
  /** מי גר בנכס כשזה אינו הבעלים — דירה שמושכרת בזמן שהיא מוצעת. */
  occupantContact?: OccupantContact;
  /**
   * ‎`undefined` = **טרם נסומן**, ולא „הבעלים גר בנכס”.
   *
   * ‎`apiGet` הוא הצהרת טיפוס ולא ולידציה, ולכן ההערה הזו היא מה
   * שמחזיק את ההבחנה: כל הנכסים שקדמו לשדה מגיעים חסרים, והנחת ערך
   * כאן הייתה ממציאה עובדה על כל המאגר בבת אחת.
   */
  occupancy?: OccupancyState;
  leaseEndsAt?: string;
  noticePeriodDays?: number;
  /** מתי הנכס נקלט — היה בשרת מאז ומתמיד ולא הוצהר כאן */
  createdAt: string;
}

interface MatchRow {
  id: string;
  buyerId: string;
  score: number;
  explanation: string;
  /** הפירוט לפי קריטריון — הבסיס לרצועת ההסבר מתחת לשורה. */
  breakdown: ScoreComponent[];
  status: string;
  buyerName: string | null;
  buyerMaturity: string | null;
}

interface OfferInfo {
  id: string;
  status: string;
  url: string;
  openCount: number;
}

const OFFER_STATUS_LABELS: Record<string, ReactNode> = {
  sent: "הצעה נשלחה",
  opened: "הקונה פתח את ההצעה",
  interested: (
    <>
      <IconThumbUp s={15} /> הקונה מעוניין!
    </>
  ),
  declined: "הקונה דחה",
};

/**
 * ‎**כל כפתורי סרגל הפעולות באותה מידה** — 44px, המינימום שהחבילה
 * אוכפת לשטח נגיעה, ו-`gap: 10px` ביניהם (SPEC-3a §2 שורה 2).
 *
 * קבוע ולא חמש הצהרות: הם ישבו קודם על `7px 13px` וריחפו סביב 33,
 * וכל אחד קיבל את המידה שלו בנפרד — כלומר גם כשאחד תוקן, האחרים
 * נשארו. שורה אחת שכולם קוראים ממנה אינה יכולה להתפצל.
 */
const HEADER_ACTION = {
  minHeight: 44,
  padding: "0 18px",
  fontSize: "var(--type-button)",
} as const;

/**
 * צבע התחום של סטטוס הנכס.
 *
 * „Color says WHAT KIND OF THING this is, never decoration”, ובמסמך
 * הכרטיס במפורש: „a draft listing is NEUTRAL, never amber”. טיוטה
 * אינה בעיה שממתינה לטיפול אלא נכס שטרם נפתח לשיווק, וענבר היה
 * צועק „דחוף” על מצב רגיל לחלוטין.
 *
 * ‎`active` הוא ירוק — נכס שמשווק עכשיו. `on_hold` ענבר: מצב
 * שממתין להחלטה, ולא דחיפות. אפרסק שמור ל„urgency: hot buyers,
 * leads, time-critical”, ונכס בהמתנה אינו אף אחד מהם — הוא פשוט
 * לא זז כרגע. `sold`/`rented` ניטרליים: העסקה נגמרה ואין בהם מה
 * לעשות.
 *
 * זה גם מה שהמסמך אומר בשלילה: „a draft listing is NEUTRAL, never
 * amber” נאמר על **טיוטה** דווקא, כלומר ענבר הוא הצבע שהיה מתבקש
 * למצב ממתין — והמסמך שולל אותו רק עבור המצב שאינו ממתין לכלום.
 */
const STATUS_DOMAIN: Record<string, { background: string; color: string }> = {
  draft: { background: "var(--domain-neutral-bg)", color: "var(--domain-neutral-fg)" },
  active: { background: "var(--domain-green-bg)", color: "var(--domain-green-fg)" },
  on_hold: { background: "var(--domain-amber-bg)", color: "var(--domain-amber-fg)" },
  sold: { background: "var(--domain-neutral-bg)", color: "var(--domain-neutral-fg)" },
  rented: { background: "var(--domain-neutral-bg)", color: "var(--domain-neutral-fg)" },
  archived: { background: "var(--domain-neutral-bg)", color: "var(--domain-neutral-fg)" },
};

/**
 * צ'יפי הסינון בלשונית ההתאמות (SPEC-4a §1).
 *
 * שלושת אלה ולא אחרים, כי שלוש השאלות שמתווך שואל מול רשימת התאמות
 * הן „מי הכי מתאים”, „למי עוד לא פניתי” ו„מי מוכן לקנות”. כל בורר
 * נוסף הוא בורר שצריך להחליט עליו.
 *
 * ‎`hot` **וגם** `very_hot` — „קונה חם” בעברית כולל את שניהם, ובורר
 * שהיה מחזיר רק את אחד מהם היה מסתיר בשקט בדיוק את הקונים החמים
 * ביותר.
 */
const MATCH_FILTERS: readonly {
  key: string;
  label: string;
  keep: (m: MatchRow, hasOffer: boolean) => boolean;
  /**
   * האם הבורר נשען על מצב ההצעות — שמגיע בבקשה נפרדת שעשויה
   * להיכשל. בורר כזה אינו זמין עד שהתשובה ידועה.
   */
  needsOffers?: boolean;
}[] = [
  { key: "score90", label: "ציון 90+", keep: (m) => m.score >= 90 },
  {
    key: "noOffer",
    label: "לא נשלחה הצעה",
    keep: (_m, hasOffer) => !hasOffer,
    needsOffers: true,
  },
  {
    key: "hot",
    label: "קונה חם",
    keep: (m) => m.buyerMaturity === "hot" || m.buyerMaturity === "very_hot",
  },
];

const MATURITY_TAG: Record<string, { fg: string; bg: string }> = {
  very_hot: { fg: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  hot: { fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  interested: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  not_ripe: { fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
};

/*
 * הרצועות מגיעות מ-`@/lib/readiness` ואינן מוגדרות כאן.
 *
 * היו כאן שני עותקים של אותם ספים — אחד במסך הזה ואחד ברשימת
 * הנכסים — ושניהם היו 85 ו-70. ברגע שהרשימה עברה לספים של
 * החבילה (90 ו-60), **אותו נכס בדיוק** היה מוצג ירוק במסך אחד
 * וענבר בשני, בלי שאיש שינה נתון. החבילה אוסרת זאת פעמיים
 * ובשני מסמכים: „Never three numbers for one listing”.
 */

export default function PropertyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  /*
   * הלשונית ומונה המשימות נקראים לפני כל `return` מוקדם — hook
   * שרץ אחריו הוא שגיאת React, והכרטיס מציג "טוען…" לפני שיש נכס.
   */
  const [tab, selectTab] = useEntityTab(
    [
      "overview",
      "matches",
      "twins",
      "network",
      "owner",
      "exclusivity",
      "agreements",
      "tasks",
    ],
    "overview",
  );
  const [openTasks, setOpenTasks] = useState<number | undefined>(undefined);
  /*
   * מונה הנכסים התואמים, כמו מונה המשימות: נטען כאן כדי שהמספר יופיע על
   * הלשונית **לפני** שנכנסים אליה — פאנל שאינו פעיל אינו מרונדר
   * כלל, ולכן לשונית שממתינה לילד שלה תישאר בלי מונה עד שילחצו
   * עליה. אחרי כניסה ללשונית הילד מדווח על כל שינוי, ולכן המספר
   * אינו מתיישן בהסרה או בהוספה.
   *
   * `undefined` = טרם ידוע, ואז אין מונה — ולא „0”.
   */
  const [twinCount, setTwinCount] = useState<number | undefined>(undefined);
  useEffect(() => {
    apiGet<{ id: string }[]>(`/properties/${id}/twins`)
      .then((rows) => setTwinCount(rows.length))
      .catch(() => setTwinCount(undefined));
  }, [id]);
  useEffect(() => {
    /*
     * הטיפוס מיובא ואינו נכתב כאן שוב: `apiGet<T>` הוא **הצהרה**
     * ולא אימות, ולכן צורה שנכתבת ביד בכל קורא מתיישנת בשקט
     * כשהשרת משתנה — וזה בדיוק מה שקרה כאן (ביקורת עצמית).
     */
    apiGet<TaskListResponse>(`/tasks/for/property/${id}`)
      .then((data) =>
        setOpenTasks(data.tasks.filter((t) => t.status === "open").length),
      )
      .catch(() => setOpenTasks(undefined));
  }, [id]);
  const canEditOwner = can(user, "properties.edit");
  // אנשי הקשר של הבעלים נאכפים ב-ContactsController תחת buyers.edit
  const canEditOwnerPeople = can(user, "buyers.edit");
  const canLanding = useFeature("landing_pages");
  const canWhatsApp = useFeature("whatsapp");
  const router = useRouter();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  /**
   * צ'יפי הסינון בלשונית ההתאמות (SPEC-4a §1).
   *
   * ‎**סינון מצטבר ולא בלעדי**: מי שבוחר „ציון 90+” וגם „לא נשלחה
   * הצעה” מתכוון לשניהם. בורר יחיד היה מחייב אותו לבחור איזו שאלה
   * חשובה יותר, וזו בדיוק ההחלטה שהוא רוצה לא לקבל.
   */
  const [matchFilters, setMatchFilters] = useState<Set<string>>(new Set());
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  /**
   * כמה כרטיסי אדם יירדו עם הנכס — `"loading"` עד שהתשובה חוזרת,
   * `"unknown"` כשהבדיקה עצמה נכשלה.
   *
   * שלושה מצבים ולא שניים, ומאותה סיבה שהבאנר של דף הנחיתה למד:
   * „כל מה שאינו מספר = אפס” היה מבטיח „לא יימחק אף כרטיס” בדיוק
   * כשלא ידענו.
   */
  const [purgeImpact, setPurgeImpact] = useState<number | "loading" | "unknown">(
    "loading",
  );
  /*
   * תשובה של בדיקה שכבר בוטלה לא תכתוב על המסך. אותו מונה בדיוק
   * שתיבת התמיכה נזקקה לו — לחיצה, ביטול, ולחיצה שנייה משאירים שתי
   * בקשות באוויר, והישנה עלולה לחזור אחרונה.
   */
  const purgeSeq = useRef(0);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  /*
   * „אין עדיין קונים מתאימים” + הזמנה להוסיף קונה, על תקלת רשת,
   * שולח את המתווך לעבוד במקום שבו כבר יש לו תשובה.
   */
  const [matchesFailed, setMatchesFailed] = useState(false);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
  /**
   * ‎**האם אנחנו כבר יודעים למי נשלחה הצעה.**
   *
   * ‎`offers` מתחיל ריק, והבקשה שממלאת אותו נכשלת בשקט
   * (`.catch(() => undefined)`). כלומר „אין הצעה” היה גם התשובה
   * הנכונה וגם מצב חוסר-הידיעה — ובורר „לא נשלחה הצעה” החזיר את
   * **כל** ההתאמות: זמנית בכל טעינה, ולצמיתות אחרי תקלה (ביקורת
   * Codex).
   *
   * זו אותה טעות שכל המסך הזה עוסק בה — „לא ידוע” שנקרא כ„לא” —
   * והפעם היא הייתה בבורר עצמו.
   *
   * ‎**שלושה מצבים ולא שניים**, מאותו נימוק: „עוד לא חזר” ו„נכשל”
   * נראים זהים למי שמסתכל על הבורר, אבל הראשון ייגמר מעצמו והשני
   * לא. תווית „טוען…” על תקלה קבועה היא הבטחה שלא תתממש.
   */
  const [offersState, setOffersState] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  /*
   * קישור ההצעה מועתק לפי התאמה, ולכן ההודעה נושאת את מזהה ההתאמה.
   * שתיהן בלי איפוס אוטומטי: הן יושבות בתוך שורה/באנר שנשארים על
   * המסך, והודעה שנעלמת משם נראית כאילו משהו התקלקל.
   */
  const offerClipboard = useCopy(0);
  const landingClipboard = useCopy(0);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  /** matchId ⟵ קישור חתימה, להתאמות שנחסמו בשער ההחתמה */
  const [awaitingSignature, setAwaitingSignature] = useState<
    Record<string, string>
  >({});
  const [landingUrl, setLandingUrl] = useState<string | null>(null);
  const [landingBusy, setLandingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * טעינת הנכס נשלפה מתוך ה-effect כדי שגם הוספת בעל נכס תוכל
   * לרענן אותה. עדכון מקומי של ה-state לא היה מספיק: השרת מחזיר
   * מזהה איש קשר שנוצר (או קיים), והרכיב של אנשי הקשר הנוספים
   * צריך אותו.
   */
  const loadProperty = useCallback((): void => {
    apiGet<PropertyDetail>(`/properties/${id}`)
      .then(setProperty)
      .catch(() => setError("הנכס לא נמצא"));
  }, [id]);

  /*
   * ההתאמות נטענות בפונקציה משלהן כדי שיהיה למה לחזור.
   * `LoadError` בלי `onRetry` מודיע על תקלה ולא נותן דרך לצאת
   * ממנה: האפקט לא ירוץ שוב כל עוד המתווך נשאר בכרטיס, ולכן
   * הדרך היחידה הייתה רענון העמוד כולו (ביקורת Codex).
   */
  /**
   * מצב ההצעות, בפונקציה משלו — **כדי שיהיה למה לחזור.**
   *
   * הבקשה נכשלה בשקט ובלי דרך לנסות שוב, ולכן „לא הצלחנו לטעון”
   * היה מצב סופי עד רענון העמוד כולו. אותו נימוק בדיוק שהוציא את
   * ‎`loadMatches` לפונקציה משלו.
   */
  const loadOffers = useCallback((rows: readonly MatchRow[]): void => {
    if (rows.length === 0) {
      /* אין התאמות — אין מה לדעת, וזו ידיעה מלאה ולא חוסר */
      setOffersState("ready");
      return;
    }
    setOffersState("loading");
    const ids = rows.map((m) => m.id).join(",");
    apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
      .then((rowsById) => {
        setOffers(rowsById);
        setOffersState("ready");
      })
      .catch(() => setOffersState("failed"));
  }, []);

  const loadMatches = useCallback((): void => {
    setMatchesFailed(false);
    apiGet<MatchRow[]>(`/properties/${id}/matches`)
      .then((rows) => {
        setMatches(rows);
        loadOffers(rows);
      })
      .catch(() => setMatchesFailed(true));
  }, [id, loadOffers]);

  useEffect(() => {
    if (authLoading) return;
    loadProperty();
    loadMatches();
  }, [authLoading, loadProperty, loadMatches]);

  async function createOffer(matchId: string) {
    try {
      const offer = await apiPost<OfferInfo & { matchId: string }>("/offers", {
        matchId,
      });
      setOffers((prev) => ({ ...prev, [matchId]: offer }));
      await offerClipboard.copy(offer.url, matchId);
    } catch (err: unknown) {
      /*
       * שער ההחתמה מוחזר כ-409 עם קישור לחתימה. בלי הטיפול הזה
       * הלחיצה נכשלה בשקט: המתווך לא ראה שגיאה, לא קיבל קישור,
       * ולא היה לו שום רמז מה לעשות — בזמן שהשרת כבר יצר עבורו את
       * ההסכם (ביקורת Codex).
       */
      const signUrl =
        err instanceof ApiError && err.body["code"] === "signature_required"
          ? String(err.body["signUrl"] ?? "")
          : "";
      if (signUrl) {
        setAwaitingSignature((prev) => ({ ...prev, [matchId]: signUrl }));
        return;
      }
      throw err;
    }
  }

  /** פותח וואטסאפ עם ההודעה והקישור מוכנים — המתווך רק לוחץ שלח (אפיון §10). */
  async function sendWhatsApp(offerId: string) {
    const { waUrl } = await apiPost<{ waUrl: string }>(
      `/offers/${offerId}/whatsapp`,
      {},
    );
    window.open(waUrl, "_blank", "noopener");
  }

  /** עדכון שיווק לבעל הנכס — משפך הנכס בהודעת וואטסאפ מוכנה לשליחה. */
  async function sendOwnerUpdate() {
    const { waUrl } = await apiPost<{ waUrl: string }>(
      `/properties/${id}/owner-update`,
      {},
    );
    window.open(waUrl, "_blank", "noopener");
  }

  /** דף נחיתה ציבורי לנכס — יצירת הקישור והעתקתו ללוח. */
  async function createLanding() {
    setLandingBusy(true);
    try {
      const { url } = await apiPost<{ url: string }>(
        `/properties/${id}/landing`,
        {},
      );
      setLandingUrl(url);
      await landingClipboard.copy(url);
    } finally {
      setLandingBusy(false);
    }
  }

  /** שינוי סטטוס (פעיל/בהמתנה/נמכר…) ישירות מהכרטיס — בלי להיכנס לעריכה. */
  async function changeStatus(status: PropertyStatus) {
    setStatusSaving(true);
    try {
      await apiPatch(`/properties/${id}`, { status });
      setProperty((prev) => (prev ? { ...prev, status } : prev));
    } finally {
      setStatusSaving(false);
    }
  }

  /** ארכוב בשני שלבים — לחיצה ראשונה מבקשת אישור, שנייה מבצעת. */
  async function archive() {
    if (!archiveConfirm) {
      setArchiveConfirm(true);
      return;
    }
    await apiDelete(`/properties/${id}`);
    router.replace("/properties");
  }

  /**
   * מחיקה לצמיתות — רק מנכס שכבר בארכיון, ובשני שלבים גם כאן.
   *
   * הארכיון הוא ברירת המחדל כי נכס שנמכר הוא היסטוריה עסקית; זה
   * הנתיב לנכס שנקלט בטעות או לכפילות. התמונות נמחקות איתו מהאחסון.
   *
   * ‎**ולפעמים גם כרטיס של אדם.** בעלים שהנכס הזה הוא העוגן היחיד
   * שלו אינו נגיש בשום מסך אחרי המחיקה, ולכן הוא נמחק איתה. מתווך
   * שמנקה כפילות אינו מתכוון למחוק אדם — לכן השאלה נשאלת בשרת בין
   * שתי הלחיצות, והתשובה מוצגת לפני השנייה.
   *
   * כשל בשליפת התצוגה המקדימה אינו חוסם את המחיקה — הוא אומר שלא
   * ידוע. „לא הצלחנו לבדוק” אינו „לא יימחק אף כרטיס”, וזה בדיוק
   * ההבדל שאסור לבלוע.
   */
  async function purge() {
    if (!purgeConfirm) {
      const mine = ++purgeSeq.current;
      setPurgeConfirm(true);
      setPurgeImpact("loading");
      try {
        const preview = await apiGet<{ contacts: number }>(
          `/properties/${id}/permanent/preview`,
        );
        if (purgeSeq.current === mine) setPurgeImpact(preview.contacts);
      } catch {
        if (purgeSeq.current === mine) setPurgeImpact("unknown");
      }
      return;
    }
    setPurgeError(null);
    try {
      await apiDelete(`/properties/${id}/permanent`);
      router.replace("/properties");
    } catch (err: unknown) {
      setPurgeError(err instanceof ApiError ? err.message : "המחיקה נכשלה");
      setPurgeConfirm(false);
    }
  }

  /** שליחה מרובה בשני שלבים — אישור מפורש לפני יצירת הצעות (אפיון §10). */
  async function bulkSend() {
    if (!bulkConfirm) {
      setBulkConfirm(true);
      return;
    }
    setBulkConfirm(false);
    const result = await apiPost<{
      created: number;
      awaitingSignature: { matchId: string; signUrl: string }[];
    }>("/offers/bulk", { propertyId: id, minScore: 85 });
    /*
     * לקוח שטרם חתם על הזמנה בכתב אינו דילוג — הוא הפעולה הבאה של
     * המתווך. בלי השורה הזו התוצאה הייתה "נוצרו 0 הצעות" בלי שום
     * רמז למה ומה עושים עכשיו (ביקורת Codex).
     */
    const waiting = result.awaitingSignature?.length ?? 0;
    setBulkResult(
      [
        result.created > 0
          ? `נוצרו ${result.created} הצעות — לחצו "שלח בוואטסאפ" על כל אחת`
          : "לא נוצרו הצעות חדשות",
        waiting > 0
          ? `${waiting} לקוחות ממתינים לחתימה על הזמנה בכתב — הקישור לחתימה מופיע בשורת ההתאמה שלהם`
          : "",
      ]
        .filter(Boolean)
        .join(". "),
    );
    setAwaitingSignature(
      Object.fromEntries(
        (result.awaitingSignature ?? []).map((row) => [
          row.matchId,
          row.signUrl,
        ]),
      ),
    );
    const rows = await apiGet<MatchRow[]>(`/properties/${id}/matches`);
    setMatches(rows);
    loadOffers(rows);
  }

  async function saveNotes(next: string): Promise<void> {
    await apiPatch(`/properties/${id}`, { internalNotes: next });
    setProperty((prev) => (prev ? { ...prev, internalNotes: next } : prev));
  }

  /**
   * ‎**מה שהנכס מסוגל להיבחן בו — כדי להבדיל „חסר בנכס” מ„הקונה
   * לא ביקש”.**
   *
   * קריטריון שנעדר מפירוט ההתאמה יכול להיות אחד משניים, והם
   * הפוכים: שדה ריק בנכס (יש מה לעשות) או דרישה שהקונה לא הגדיר
   * (אין מה לעשות, וההתאמה מלאה). ראו `propertyEvaluableCriteria`.
   *
   * ‎**וכאן, לפני ההחזרות המוקדמות, ולא ליד השימוש בו.**
   *
   * ‎`property` הוא `null` בטעינה הראשונה, והרכיב חוזר מוקדם
   * ב-`if (!property)`. הוק שיושב אחרי ההחזרה הזו **אינו נקרא**
   * ברינדור הראשון ונקרא בשני — „Rendered more hooks than during
   * the previous render”, כלומר קריסה של כרטיס הנכס בכל כניסה
   * ראשונה (ביקורת Codex). הסדר של ההוקים הוא חוזה, לא סגנון.
   *
   * ‎**הפיזור, ולא רשימת שדות ביד.** `{...property}` מעביר גם שדה
   * שיתווסף מחר לכרטיס; רשימה ידנית הייתה משמיטה אותו בשקט, והמסך
   * היה מכריז „חסר בנכס” על שדה מלא. רק `entryDate` מומר, כי ה-API
   * מחזיר מחרוזת והמנוע קורא תאריך.
   */
  const matchEvaluable = useMemo<ReadonlySet<MatchCriterion>>(() => {
    if (property === null) return new Set<MatchCriterion>();
    const { entryDate, ...rest } = property;
    const fields: PropertyFields = {
      ...rest,
      ...(entryDate !== undefined ? { entryDate: new Date(entryDate) } : {}),
    };
    return propertyEvaluableCriteria(fields);
  }, [property]);

  if (error) {
    return (
      <Notice tone="danger">{error} —{" "}
        <Link href="/properties" className="underline">
          חזרה לרשימה
        </Link></Notice>
    );
  }
  if (!property) return <p aria-live="polite">טוען…</p>;

  const address = [property.street, property.neighborhood, property.city]
    .filter(Boolean)
    .join(", ");
  const features = [
    property.hasElevator && "מעלית",
    property.hasParking && "חניה",
    property.hasBalcony && "מרפסת",
    property.hasSafeRoom && 'ממ"ד',
  ].filter(Boolean) as string[];

  /*
   * ‎`null` הוא החוסר, ולא המחרוזת "—".
   *
   * המקף הוא **תצוגה**, ומי שמחליט עליו הוא הכרטיס. אילו נכתב כאן,
   * לא היה אפשר להבדיל בין שדה שאין בו ערך לבין שדה שערכו הוא
   * במקרה מקף — וגם `data-empty`, שצובע את החוסר, היה צריך לנחש
   * לפי תוכן.
   */
  const detailFields: DetailField[] = [
    {
      label: "סוג",
      value: property.propertyType
        ? (PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType)
        : null,
    },
    {
      label: "חדרים",
      value: property.rooms !== undefined ? String(property.rooms) : null,
      ltr: true,
    },
    {
      label: "שטח",
      value: property.areaSqm ? `${property.areaSqm} מ"ר` : null,
      ltr: true,
    },
    {
      label: "קומה",
      value:
        property.floor !== undefined
          ? `${property.floor}${property.totalFloors ? ` מתוך ${property.totalFloors}` : ""}`
          : null,
      /*
       * ‎**לא `ltr`, אף שיש בה מספרים.** „3 מתוך 8” הוא ביטוי עברי
       * שמכיל ספרות, ובידודו ל-LTR היה הופך אותו ל„8 מתוך 3”.
       * הדגל שייך למספר עצמו, לא לכל דבר שיש בו ספרה.
       */
    },
    {
      label: "כניסה / מסירה",
      // מצב + תאריך + ההערה החופשית בשורה אחת; "מיידי" ו"גמיש" הם
      // תשובות ולא חוסר, ולכן אינם מוצגים כמקף
      value:
        describeEntry({
          ...(property.entryType !== undefined
            ? { entryType: property.entryType }
            : {}),
          ...(property.entryDate !== undefined
            ? { entryDate: new Date(property.entryDate) }
            : {}),
          ...(property.entryNote !== undefined
            ? { entryNote: property.entryNote }
            : {}),
        }) ?? null,
    },
    {
      label: "מאפיינים",
      value: features.length > 0 ? features.join(", ") : null,
    },
  ];

  /*
   * ‎**אותו „לא ידוע” שנקרא כ„לא”, בכפתור שמייצר הצעות.**
   *
   * הכפתור נוקב במספר („לאשר יצירת 7 הצעות?”), והמספר נשען על
   * ‎`offers` שעדיין ריק בזמן הטעינה — כלומר הוא מנופח, והמתווך
   * מאשר כמות שאינה מה שייווצר. השרת מחשב את הזכאות בעצמו ולכן לא
   * נשלחות הצעות כפולות, אבל המספר שהוצג לאישור היה שקרי.
   *
   * זה היה כאן לפני הבוררים ולא נולד איתם; הוא נסגר כאן כי זה אותו
   * מצב בדיוק, בשורה אחת.
   */
  const bulkEligible =
    offersState === "ready"
      ? (matches ?? []).filter((m) => m.score >= 85 && !offers[m.id]).length
      : 0;

  /*
   * הסינון מצטבר: כל צ'יפ שנבחר מצמצם עוד. השורה נשארת רק אם היא
   * עוברת את **כל** הבוררים הפעילים.
   */
  /**
   * ‎**בורר שנבחר והמידע שמתחתיו אינו ידוע — הרשימה אינה מוצגת.**
   *
   * הניסיון הראשון היה „הבורר מפסיק לסנן”, וזה החליף שקר אחד באחר:
   * הצ'יפ נשאר `aria-pressed`, הרשימה נפרשה במלואה, ו`hiddenByFilter`
   * קפץ — כלומר **רשימה לא-מסוננת מתחת לבורר פעיל**. אחרי „שלח
   * לכולם” זה בדיוק המסך שמראה כשנשלחו כהתאמות שלא נשלחו, ואם
   * הרענון נכשל הוא נשאר כך (ביקורת Codex).
   *
   * שלוש האפשרויות היו: לבטל את הבורר (מוחק בחירה של המתווך בלי
   * שביקש), לסנן לפי מה שיש (מציג נתון ישן כאילו הוא עדכני), או לא
   * להציג. השלישית היא היחידה שאינה טוענת דבר שאינו נכון — והבחירה
   * נשמרת.
   */
  const filterAwaitingOffers =
    offersState !== "ready" &&
    MATCH_FILTERS.some((f) => f.needsOffers === true && matchFilters.has(f.key));

  const visibleMatches = (matches ?? []).filter((m) =>
    MATCH_FILTERS.every(
      (f) => !matchFilters.has(f.key) || f.keep(m, offers[m.id] !== undefined),
    ),
  );
  const hiddenByFilter = (matches?.length ?? 0) - visibleMatches.length;

  return (
    <>
      <Link
        href="/properties"
        className="mb-3.5 inline-block no-underline hover:underline"
        style={{
          fontSize: "var(--type-body)",
          fontWeight: 800,
          color: "var(--color-primary)",
        }}
      >
        → חזרה לרשימת הנכסים
      </Link>

      {/*
        ‎**כרטיס הכותרת — SPEC-3a §2.** כרטיס אחד, ריפוד 24, שתי שורות:
        מי הנכס ומה מחירו למעלה, ומה אפשר לעשות איתו מתחת.

        הפעולות ישבו עד כה בטור המחיר, מימין לו, בכפתורים של 7px
        ריפוד. שתי בעיות: הן נדחסו לרוחב שנשאר אחרי המחיר, והן היו
        נמוכות מ-44 — המינימום לשטח נגיעה. שורה משלהן פותרת את שתיהן,
        וגם קובעת סדר: „מצא לי קונים” היא הפעולה הראשית, ואחריה השאר.
      */}
      <div
        className="mv-list-card mb-[18px] p-6"
        style={{ overflow: "visible" }}
      >
        {/* ---- שורה 1: מי הנכס, ומה מחירו ---- */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1
                className="m-0"
                style={{
                  fontSize: "calc(27 / 16 * 1rem)",
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                }}
              >
                {property.marketingTitle ?? (address || "נכס")}
              </h1>
              <label>
                <span className="mv-visually-hidden">שינוי סטטוס הנכס</span>
                {/*
                  הגלולה בצבע התחום של הסטטוס. „a draft listing is
                  NEUTRAL, never amber” — טיוטה אינה בעיה שממתינה
                  לטיפול אלא נכס שטרם נפתח לשיווק, וענבר היה אומר
                  „דחוף” על מצב שאינו דחוף כלל.
                */}
                <select
                  value={property.status}
                  disabled={statusSaving}
                  /*
                    ‎`e.target.value` הוא `string`, והאפשרויות נבנות
                    מ-`STATUS_LABELS`. הסכמה מאמתת במקום `as` —
                    ערך שאינו סטטוס מוכר פשוט אינו נשלח.
                  */
                  onChange={(e) => {
                    const parsed = PropertyStatusSchema.safeParse(e.target.value);
                    if (parsed.success) void changeStatus(parsed.data);
                  }}
                  className="mv-pill"
                  style={{
                    ...STATUS_DOMAIN[property.status],
                    /*
                      גבול פקד, למרות שהמסמך מצייר גלולה בלי מסגרת.
                      זה `select` ולא תווית: המשתמש משנה בו את סטטוס
                      הנכס. פקד שנראה כמו תג הוא פקד שאיש אינו יודע
                      שאפשר ללחוץ עליו, וגבול פקד כפוף ל-3:1
                      (WCAG 1.4.11). הצבע ממשיך לומר מה הסטטוס;
                      המסגרת אומרת שאפשר לשנות אותו.
                    */
                    border: "1px solid var(--color-input-border)",
                    cursor: "pointer",
                    fontSize: "var(--type-caption-lg)",
                  }}
                >
                  {Object.entries(STATUS_LABELS)
                    .filter(([value]) => value !== "archived")
                    .map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <p
              className="m-0 mt-[5px]"
              style={{ fontSize: "var(--type-body-sm)", color: "var(--color-text-muted)" }}
            >
              {/*
                בעל הנכס היה כאן כשורה בכותרת המשנה. הוא עבר לסעיף
                משלו בטור הראשי — הוא צד לעסקה, לא הערת שוליים לכתובת.

                הפרטים מצטרפים בנקודה אמצעית, כמו „מימון · נקלט: 25
                באוג׳ 2026” שבמסמך. הנקודה מופיעה רק כשיש לה שני צדדים —
                כתובת ריקה הייתה משאירה „· נקלט:” פותח בנקודה.
              */}
              {[address, `נקלט: ${formatDate(property.createdAt)}`]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          <div className="ms-auto text-start">
            {property.priceAgorot === undefined ? (
              /*
                „טרם הוזן מחיר” — ולא „—”.
                מחיר חסר הוא הדבר היחיד בכרטיס שעוצר שיווק בפועל,
                ולכן הוא נאמר במילים ועם דרך לתקן אותו. המסמך מוסיף:
                כשיש מחיר, אין שום אזהרה על מחיר חסר בשום מקום במסך.
              */
              <div className="flex flex-col items-start gap-1">
                <span
                  style={{
                    fontSize: "calc(19 / 16 * 1rem)",
                    fontWeight: 800,
                    color: "var(--color-warning)",
                  }}
                >
                  טרם הוזן מחיר
                </span>
                <button
                  type="button"
                  className="mv-btn-plain"
                  style={{ color: "var(--color-warning)", fontWeight: 800 }}
                  onClick={() => router.push(`/properties/${id}/edit?focus=price`)}
                >
                  הזנת מחיר
                </button>
              </div>
            ) : (
              <div
                dir="ltr"
                style={{
                  unicodeBidi: "isolate",
                  fontSize: "calc(27 / 16 * 1rem)",
                  fontWeight: 900,
                  letterSpacing: "-0.03em",
                }}
              >
                {formatPrice(property.priceAgorot)}
              </div>
            )}
          </div>
        </div>

        {/* ---- שורה 2: סרגל הפעולות ---- */}
        <div className="mt-[18px] flex flex-wrap gap-2.5">
          {/*
            כפתור ולא עוגן: מאז שההתאמות עברו ללשונית, הפאנל שלהן
            אינו קיים ב-DOM כל עוד לשונית אחרת פתוחה — ועוגן אל
            מזהה שאינו קיים אינו עושה דבר. הלחיצה קודם בוחרת את
            הלשונית, ורק אחרי שהיא הורכבה גוללת אליה (ביקורת Codex).
          */}
          <button
            type="button"
            className="mv-btn-action"
            style={HEADER_ACTION}
            onClick={() => {
              selectTab("matches");
              requestAnimationFrame(() => {
                document
                  .getElementById("matches-heading")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}
          >
            מצא לי קונים
          </button>
          {canLanding ? (
            <button
              type="button"
              className="mv-btn-soft"
              style={HEADER_ACTION}
              disabled={landingBusy}
              onClick={() => void createLanding()}
            >
              {landingBusy ? "יוצר…" : "צור דף נחיתה"}
            </button>
          ) : null}
          <Link
            href={`/calendar/new?propertyId=${id}`}
            className="mv-btn-plain"
            style={HEADER_ACTION}
          >
            קבע סיור
          </Link>
          <Link href={`/properties/${id}/edit`} className="mv-btn-plain" style={HEADER_ACTION}>
            עריכה
          </Link>
          {/*
            מחיקה ליד עריכה — שם מחפשים אותה. היא נשארת בשני
            שלבים: לחיצה ראשונה שואלת, שנייה מבצעת. נכס פעיל
            עובר לארכיון וניתן לשחזור, ורק נכס שכבר בארכיון
            נמחק לצמיתות — ולכן גם הניסוח משתנה, ואינו מבטיח
            "מחיקה" למשהו שהוא שחזיר.
          */}
          <button
            type="button"
            /*
              מסגרת רגילה שנכנסת לאדום-חמרה בריחוף, ואדומה במנוחה רק
              אחרי הלחיצה הראשונה — אז זה כבר מצב „ממתין לאישור” ולא
              אזהרה. הצבע יושב במחלקה ולא בשורה, כדי שמצב הניגודיות
              הגבוהה יוכל לגבור עליו.
            */
            className={
              archiveConfirm || purgeConfirm
                ? "mv-btn-plain mv-btn-plain--danger"
                : "mv-btn-plain mv-btn-plain--danger-hover"
            }
            style={HEADER_ACTION}
            onClick={() => void (property.archived ? purge() : archive())}
          >
            {property.archived
              ? purgeConfirm
                ? "למחוק לצמיתות?"
                : "מחיקה לצמיתות"
              : archiveConfirm
                ? "להעביר לארכיון?"
                : "מחיקה"}
          </button>
          {archiveConfirm || purgeConfirm ? (
            <button
              type="button"
              className="mv-btn-plain"
              style={HEADER_ACTION}
              onClick={() => {
                setArchiveConfirm(false);
                setPurgeConfirm(false);
                // הבדיקה שבאוויר לא תכתוב על מסך שכבר בוטל
                purgeSeq.current += 1;
              }}
            >
              ביטול
            </button>
          ) : null}
        </div>

        {/*
          מה שהמתווך אינו מצפה לו — כרטיס של אדם שיורד עם הנכס. מוצג
          בין שתי הלחיצות, כלומר לפני שהמחיקה בוצעה ובזמן שעוד אפשר
          לבטל. „נמחק גם X” אחרי המעשה אינו אזהרה אלא הודעת ניחומים.
        */}
        {purgeConfirm && purgeImpact !== "loading" && purgeImpact !== 0 ? (
          <p
            role="status"
            className="m-0 mt-3 rounded-lg px-3 py-2 text-sm"
            /*
              טוקנים ולא ערכים ישירים (#266). ערך ישיר מקפיא את שלוש
              הערכות — בהיר, כהה, וניגודיות גבוהה — ולכן מי שהדליק
              ניגודיות גבוהה פשוט אינו מקבל אותה. זו האזהרה שאומרת
              „יימחק גם כרטיס לקוח”, כלומר בדיוק המקום שבו זה חשוב.
            */
            style={{
              background: "var(--color-danger-soft)",
              border: "1px solid var(--color-danger)",
              color: "var(--color-danger)",
            }}
          >
            {purgeImpact === "unknown"
              ? "לא הצלחנו לבדוק אם יימחקו גם כרטיסי לקוח — בדקו לפני המחיקה"
              : purgeImpact === 1
                ? "יימחק גם כרטיס לקוח אחד, שהנכס הזה הוא הקישור היחיד אליו — כולל שם, טלפונים והיסטוריית התקשורת"
                : `יימחקו גם ${purgeImpact} כרטיסי לקוח, שהנכס הזה הוא הקישור היחיד אליהם — כולל שם, טלפונים והיסטוריית התקשורת`}
          </p>
        ) : null}

        {landingUrl ? (
          <p
            role="status"
            className="m-0 mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: "#F1FEF4", border: "1px solid #BDF4CB" }}
          >
            {/*
              הכותרת אמרה „והקישור הועתק” תמיד, גם כשהדפדפן חסם את
              הלוח — והמתווך הדביק אז משהו אחר. הדף באמת מוכן בכל
              מקרה, וההעתקה היא החלק שיכול להיכשל בנפרד.

              שלושה מצבים ולא שניים: הבאנר מופיע ברגע ש-`landingUrl`
              נקבע, וההעתקה עדיין באוויר אחריו (הדפדפן עשוי להמתין
              לאישור גישה ללוח). „כל מה שאינו כישלון = הצלחה” אמר
              „הועתק” לפני שזה נודע — אותה טעות שה-PR הזה מתקן,
              בשורה שנכתבה כדי לתקן אותה (ביקורת Codex). רק `copied`
              מדבר בלשון עבר.
            */}
            <span
              className="font-bold"
              style={{ color: "var(--color-primary)" }}
            >
              {landingClipboard.state === "copied"
                ? "✓ דף הנחיתה מוכן והקישור הועתק:"
                : landingClipboard.state === "failed"
                  ? "✓ דף הנחיתה מוכן (הדפדפן חסם את הלוח — העתיקו את הקישור ידנית):"
                  : "✓ דף הנחיתה מוכן:"}
            </span>
            <a
              href={landingUrl}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="underline"
              style={{ color: "var(--color-primary)" }}
            >
              {landingUrl}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              — שלחו בוואטסאפ, פרסמו במודעה, וכל פנייה מהדף תיכנס ללידים.
            </span>
          </p>
        ) : null}
      </div>

      {/* ---- לשוניות ---- */}
      <EntityTabs
        label="לשוניות כרטיס הנכס"
        active={tab}
        onSelect={selectTab}
        tabs={[
          { key: "overview", label: "סקירה" },
          { key: "matches", label: "התאמות", count: matches?.length },
          /*
            נכסים תואמים — צמוד להתאמות ולא בסוף הסרגל. שתי
            הלשוניות עונות על אותה שאלה בשיחה עם לקוח ("מה עוד
            אפשר להציע לו"), ומי שפתח את ההתאמות הוא בדיוק מי
            שיזדקק לתואמים בשנייה שאחר כך.
          */
          { key: "twins", label: "נכסים תואמים", count: twinCount },
          /*
            לשונית משלה, כמו בכרטיס הקונה. הפרסום לרשת ישב עד כה
            בתחתית לשונית ההתאמות — כלומר מי שרצה לפרסם נכס היה
            צריך לדעת לגלול לשם, ורוב הנכסים פשוט לא פורסמו.
          */
          { key: "network", label: "שיתופי פעולה" },
          { key: "owner", label: "בעל הנכס" },
          { key: "exclusivity", label: "בלעדיות" },
          { key: "agreements", label: "מסמכים והסכמים" },
          { key: "tasks", label: "משימות", count: openTasks },
        ]}
      />

      {/* סקירה — הנכס עצמו, ומה שמעכב את שיווקו */}
      <TabPanel tab="overview" active={tab}>
        {/*
          ‎`1fr / 372px`, `gap: 20`, `align-items: start` — SPEC-3c §6
          ו-DESIGN-SYSTEM-4 §24 („DETAIL PAGE: 1fr 372px”). 340 היה
          מספר שלנו; 372 הוא של החבילה, ומאותו טור נגזרות גם מידות
          הכרטיסים שבתוכו.
        */}
        <div className="grid items-start gap-5 lg:[grid-template-columns:1fr_372px]">
          <div className="flex flex-col gap-[18px]">
            {/*
              ‎**המוכנות היא הכרטיס הראשון של הלשונית** — „the reason the
              screen exists” (SPEC-3b §4). היא ישבה בטור הצדדי, שם רשת
              של תשעה תאים ברוחב 340 נדחסת לעמודה אחת ארוכה; המסמך
              מבקש שלוש עמודות, וזה הטור שיש בו מקום להן.
            */}
            <ReadinessCard
              propertyId={id}
              property={property}
              onSelectTab={selectTab}
              onScrollToSection={(sectionId) => {
                /*
                  שני פריימים ולא אחד: `selectTab` מרכיב את הפאנל, והעוגן
                  נכנס ל-DOM רק אחרי הרינדור שאחרי העדכון. גלילה באותו
                  פריים מחפשת אלמנט שטרם קיים.
                */
                requestAnimationFrame(() => {
                  document
                    .getElementById(sectionId)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            />

            <DetailsCard
              fields={detailFields}
              {...(canEditOwner ? { editHref: `/properties/${id}/edit` } : {})}
            />

            {/*
              הערות פנימיות — מה שנאמר בשיחה עם בעל הנכס ואינו נכנס
              לאף שדה: "הדוד לא מסכים לפחות מ-2.1", "אפשר להיכנס רק
              אחרי החגים", "השכנים מלמעלה בשיפוץ". בכרטיס הקונה זה
              קיים מהיום הראשון; בנכס הטקסט נשמר במסד
              (`internal_notes`) וה-API קיבל אותו — ושום מסך לא הציג
              אותו, כלומר שדה שהיה קיים ולא היה בנמצא.
            */}
            <EntityNotes
              value={property.internalNotes}
              fieldId="internalNotes"
              title="הערות פנימיות"
              empty="אין הערות עדיין — מה שנאמר בשיחה עם בעל הנכס נכתב כאן."
              canEdit={canEditOwner}
              onSave={saveNotes}
            />
          </div>
          <div className="flex flex-col gap-[18px]">
            {/* „מה קורה עם הנכס” — SPEC-3c §6a */}
            <PropertyTimeline propertyId={id} />

            {/*
              ‎**„מקום הנכס” — SPEC-3c §6b.**

              המסמך מבקש „משבצת שמורה” בגובה 220 ומורה במפורש
              ‎„never hand-draw a map — mount the real map component
              here”. המפה האמיתית כבר קיימת במערכת, ולכן המשבצת אינה
              מציין מקום אלא המסגרת שלה.

              והיא נשארת **עריכה** ולא תצוגה: זו הדרך היחידה למקם
              נכס בלי לעזוב את הכרטיס, וסוכן שצריך לנווט למסך אחר
              כדי למקם נכס פשוט לא ימקם אותו.
            */}
            <section className="mv-card" aria-labelledby="place-heading">
              <div className="mv-card-head">
                <span className="mv-tile mv-tile--44 mv-domain-blue" aria-hidden="true">
                  <IconMap s={20} />
                </span>
                <h2 id="place-heading" className="mv-card-head__title">
                  מקום הנכס
                </h2>
              </div>
              {/*
                ‎**המפה מקבלת מידה, ולא נחתכת בעטיפה.** 220 הוא גובה
                המפה לפי המסמך; הכרטיס עצמו גבוה ממנו, כי מעליה יש
                שדה חיפוש ומתחתיה שורת מצב. עטיפה שחותכת ל-220
                הייתה מסתירה בדיוק את הפקדים האלה.
              */}
              <LocationPicker
                mapHeight="220px"
                value={{
                  latitude: property.latitude,
                  longitude: property.longitude,
                  locationSource: property.locationSource,
                }}
                addressText={address}
                disabled={!canEditOwner}
                onChange={(next) => {
                  setProperty({ ...property, ...next });
                  void apiPatch(`/properties/${id}`, next).catch(
                    () => undefined,
                  );
                }}
              />
              {/*
                שורת הכתובת מתחת למשבצת — וכשאין כתובת נאמר זאת
                במפורש, כי „every empty state names the action”.
              */}
              <p className="m-0 mt-2.5 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                {address === "" ? "טרם הוזנה כתובת לנכס." : address}
              </p>
            </section>

            <section
              className="mv-list-card px-5 py-[18px]"
              aria-labelledby="media-heading"
            >
              <h2
                id="media-heading"
                className="m-0 mb-3"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                תמונות
              </h2>
              <MediaSection propertyId={id} address={address} onMediaChanged={loadProperty} />
            </section>

            <button
              type="button"
              className="mv-btn-plain self-start"
              style={{
                color: archiveConfirm
                  ? "var(--color-danger)"
                  : "var(--color-text-muted)",
              }}
              onClick={() => void archive()}
            >
              {archiveConfirm ? "לאשר העברה לארכיון?" : "העבר לארכיון"}
            </button>
            {archiveConfirm ? (
              <button
                type="button"
                className="mv-btn-plain self-start"
                onClick={() => setArchiveConfirm(false)}
              >
                ביטול
              </button>
            ) : null}

            {/*
              מחיקה לצמיתות מוצגת רק לנכס שכבר בארכיון: שני שלבים
              נפרדים, כדי שנכס פעיל לא ייעלם בלחיצה אחת.
            */}
            {property.archived ? (
              <>
                <button
                  type="button"
                  className="mv-btn-plain self-start"
                  style={{ color: "var(--color-danger)" }}
                  onClick={() => void purge()}
                >
                  {purgeConfirm
                    ? "לאשר מחיקה לצמיתות? התמונות יימחקו גם מהאחסון"
                    : "מחק לצמיתות"}
                </button>
                {purgeConfirm ? (
                  <button
                    type="button"
                    className="mv-btn-plain self-start"
                    onClick={() => setPurgeConfirm(false)}
                  >
                    ביטול
                  </button>
                ) : null}
                {purgeError !== null ? (
                  <Notice tone="danger">{purgeError}</Notice>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </TabPanel>

      <TabPanel tab="matches" active={tab}>
        {/*
            ---- שתי עמודות ההתאמה ----
            שמאל: המאגר הפנימי. ימין: הרשת. אותה שאלה ("מי מתאים
            לנכס הזה") משני מקורות, ובאותו סרגל ניקוד — כל עוד הן
            היו במסכים נפרדים הסוכן ראה חצי תשובה וסגר את הכרטיס.
          */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section
            className="mv-list-card px-[22px] py-[18px]"
            aria-labelledby="matches-heading"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2
                id="matches-heading"
                className="m-0"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                קונים מתאימים מהמאגר
              </h2>
              <span
                className="text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                כל התאמה מוסברת — בלי קופסה שחורה
              </span>
              {bulkEligible >= 2 ? (
                <button
                  type="button"
                  className={
                    bulkConfirm
                      ? "mv-btn-plain ms-auto"
                      : "mv-btn-action ms-auto"
                  }
                  style={
                    bulkConfirm
                      ? { color: "var(--color-danger)" }
                      : { padding: "7px 15px", fontSize: "var(--type-caption-lg)" }
                  }
                  onClick={() => void bulkSend()}
                >
                  {bulkConfirm
                    ? `לאשר יצירת ${bulkEligible} הצעות?`
                    : "צור הצעות לכל המתאימים (85%+)"}
                </button>
              ) : null}
            </div>
            {bulkResult ? (
              <Notice tone="success">✓ {bulkResult}</Notice>
            ) : null}

            {/*
              צ'יפי הסינון — SPEC-4a §1.

              ‎**מוצגים רק כשיש מה לסנן.** שורת בוררים מעל רשימה של
              שתי שורות היא רעש, ומעל רשימה ריקה היא הבטחה לתוכן
              שאינו קיים.
            */}
            {/*
              ‎**הניסיון החוזר אינו יכול להיות מותנה בבורר שנחסם.**

              מצב ההצעות נטען בבקשה נפרדת. כשהיא נכשלת בטעינה
              הראשונה, הבורר „לא נשלחה הצעה” נחסם וכפתור ההצעות
              נעלם — ואם הניסיון החוזר יושב מתחת לבורר **פעיל**,
              הוא בלתי-נגיש: הבורר היה חסום כל הזמן ולכן לא ניתן
              היה לבחור בו. כלומר מבוי סתום עד רענון העמוד כולו
              (ביקורת Codex).

              זה בדיוק הכשל שבגללו `loadOffers` יצא לפונקציה משלו —
              ‎`LoadError` בלי דרך לצאת ממנה — ובניתי אותו מחדש בצורה
              אחרת. הניסיון החוזר תלוי עכשיו רק בתקלה עצמה.
            */}
            {matches !== null && matches.length > 0 && offersState === "failed" ? (
              <div className="mb-2.5">
                <LoadError
                  /*
                    נוקב ב**עובדה** ובתוצאה שנכונה תמיד. הניסוח
                    הקודם הבטיח גם על „יצירת הצעות לכל המתאימים”,
                    שאינה מוצגת ממילא כשאין התאמות מעל 85 — כלומר
                    אמירה על כפתור שלא היה שם.
                  */
                  message="לא הצלחנו לטעון את מצב ההצעות — לא ידוע למי כבר נשלחה הצעה, ולכן מצב ההצעה בשורות והסינון „לא נשלחה הצעה” אינם מוצגים"
                  onRetry={() => loadOffers(matches)}
                />
              </div>
            ) : null}

            {matches !== null && matches.length > 1 ? (
              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {MATCH_FILTERS.map((f) => {
                  const on = matchFilters.has(f.key);
                  /*
                    ‎**בורר שאינו יודע — אינו נלחץ.** „לא נשלחה
                    הצעה” נשען על בקשה נפרדת; כל עוד היא לא חזרה,
                    „אין הצעה” הוא ניחוש ולא תשובה, והבורר היה
                    מחזיר גם התאמות שכבר נשלחה עליהן הצעה.
                  */
                  const blocked = f.needsOffers === true && offersState !== "ready";
                  return (
                    <button
                      key={f.key}
                      type="button"
                      disabled={blocked}
                      title={
                        blocked
                          ? offersState === "failed"
                            ? "לא הצלחנו לטעון את מצב ההצעות"
                            : "טוען את מצב ההצעות…"
                          : undefined
                      }
                      aria-pressed={on}
                      /*
                        ‎`mv-chip` ולא `mv-example-chip`: הראשון כבר
                        נושא מצב „נבחר” שעבר את שער הניגודיות
                        בשלוש הערכות. הצבעים שכתבתי בהתחלה ביד היו
                        ‎1.68:1 בערכה הכהה — לבן על ירוק בהיר — והשער
                        תפס זאת. אותו כשל בדיוק מתועד ב-CSS לצד
                        הכלל הזה, מגלולת סינון קודמת.
                      */
                      className="mv-chip"
                      onClick={() =>
                        setMatchFilters((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.key)) next.delete(f.key);
                          else next.add(f.key);
                          return next;
                        })
                      }
                    >
                      {f.label}
                    </button>
                  );
                })}
                {/*
                  ‎**מה שהוסתר נאמר במספר.** רשימה שהתקצרה בלי לומר
                  בכמה נקראת כמו „אין יותר מזה” — וזו בדיוק הטעות
                  שגורמת למתווך לחשוב שהמאגר ריק.
                */}
                {hiddenByFilter > 0 && !filterAwaitingOffers ? (
                  <span
                    className="text-[length:var(--type-caption-lg)]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    {hiddenByFilter} מוסתרים בסינון
                  </span>
                ) : null}
              </div>
            ) : null}

            {matchesFailed ? (
              <LoadError
                message="לא הצלחנו לטעון את ההתאמות"
                onRetry={loadMatches}
              />
            ) : matches === null ? (
              <p aria-live="polite">מחשב התאמות…</p>
            ) : matches.length === 0 ? (
              <MatchesEmptyState
                blocking={matchGateMissing(property, matchEvaluable)}
                oneSided={propertySideOnlyMissing(property)}
                status={property.status}
                propertyId={id}
              />
            ) : filterAwaitingOffers ? (
              /*
                ‎**בורר פעיל שנשען על מידע שאינו ידוע.** רשימה
                לא-מסוננת מתחת לצ'יפ לחוץ אומרת דבר שאינו נכון;
                וסינון לפי המפה הישנה מציג התאמות שנשלחה עליהן הצעה
                לפני שניות כאילו לא נשלחה. שתיהן גרועות משורה אחת
                שאומרת מה קורה.
              */
              /*
                ‎**בלי כפתור שני.** הניסיון החוזר יושב למעלה ומוצג
                בכל תקלה, ולא רק כשבורר נבחר. שני כפתורים לאותה
                פעולה על אותו מסך הם שאלה („במה ללחוץ?”) במקום
                תשובה.
              */
              <p className="m-0" aria-live="polite" style={{ color: "var(--color-text-muted)" }}>
                {offersState === "failed"
                  ? "הסינון „לא נשלחה הצעה” אינו יכול לרוץ עד שמצב ההצעות ייטען."
                  : "מעדכן את מצב ההצעות…"}
              </p>
            ) : visibleMatches.length === 0 ? (
              /*
                ‎**סינון שהסתיר הכול אומר זאת, ומציע לבטל.**
                רשימה ריקה בלי משפט נקראת „אין קונים מתאימים” — בזמן
                שיש, והמתווך עצמו הסתיר אותם לפני שניות. זה בדיוק
                המצב שבו מסך שותק משקר.
              */
              <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                כל {matches.length} ההתאמות מוסתרות בסינון.{" "}
                <button
                  type="button"
                  className="underline"
                  style={{ color: "inherit" }}
                  onClick={() => setMatchFilters(new Set())}
                >
                  ניקוי הסינון
                </button>
              </p>
            ) : (
              visibleMatches.map((m) => {
                /*
                  ‎**כשהמצב נכשל, המפה הישנה נשארת — ואסור לקרוא
                  ממנה.**

                  ‎`loadOffers` אינו מנקה את `offers` בכישלון, ולכן
                  השורות המשיכו לגזור מצב ופעולה מתצלום ישן. אחרי
                  „שלח לכולם” שהצליח ורענון שנכשל, זה מציג „שלח
                  הצעה” על קונה שההצעה אליו נוצרה לפני שניות
                  (ביקורת Codex).

                  ‎**רק על `failed` ולא על `loading`.** טעינה היא
                  מצב חולף שמתקן את עצמו, וחסימה עליה הייתה מבהבת
                  בכל כניסה לכרטיס; כישלון נשאר עד ניסיון חוזר.
                  דחיתי קודם את הגידור הזה בנימוק ההבהוב — כלומר
                  שפטתי גרסה גרועה יותר שלו.
                */
                const offerKnown = offersState !== "failed";
                const offer = offerKnown ? offers[m.id] : undefined;
                const tag = m.buyerMaturity
                  ? MATURITY_TAG[m.buyerMaturity]
                  : undefined;
                return (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center gap-[15px] py-[13px]"
                    style={{
                      borderBottom: "1px solid var(--color-row-border)",
                    }}
                  >
                    <span
                      className="mv-score-ring mv-score-ring--lg"
                      style={{
                        background: `conic-gradient(#2ECC66 ${Math.round(m.score * 3.6)}deg, var(--color-progress-track) 0deg)`,
                      }}
                      aria-hidden="true"
                    >
                      <span>
                        {m.score}%
                      </span>
                    </span>
                    <div className="min-w-0 flex-1" style={{ lineHeight: 1.4 }}>
                      <div className="text-[length:var(--type-body)] font-bold">
                        {m.buyerName ? (
                          <Link
                            href={`/buyers/${m.buyerId}`}
                            className="no-underline hover:underline"
                            style={{ color: "inherit" }}
                          >
                            {m.buyerName}
                          </Link>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            קונה של סוכן אחר
                          </span>
                        )}
                        {tag && m.buyerMaturity ? (
                          <span
                            className="mv-tag ms-1.5"
                            style={{
                              color: tag.fg,
                              background: tag.bg,
                              fontWeight: 600,
                              fontSize: "var(--type-caption)",
                              padding: "1px 8px",
                            }}
                          >
                            {labelOf(MATURITY_LABELS, m.buyerMaturity) ??
                              m.buyerMaturity}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="text-[length:var(--type-caption-lg)]"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {m.explanation}
                      </div>
                      {/*
                        רצועת ההסבר — SPEC-4a §1: „זה מה שהופך ציון
                        לפעולה”. היא יושבת אחרי ההסבר המילולי ולא
                        במקומו: המשפט אומר את המסקנה, והצ'יפים אומרים
                        על מה היא נשענת ומה אפשר להשלים.
                      */}
                      <MatchExplanation
                        breakdown={m.breakdown}
                        propertyEvaluable={matchEvaluable}
                      />
                      {awaitingSignature[m.id] ? (
                        <div className="mt-1.5 text-[length:var(--type-caption-lg)]">
                          <span style={{ color: "var(--color-danger)" }}>
                            ממתין לחתימה על הזמנה בכתב
                          </span>
                          {" · "}
                          <a
                            href={awaitingSignature[m.id]}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            קישור לחתימה
                          </a>
                        </div>
                      ) : null}
                      {offer ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[length:var(--type-caption-lg)]">
                          <span
                            className="font-bold"
                            style={{
                              color:
                                offer.status === "interested"
                                  ? "var(--color-primary)"
                                  : "var(--color-text-soft)",
                            }}
                          >
                            {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
                            {offer.openCount > 0
                              ? ` (${offer.openCount} צפיות)`
                              : ""}
                          </span>
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            דף ההצעה
                          </a>
                          {/*
                            „הקישור הועתק” נאמר קודם גם כשההעתקה
                            נכשלה. הקישור עצמו יושב כאן כ„דף ההצעה”,
                            ולכן כשהלוח חסום ההפניה אליו היא המוצא.
                          */}
                          {offerClipboard.key === m.id &&
                          offerClipboard.state !== "idle" ? (
                            <span
                              role="status"
                              style={{
                                color:
                                  offerClipboard.state === "copied"
                                    ? "var(--color-primary)"
                                    : "var(--color-danger)",
                              }}
                            >
                              {offerClipboard.state === "copied"
                                ? "✓ הקישור הועתק"
                                : "הדפדפן חסם את הלוח — פתחו את „דף ההצעה” והעתיקו משורת הכתובת"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="ms-auto flex flex-none gap-2">
                      {/*
                        ‎**„שלח הצעה” היא טענה, לא רק פעולה** — היא
                        אומרת „לא נשלחה”. כשזה אינו ידוע היא נעלמת
                        יחד עם שאר התוכן שנשען על אותה בקשה; הניסיון
                        החוזר יושב מעל הרשימה ומחזיר את שניהם.
                      */}
                      {!offerKnown ? null : offer && canWhatsApp ? (
                        <button
                          type="button"
                          className="mv-btn-action"
                          style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                          onClick={() => void sendWhatsApp(offer.id)}
                        >
                          שלח בוואטסאפ
                        </button>
                      ) : offer ? null : (
                        <button
                          type="button"
                          className="mv-btn-action"
                          style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                          onClick={() => void createOffer(m.id)}
                        >
                          שלח הצעה
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <p
              className="m-0 mt-3 rounded-[9px] px-[13px] py-[9px] text-[length:var(--type-caption)]"
              style={{
                color: "var(--color-text-muted)",
                background: "var(--color-table-head)",
              }}
            >
              קונים שדרישת חובה שלהם נשברת (למשל: חובה מעלית ואין) — לא מוצגים
              כאן בכלל.
            </p>

            {/*
              ‎**רצועת הרשת (SPEC-4a §1).**

              מוצגת **רק כשהחישוב באמת רץ** — כלומר `matches` נטען
              ואין שדה חוסם. רצועה שמציעה „להרחיב את החיפוש” על נכס
              שחסר לו מחיר אינה הרחבה אלא הסחה: היא שולחת את המתווך
              לרשת במקום להשלים את השדה שעוצר אותו כאן.

              מופיעה גם כשיש התאמות וגם כשאין, ובכוונה: „יש שלושה
              מהמאגר, אולי יש עוד ברשת” היא הצעה מועילה ולא רק מוצא
              אחרון — והניסוח משתנה בין שני המצבים.
            */}
            {matches !== null &&
            !outOfMarket(property.status) &&
            matchGateMissing(property, matchEvaluable).length === 0 ? (
              <div
                className="mt-4 flex flex-wrap items-center gap-3 px-4 py-3.5"
                style={{ background: "var(--color-tab-active-bg)", borderRadius: 18 }}
              >
                <span
                  className="min-w-0 flex-1 text-[length:var(--type-body-sm)]"
                  /*
                    ‎**הטקסט נגזר מאותו צמד כמו הרקע.**

                    ‎`--color-tab-active-*` **מתהפך** בערכה הכהה: הרקע
                    הופך ל-`#d8e6dc` הבהיר והטקסט ל-`#111710` הכהה.
                    הרקע כאן הומר לטוקן והטקסט נשאר `#E8EDE9` — כלומר
                    לבן על בהיר, ‎1.07:1, בלתי קריא (ביקורת Codex).
                  */
                  style={{ color: "var(--color-tab-active-fg)" }}
                >
                  {matches.length === 0
                    ? "אף קונה מהמאגר לא התאים — אולי יש קונה מתאים אצל משרד אחר."
                    : "אפשר להרחיב את החיפוש גם לקונים של משרדים אחרים ברשת."}
                </span>
                <button
                  type="button"
                  className="mv-btn-action"
                  style={{ padding: "8px 16px", fontSize: "var(--type-caption-lg)" }}
                  onClick={() => selectTab("network")}
                >
                  פרסום לרשת
                </button>
              </div>
            ) : null}
          </section>
        </div>
      </TabPanel>

      {/* נכסים תואמים — מה עוד אפשר להציע ללקוח שהתעניין בנכס הזה */}
      <TabPanel tab="twins" active={tab}>
        <PropertyTwins
          propertyId={id}
          canEdit={canEditOwner}
          onCountChange={setTwinCount}
        />
      </TabPanel>

      {/* שיתופי פעולה — פרסום הנכס לרשת, והביקושים שהוא עונה עליהם */}
      <TabPanel tab="network" active={tab}>
        <div className="flex flex-col gap-[18px]">
          {/*
            הפרסום מעל עמודת הביקושים ולא מתחתיה: מי שרואה שארבעה
            ביקושים ברשת מתאימים לנכס שלו צריך לדעת מיד שהוא יכול גם
            לפרסם אותו ולתת למשרדים האלה לפנות אליו.
          */}
          {can(user, "collaboration.share") ? (
            <NetworkShareSection kind="property" entityId={id} />
          ) : null}

          <NetworkDemandMatches propertyId={id} />
        </div>
      </TabPanel>

      <TabPanel tab="owner" active={tab}>
        <div className="flex flex-col gap-[18px]">
          <PropertyOwner
            canErase={can(user, "contacts.delete")}
            propertyId={id}
            owner={property.ownerContact}
            canEdit={canEditOwner}
            canEditPeople={canEditOwnerPeople}
            onChanged={loadProperty}
            canSendUpdate={canWhatsApp}
            onSendUpdate={() => void sendOwnerUpdate()}
          />

          {/*
            מי גר בנכס — אחרי הבעלים ובסעיף נפרד משלו. ההפרדה היא
            העניין: השוכר פותח את הדלת, הבעלים מחליט על העסקה.
          */}
          <PropertyOccupant
            propertyId={id}
            occupant={property.occupantContact}
            occupancy={property.occupancy}
            leaseEndsAt={property.leaseEndsAt}
            noticePeriodDays={property.noticePeriodDays}
            canEdit={canEditOwner}
            canEditPeople={canEditOwnerPeople}
            canErase={can(user, "contacts.delete")}
            onChanged={loadProperty}
          />

          {/*
            הכובעים האחרים של בעל הנכס — מוכר שהוא גם קונה פעיל (או
            ליד) מוצג כאן כצ'יפ, בדיוק כמו שכרטיס הקונה מציג את
            הנכסים שבבעלותו. אותו endpoint, אותם פילטרי הרשאה.
          */}
          {property.ownerContact ? (
            <RelatedEntities
              contactId={property.ownerContact.id}
              exclude={{ kind: "property", id: property.id }}
            />
          ) : null}

          {/*
            הדוח יושב בלשונית של בעל הנכס ולא בזו של ההתאמות, כי
            השאלה שהוא עונה עליה נשאלת בשיחה **איתו**: "מה עשיתם
            בשביל הדירה שלי". מי שפתח את הכרטיס שלו הוא בדיוק מי
            שעומד לענות.
          */}
          <OwnerActivity
            propertyId={property.id}
            propertyLabel={property.marketingTitle ?? (address || "הנכס")}
            officeName={user?.tenantName ?? "משרד התיווך"}
          />
        </div>
      </TabPanel>

      <TabPanel tab="exclusivity" active={tab}>
        <ExclusivityPanel
          propertyId={property.id}
          propertyTitle={property.marketingTitle ?? (address || "נכס")}
          officeName={user?.tenantName ?? "משרד התיווך"}
          canEdit={can(user, "properties.edit")}
        />
      </TabPanel>

      <TabPanel tab="agreements" active={tab}>
        {/* בלעדיות נחתמת מול בעל הנכס — ולכן מיד אחרי הסעיף שלו,
              ולא בכרטיס הקונה */}
        {property.ownerContact ? (
          <>
            <AgreementsPanel
              contactId={property.ownerContact.id}
              kind="exclusivity"
              propertyId={property.id}
              title="הסכם בלעדיות מול בעל הנכס"
            />
            {/*
              ‎**אותה לשונית, ולא כרטיס „מסמכים” נפרד** (בקשת
              המשתמשת). בלעדיות שנחתמה על נייר וסריקה שלה הן אותו
              דבר מבחינת המתווך, ושתי רשימות בשני מקומות היו מחייבות
              אותו לזכור באיזו מהן לחפש.
            */}
            <DocumentsPanel
              contactId={property.ownerContact.id}
              propertyId={property.id}
              defaultKind="exclusivity"
              canEdit={can(user, "offers.send")}
            />
          </>
        ) : (
          /*
            הלשונית הזו הייתה ריקה לגמרי בלי בעל נכס — מסך שאינו
            אומר מה חסר ואינו אומר מה לעשות.
          */
          <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
            הסכמים ומסמכים נשמרים על בעל הנכס. הוסיפו את פרטי בעל הנכס בלשונית
            „סקירה”, וההסכמים ייפתחו כאן.
          </p>
        )}
      </TabPanel>

      <TabPanel tab="tasks" active={tab}>
        <EntityTasks
          entityType="property"
          entityId={property.id}
          /* אותו `missingFields` שמניע את ציון המוכנות בכרטיס */
          suggestFrom={property.missingFields}
        />
      </TabPanel>
    </>
  );
}
