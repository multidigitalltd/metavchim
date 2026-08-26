"use client";

import { useCallback, useEffect, useState, use, type ReactNode } from "react";
import Link from "next/link";
import {
  describeEntry,
  labelOf,
  PROPERTY_READINESS_FIELDS,
  readinessFieldLabel,
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
import { useFeature } from "@/lib/use-features";
import { readinessBand, readinessCount } from "@/lib/readiness";
import { MediaSection } from "./media-section";
import { PropertyTwins } from "./property-twins";
import { NetworkDemandMatches } from "../network-demand-matches";
import { NetworkShareSection } from "../../network-share-section";
import { AgreementsPanel } from "../../agreements-panel";
import { EntityTasks } from "../../entity-tasks";
import { PropertyOwner, type OwnerContact } from "../property-owner";
import { OwnerActivity } from "./owner-activity";
import { PropertyOccupant, type OccupantContact } from "../property-occupant";
import { LocationPicker } from "../location-picker";
import { ExclusivityPanel } from "../exclusivity-panel";
import { EntityNotes } from "../../entity-notes";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
import { RelatedEntities } from "../../related-entities";
import { IconCheck, IconThumbUp } from "../../icons";
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
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasBalcony?: boolean;
  hasSafeRoom?: boolean;
  priceAgorot?: number;
  entryType?: string;
  entryDate?: string;
  entryNote?: string;
  internalNotes?: string;
  status: string;
  marketingTitle?: string;
  readinessScore: number;
  missingFields: string[];
  ownerContact?: OwnerContact;
  /** מי גר בנכס כשזה אינו הבעלים — דירה שמושכרת בזמן שהיא מוצעת. */
  occupantContact?: OccupantContact;
  /** מתי הנכס נקלט — היה בשרת מאז ומתמיד ולא הוצהר כאן */
  createdAt: string;
}

interface MatchRow {
  id: string;
  buyerId: string;
  score: number;
  explanation: string;
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

const MATURITY_TAG: Record<string, { fg: string; bg: string }> = {
  very_hot: { fg: "#b0512c", bg: "#faf1ec" },
  hot: { fg: "#7a5c1f", bg: "#f7efdd" },
  interested: { fg: "#0C6E34", bg: "#E5FCEA" },
  not_ripe: { fg: "#616a63", bg: "#eef1ec" },
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
   * מונה התאומים, כמו מונה המשימות: נטען כאן כדי שהמספר יופיע על
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
    apiGet<{ status: string }[]>(`/tasks/for/property/${id}`)
      .then((rows) =>
        setOpenTasks(rows.filter((t) => t.status === "open").length),
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
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  /*
   * „אין עדיין קונים מתאימים” + הזמנה להוסיף קונה, על תקלת רשת,
   * שולח את המתווך לעבוד במקום שבו כבר יש לו תשובה.
   */
  const [matchesFailed, setMatchesFailed] = useState(false);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
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
  const loadMatches = useCallback((): void => {
    setMatchesFailed(false);
    apiGet<MatchRow[]>(`/properties/${id}/matches`)
      .then((rows) => {
        setMatches(rows);
        if (rows.length > 0) {
          const ids = rows.map((m) => m.id).join(",");
          apiGet<Record<string, OfferInfo>>(
            `/offers/for-matches?matchIds=${ids}`,
          )
            .then(setOffers)
            .catch(() => undefined);
        }
      })
      .catch(() => setMatchesFailed(true));
  }, [id]);

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
  async function changeStatus(status: string) {
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
   */
  async function purge() {
    if (!purgeConfirm) {
      setPurgeConfirm(true);
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
    if (rows.length > 0) {
      const ids = rows.map((m) => m.id).join(",");
      apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
        .then(setOffers)
        .catch(() => undefined);
    }
  }

  async function saveNotes(next: string): Promise<void> {
    await apiPatch(`/properties/${id}`, { internalNotes: next });
    setProperty((prev) => (prev ? { ...prev, internalNotes: next } : prev));
  }

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

  const detailFields: [string, string][] = [
    [
      "סוג",
      property.propertyType
        ? (PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType)
        : "—",
    ],
    ["חדרים", property.rooms !== undefined ? String(property.rooms) : "—"],
    ["שטח", property.areaSqm ? `${property.areaSqm} מ"ר` : "—"],
    [
      "קומה",
      property.floor !== undefined
        ? `${property.floor}${property.totalFloors ? ` מתוך ${property.totalFloors}` : ""}`
        : "—",
    ],
    [
      "כניסה / מסירה",
      // מצב + תאריך + ההערה החופשית בשורה אחת; "מיידי" ו"גמיש" הם
      // תשובות ולא חוסר, ולכן אינם מוצגים כמקף
      describeEntry({
        entryType: property.entryType as Parameters<
          typeof describeEntry
        >[0]["entryType"],
        ...(property.entryDate !== undefined
          ? { entryDate: new Date(property.entryDate) }
          : {}),
        ...(property.entryNote !== undefined
          ? { entryNote: property.entryNote }
          : {}),
      }) ?? "—",
    ],
    ["מאפיינים", features.length > 0 ? features.join(", ") : "—"],
  ];

  const bulkEligible = (matches ?? []).filter(
    (m) => m.score >= 85 && !offers[m.id],
  ).length;

  return (
    <>
      <Link
        href="/properties"
        className="mb-3.5 inline-block text-[length:var(--type-body-sm)] font-bold no-underline hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        → חזרה לרשימת הנכסים
      </Link>

      {/* ---- כרטיס הכותרת ---- */}
      <div
        className="mv-list-card mb-[18px] p-6"
        style={{ overflow: "visible" }}
      >
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0" style={{ fontSize: "calc(23 / 16 * 1rem)", fontWeight: 800 }}>
                {property.marketingTitle ?? (address || "נכס")}
              </h1>
              <label>
                <span className="mv-visually-hidden">שינוי סטטוס הנכס</span>
                <select
                  value={property.status}
                  disabled={statusSaving}
                  onChange={(e) => void changeStatus(e.target.value)}
                  className="mv-pill border-0"
                  style={{
                    background: "var(--color-primary-soft)",
                    color: "var(--color-primary)",
                    cursor: "pointer",
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
              className="m-0 mt-[5px] text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {/*
                בעל הנכס היה כאן כשורה בכותרת המשנה. הוא עבר לסעיף
                משלו בטור הראשי — הוא צד לעסקה, לא הערת שוליים לכתובת.
              */}
              {address}
              {/* מתי הכרטיס נכנס למערכת — ראו את אותה שורה בכרטיס הליד */}
              {address === "" ? "" : " · "}
              נקלט:{" "}
              <span style={{ color: "var(--color-text)" }}>
                {formatDate(property.createdAt)}
              </span>
            </p>
          </div>
          <div className="ms-auto text-start">
            <div style={{ fontSize: "calc(25 / 16 * 1rem)", fontWeight: 800 }}>
              {formatPrice(property.priceAgorot)}
            </div>
            <div className="mt-[9px] flex flex-wrap gap-2">
              <Link
                href={`/properties/${id}/edit`}
                className="mv-btn-plain"
                style={{ padding: "7px 13px", fontSize: "var(--type-caption-lg)" }}
              >
                עריכה
              </Link>
              <Link
                href={`/calendar/new?propertyId=${id}`}
                className="mv-btn-plain"
                style={{ padding: "7px 13px", fontSize: "var(--type-caption-lg)" }}
              >
                קבע סיור
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
                className="mv-btn-plain"
                style={{
                  padding: "7px 13px",
                  fontSize: "var(--type-caption-lg)",
                  color:
                    archiveConfirm || purgeConfirm
                      ? "var(--color-danger)"
                      : "var(--color-text-muted)",
                }}
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
                  style={{ padding: "7px 13px", fontSize: "var(--type-caption-lg)" }}
                  onClick={() => {
                    setArchiveConfirm(false);
                    setPurgeConfirm(false);
                  }}
                >
                  ביטול
                </button>
              ) : null}
              {canLanding ? (
                <button
                  type="button"
                  className="mv-btn-soft"
                  style={{ padding: "7px 13px", fontSize: "var(--type-caption-lg)" }}
                  disabled={landingBusy}
                  onClick={() => void createLanding()}
                >
                  {landingBusy ? "יוצר…" : "צור דף נחיתה"}
                </button>
              ) : null}
              {/*
                כפתור ולא עוגן: מאז שההתאמות עברו ללשונית, הפאנל שלהן
                אינו קיים ב-DOM כל עוד לשונית אחרת פתוחה — ועוגן אל
                מזהה שאינו קיים אינו עושה דבר. הלחיצה קודם בוחרת את
                הלשונית, ורק אחרי שהיא הורכבה גוללת אליה (ביקורת Codex).
              */}
              <button
                type="button"
                className="mv-btn-action"
                style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
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
            </div>
          </div>
        </div>

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
      <div
        className="mv-list-card mb-[18px] px-4"
        style={{ overflow: "visible" }}
      >
        <EntityTabs
          label="לשוניות כרטיס הנכס"
          active={tab}
          onSelect={selectTab}
          tabs={[
            { key: "overview", label: "סקירה" },
            { key: "matches", label: "התאמות", count: matches?.length },
            /*
              נכסים תאומים — צמוד להתאמות ולא בסוף הסרגל. שתי
              הלשוניות עונות על אותה שאלה בשיחה עם לקוח ("מה עוד
              אפשר להציע לו"), ומי שפתח את ההתאמות הוא בדיוק מי
              שיזדקק לתאומים בשנייה שאחר כך.
            */
            { key: "twins", label: "נכסים תאומים", count: twinCount },
            /*
              לשונית משלה, כמו בכרטיס הקונה. הפרסום לרשת ישב עד כה
              בתחתית לשונית ההתאמות — כלומר מי שרצה לפרסם נכס היה
              צריך לדעת לגלול לשם, ורוב הנכסים פשוט לא פורסמו.
            */
            { key: "network", label: "שיתופי פעולה" },
            { key: "owner", label: "בעל הנכס" },
            { key: "exclusivity", label: "בלעדיות" },
            { key: "agreements", label: "הסכמים" },
            { key: "tasks", label: "משימות", count: openTasks },
          ]}
        />
      </div>

      {/* סקירה — הנכס עצמו, ומה שמעכב את שיווקו */}
      <TabPanel tab="overview" active={tab}>
        <div className="grid items-start gap-[18px] lg:[grid-template-columns:1fr_340px]">
          <div className="flex flex-col gap-[18px]">
            <section
              className="mv-list-card px-[22px] py-[18px]"
              aria-labelledby="details-heading"
            >
              <h2
                id="details-heading"
                className="m-0 mb-3.5"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                פרטי הנכס
              </h2>
              <dl
                className="m-0 grid gap-x-[18px] gap-y-3.5"
                style={{
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                }}
              >
                {detailFields.map(([label, value]) => (
                  <div key={label}>
                    <dt
                      className="text-sm font-semibold"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {label}
                    </dt>
                    <dd className="m-0 mt-0.5 text-[length:var(--type-body)] font-bold">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/*
              מיקום הנכס — טקסט ומפה בשני הכיוונים. יושב ליד פרטי הנכס
              ולא במסך נפרד: זה חלק מהפרטים, וסוכן שצריך לנווט למסך אחר
              כדי למקם נכס פשוט לא ימקם אותו.
            */}
            <section className="mv-list-card mb-[18px] p-5">
              <h2 className="m-0 mb-2 text-[length:var(--type-button)] font-bold">מיקום על המפה</h2>
              <LocationPicker
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
            </section>

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
            <section
              className="mv-list-card px-5 py-[18px]"
              aria-labelledby="readiness-heading"
            >
              <div className="flex items-baseline">
                <h2
                  id="readiness-heading"
                  className="m-0"
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  מוכנות לשיווק
                </h2>
                <span
                  className="ms-auto"
                  style={{
                    /* ‎21 כשהוא, אבל מגיב להגדרת הנגישות — ראו ההערה למטה */
                    fontSize: "calc(21 / 16 * 1rem)",
                    fontWeight: 800,
                    color: readinessBand(property.readinessScore).text,
                  }}
                >
                  {property.readinessScore}%
                </span>
              </div>
              <div
                className="my-[11px] mb-[13px] overflow-hidden rounded-full"
                style={{ height: 7, background: "var(--color-progress-track)" }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${property.readinessScore}%`,
                    background: readinessBand(property.readinessScore).bar,
                    borderRadius: 99,
                  }}
                />
              </div>
              {/*
                „‎N מתוך M שדות מלאים” — הניסוח שהחבילה נוקבת בו
                (SPEC-3b §4), והשורה שהייתה חסרה כאן.

                האחוז לבדו אומר „82%” ולא אומר על כמה שדות מדובר.
                המכנה נגזר מהנתונים ואינו כתוב קשיח: `9` קבוע היה
                הופך לשקר ברגע שיתווסף שדה עשירי לחישוב שבשרת, ואז
                שוב יהיו שני מספרים לנכס אחד.

                ‎**כל הכרטיס הזה מגיב להגדרת גודל הטקסט** — הכותרת,
                האחוז, השורה הזו, שורת „מוכן לשיווק” ושורות השדות
                החסרים. הגדלת אחת מהן לבדה הייתה יוצרת בדיוק את
                הרכיב החצי-מוגדל שהביקורת מצביעה עליו: משפט בן 31
                פיקסלים ב-200% מתחת לאחוז שנשאר על 21. הערכים עצמם
                לא השתנו ב-100% (ביקורת Codex).

                שאר המסכים עדיין נושאים גדלים קבועים; זה מעבר יסודי
                אחד ולא המרה חלקית שמפזרת חוסר עקביות.
              */}
              <p className="m-0 mb-2" style={{ fontSize: "var(--type-body)", color: "var(--color-text-muted)" }}>
                {readinessCount(property.missingFields.length, PROPERTY_READINESS_FIELDS.length)}
              </p>
              {property.missingFields.length === 0 ? (
                <p
                  className="m-0 flex items-center gap-2 font-bold"
                  style={{ fontSize: "var(--type-body-sm)", color: "var(--color-primary)" }}
                >
                  {/* אייקון ולא „✓” — „NO EMOJI anywhere in the product UI” */}
                  <IconCheck s={18} />
                  הנכס מוכן לשיווק
                </p>
              ) : (
                property.missingFields.map((field) => (
                  <div
                    key={field}
                    className="flex items-center gap-2 py-[5px]"
                    style={{ fontSize: "var(--type-caption-lg)", color: "var(--color-text-muted)" }}
                  >
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{ background: "#c98a2e" }}
                    />
                    {readinessFieldLabel(field)}
                  </div>
                ))
              )}
              {property.missingFields.length > 0 ? (
                <Link
                  href={`/properties/${id}/edit`}
                  className="mv-btn-soft mt-2 inline-block"
                >
                  השלם פרטים
                </Link>
              ) : null}
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
              <MediaSection propertyId={id} address={address} />
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

            {matchesFailed ? (
              <LoadError
                message="לא הצלחנו לטעון את ההתאמות"
                onRetry={loadMatches}
              />
            ) : matches === null ? (
              <p aria-live="polite">מחשב התאמות…</p>
            ) : matches.length === 0 ? (
              <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                אין עדיין קונים מתאימים.{" "}
                <Link href="/buyers/new" className="underline">
                  הוסיפו קונה
                </Link>{" "}
                — וההתאמות יחושבו אוטומטית.
              </p>
            ) : (
              matches.map((m) => {
                const offer = offers[m.id];
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
                      {offer && canWhatsApp ? (
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
          </section>
        </div>
      </TabPanel>

      {/* נכסים תאומים — מה עוד אפשר להציע ללקוח שהתעניין בנכס הזה */}
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
          <AgreementsPanel
            contactId={property.ownerContact.id}
            kind="exclusivity"
            propertyId={property.id}
            title="הסכם בלעדיות מול בעל הנכס"
          />
        ) : null}

        {/*
            תיק הבלעדיות — מיד אחרי הסכם הבלעדיות, כי זה בדיוק מה
            שקורה אחריו: ההסכם נחתם, והשאלה הבאה היא מתי הוא נגמר
            ומה תועד בתוכו.
          */}
      </TabPanel>

      <TabPanel tab="tasks" active={tab}>
        <EntityTasks entityType="property" entityId={property.id} />
      </TabPanel>
    </>
  );
}
