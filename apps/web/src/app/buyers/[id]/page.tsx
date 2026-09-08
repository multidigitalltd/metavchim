"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  buyerProfileCompleteness,
  describeEntryNeed,
  priceInWordsWithCurrency,  labelOf } from "@metavchim/shared";
import type { BuyerRequirements, FloorPreference } from "@metavchim/shared";
import { floorPreferenceText } from "@metavchim/shared";
import { activeOfficeStatuses, officeStatusById } from "@metavchim/shared";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  formatBuyerSource,
  formatDate,
  formatDateTime,
  formatPrice,
  MATURITY_LABELS,
  lastActivityText,
  PROPERTY_TYPE_LABELS,
  waMeUrl,
} from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { IconCalendar, IconChat, IconClock, IconEdit, IconPhone } from "../../icons";
import { NetworkShareSection } from "../../network-share-section";
import { NetworkPropertyMatches } from "../network-property-matches";
import { TimelineSection } from "./timeline-section";
import { ContactPeople } from "../../contact-people";
import { DeleteBuyer } from "../delete-buyer";
import { ContactErasure } from "../../contact-erasure";
import { DangerZone } from "../../danger-zone";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks, type TaskListResponse } from "../../entity-tasks";
import { ClickToDial } from "../../click-to-dial";
import { AgreementsPanel } from "../../agreements-panel";
import { DocumentsPanel } from "../../documents-panel";
import { EntityNotes } from "../../entity-notes";
import { SelectMenu } from "../../select-menu";
import { useOfficeStatuses } from "../../use-office-statuses";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
import { IntakePanel } from "../../intake-panel";
import { LoadError } from "../../load-error";
import { AgentPicker } from "../../agent-picker";
import { Notice } from "../../notice";
import { PropertyPitchDialog } from "../../property-pitch-dialog";

/**
 * כרטיס הקונה.
 *
 * עד כה הכרטיס היה גלילה אחת ארוכה של אחת-עשרה קופסאות: מי הלקוח,
 * מה הוא מחפש, אנשי הקשר, ההסכם, השת"פ, המשימות, ההתאמות, ההצעות,
 * ההערות וציר הזמן. כולן נחוצות — ואף אחת מהן אינה נחוצה **תמיד**,
 * וזה ההבדל בין מסך עמוס למסך מסודר.
 *
 * עכשיו: כותרת קומפקטית שעונה "מי זה ומה עושים איתו עכשיו", ומתחתיה
 * לשוניות. הסקירה נפתחת ראשונה כי היא מה שסוכן קורא לפני שיחה.
 */

interface BuyerDetail {
  id: string;
  contact: { id: string; name: string; phone: string };
  requirements: {
    cities: string[];
    /*
     * השדה הזה הגיע מהשרת מאז ומתמיד ולא הוצהר כאן — ולכן השכונות
     * שהלקוח ביקש היו מגיעות לדפדפן ונזרקות בשקט. השרת מפענח דרך
     * הסכימה בקריאה, כך שהמערך תמיד קיים גם לכרטיסים ישנים.
     */
    neighborhoods: string[];
    /*
     * בדיוק אותו כשל כמו בשכונות שמעל: השדה הגיע מהשרת מאז ומתמיד
     * ולא הוצהר כאן, ולכן ההבחנה הבסיסית ביותר על הלקוח — קונה או
     * שוכר — נזרקה בדרך לדפדפן ולא הופיעה בכרטיס.
     */
    dealType: string;
    propertyTypes: string[];
    searchAreas?: {
      lat: number;
      lon: number;
      radiusKm: number;
      label?: string;
    }[];
    budgetMinAgorot?: number;
    budgetMaxAgorot?: number;
    floorPreference?: FloorPreference;
    roomsMin?: number;
    roomsMax?: number;
    areaSqmMin?: number;
    entryType?: string;
    entryBy?: string;
    flexibilityNotes?: string;
    features: Record<string, "must" | "nice">;
  };
  financing: string;
  maturity: string;
  /** מזהה סטטוס המשרד — התווית נפתרת מול הרשימה שנטענת בנפרד. */
  officeStatus?: string;
  /** הסוכן שהכרטיס שלו — שם ה-DTO, ולכן נקרא ישירות מה-GET. */
  ownerUserId?: string;
  agentName?: string;
  source: string;
  agentNotes?: string;
  /** מתי הכרטיס נקלט — היה בשרת מאז ומתמיד ולא הוצהר כאן */
  createdAt: string;
  /**
   * ‏מתי נגעו בלקוח לאחרונה — אותו שדה בדיוק שהרשימה מציגה, מאותה
   * ‏הגדרה בשרת (`lastActivityOf`). לעולם אינו ריק: בלי אף
   * ‏אינטראקציה הוא העדכון האחרון של הכרטיס עצמו.
   */
  lastActivityAt: string;
}

/**
 * ‏מעל כמה ימים „לפני X ימים” הוא סימן ולא עובדה.
 *
 * ‏שבוע: מתחתיו הלקוח בטיפול, ומעליו הוא נשכח — וזה בדיוק מה
 * שהשורה בכותרת אמורה להגיד במבט אחד, בלי לחשב תאריכים.
 */
const STALE_DAYS = 7;

interface MatchRow {
  id: string;
  propertyId: string;
  score: number;
  explanation: string;
  status: string;
  property: { address: string; title?: string; priceAgorot?: number };
}

interface OfferInfo {
  id: string;
  status: string;
  url: string;
  openCount: number;
}

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
};

const MATURITY_PILL: Record<string, { fg: string; bg: string }> = {
  very_hot: { fg: "var(--color-danger)", bg: "var(--color-danger-soft)" },
  hot: { fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" },
  interested: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  not_ripe: { fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" },
};

/* גלולות סטטוס ההצעה בהיסטוריה — כללי stChip מהעיצוב */
function offerChip(o: OfferInfo): { label: string; fg: string; bg: string } {
  if (o.status === "interested")
    return { label: "מעוניין ✓", fg: "var(--color-success)", bg: "var(--color-success-soft)" };
  if (o.status === "declined")
    return { label: "לא מתאים", fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" };
  /*
   * ‎**„נשלחה” הייתה גם ברירת המחדל של הצעה שלא נשלחה.** הצעה
   * ידנית נולדת `pending_approval` — נוצר לה קישור ואף ערוץ לא
   * הוציא אותה — והגלולה הזו טענה עליה שהיא בדרך אל הלקוח.
   */
  if (o.status === "pending_approval")
    return { label: "ממתינה לשליחה", fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" };
  if (o.status === "email_failed")
    return { label: "המייל נכשל", fg: "#8a3b21", bg: "#fbe9e1" };
  if (o.openCount >= 3)
    return { label: "מתלבט — שווה טלפון", fg: "var(--domain-amber-fg)", bg: "var(--domain-amber-bg)" };
  if (o.openCount > 0) return { label: "נפתחה", fg: "var(--color-text-muted)", bg: "var(--domain-neutral-tile)" };
  return { label: "נשלחה", fg: "var(--chip-neutral-fg)", bg: "var(--chip-neutral-bg)" };
}

function initials(name: string): string {
  return name.trim().slice(0, 1);
}

export default function BuyerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  // היכולת נגזרת מטבלת התפקידים המשותפת ולא מרשימת תפקידים מקומית —
  // שינוי הרשאות במקום אחד לא ישאיר כאן כפתור שהשרת ידחה
  const canEditPeople = can(user, "buyers.edit");
  /*
   * ‎**העברת קונה בין סוכנים נשענת על `tasks.assign`** — היכולת
   * שהנתיב `/tasks/assignees` דורש, ובמשמעותה „הטלת עבודה על סוכן
   * אחר”. `buyers.edit` היא עריכת הכרטיס, לא העברת בעלות עליו.
   */
  const canAssignAgent = can(user, "tasks.assign");

  /**
   * ‎**העברה שגם מעבירה גישה.**
   *
   * ‎`ownerUserId` בקונה מסנן ראייה: הסוכן הקודם מפסיק לראות את
   * הכרטיס (אלא אם יש לו `buyers.view_all`). התשובה מגיעה מהשרת
   * ולא מהרשימה המקומית — הרשימה נטענה פעם אחת, והשרת הוא זה
   * שיודע מי במשרד עכשיו.
   */
  async function changeAgent(ownerUserId: string): Promise<void> {
    if (ownerUserId === "") return;
    const saved = await apiPatch<{ ownerUserId?: string; agentName?: string }>(
      `/buyers/${id}`,
      { ownerUserId },
    );
    setBuyer((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            ownerUserId: saved.ownerUserId,
            agentName: saved.agentName,
          },
    );
  }
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const { statuses: officeStatuses } = useOfficeStatuses();
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  /*
   * „אין עדיין נכסים מתאימים במאגר” הוא משפט על המאגר, לא על הרשת.
   * כשהטעינה נכשלת הוא שולח את המתווך לחפש נכס בחוץ — או להתייאש
   * מקונה שיש לו התאמות.
   */
  const [matchesFailed, setMatchesFailed] = useState(false);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
  /*
   * ‎**„עוד לא יודעים” אינו „לא נשלח”.**
   *
   * „ההצעות שכבר נשלחו” מגיעות בבקשה שנייה, אחרי ההתאמות, ועד שהיא
   * חוזרת `offers` ריק — ומי שיגזור מזה „הכול מחכה לשליחה” יכריז על
   * נכס שכבר נשלח.
   *
   * ‎`true` רק כשהבקשה **הצליחה**. הניסוח הראשון סימן אותו גם
   * בכישלון, מתוך רצון שהבאנר יסכים עם הלשונית שמתחתיו — אבל מפה
   * ריקה שלא הגיעה מהשרת אינה עדות לכלום, ובאנר שסופר לפיה חוזר
   * בדיוק לבאג שנפתח בו (ביקורת Codex). כשלא יודעים, אין „הפעולה
   * הבאה”.
   */
  const [offersKnown, setOffersKnown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pitchOpen, setPitchOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  /*
   * מונה המשימות הפתוחות. הוא נטען כאן ולא רק בתוך `EntityTasks`,
   * כי המשימות ירדו ללשונית — ומשימה פתוחה שהסוכן צריך ללחוץ כדי
   * לגלות היא משימה שתישכח. המספר על הלשונית מחזיר את הנראות בלי
   * להחזיר את הגלילה.
   */
  const [openTasks, setOpenTasks] = useState<number | undefined>(undefined);
  /*
   * הלשונית נקראת לפני הטעינה ולא אחריה: hook שרץ אחרי `return`
   * מוקדם הוא שגיאת React, והכרטיס מציג "טוען…" לפני שיש קונה.
   */
  useEffect(() => {
    /*
     * הטיפוס מיובא ואינו נכתב כאן שוב: `apiGet<T>` הוא **הצהרה**
     * ולא אימות, ולכן צורה שנכתבת ביד בכל קורא מתיישנת בשקט
     * כשהשרת משתנה — וזה בדיוק מה שקרה כאן (ביקורת עצמית).
     */
    apiGet<TaskListResponse>(`/tasks/for/buyer/${id}`)
      .then((data) =>
        setOpenTasks(data.tasks.filter((t) => t.status === "open").length),
      )
      .catch(() => setOpenTasks(undefined));
  }, [id]);

  const [tab, selectTab] = useEntityTab(
    ["overview", "matches", "tasks", "timeline", "agreements", "network"],
    "overview",
  );

  /*
   * ‎**תיקון השם — במקום שבו הוא מוצג.**
   *
   * ‏קונה שנוצר משיחה נכנסת שבה לא זוהה שם נשמר עם מספר הטלפון
   * במקומו, וזה נשאר סופי: לא היה נתיב לשנות אותו בשום מסך.
   *
   * ‎`renaming` הוא הטקסט שבעריכה, ו-`null` הוא „לא עורכים כרגע” —
   * שני מצבים ולא דגל נפרד, כדי שלא ייווצר מצב שבו התיבה פתוחה
   * בלי ערך או סגורה עם ערך שנשמר בצד.
   */
  /*
   * ‎**„מחכות לשליחה” הן ההתאמות שעוד לא נשלחה עליהן הצעה.**
   *
   * ‏באנר הפעולה הבאה מבקש מהסוכן לשלוח; התאמה שכבר נשלחה עליה הצעה
   * ‏אינה פעולה שממתינה לו, וספירת כל ההתאמות הייתה מציגה עבודה
   * ‏שנעשתה — ואף מציעה כ„הגבוהה ביותר” נכס שהקונה כבר קיבל
   * ‏(ביקורת Codex, P2). זה אותו סינון שהלשונית עצמה עושה לכל שורה.
   *
   * ‎`reduce` ולא `sort`: מיון היה משנה את סדר התצוגה של הלשונית,
   * ‏שהוא הסדר שהשרת החזיר.
   */
  /**
   * ‎„פעילות אחרונה” לשורת המטא — הטקסט והאם הוא כבר סימן.
   *
   * ‏שתי התשובות נגזרות מאותו תאריך במקום אחד: ניסוח שאומר „לפני
   * ‏12 ימים” בצבע רגיל, או צבע אזהרה על טקסט שאומר „אתמול”, הם
   * שתי גרסאות של אותה עובדה שנפרדו זו מזו.
   */
  const lastActivity =
    buyer === null
      ? null
      : {
          text: lastActivityText(buyer.lastActivityAt),
          stale:
            Date.now() - new Date(buyer.lastActivityAt).getTime() >
            STALE_DAYS * 86_400_000,
        };

  const waitingMatches = (matches ?? []).filter(
    (row) => offers[row.id] === undefined,
  );
  const topMatch = waitingMatches.reduce<MatchRow | undefined>(
    (best, row) => (best === undefined || row.score > best.score ? row : best),
    undefined,
  );

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameFailed, setRenameFailed] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);

  async function saveName(): Promise<void> {
    const next = (renaming ?? "").trim();
    if (next === "" || buyer === null) return;
    /*
     * שם זהה אינו שינוי — סוגרים בלי לפנות לשרת. שמירה שאינה
     * משנה דבר לא אמורה להשאיר רשומת ביקורת שמתעדת שינוי שלא היה.
     */
    if (next === buyer.contact.name) {
      setRenaming(null);
      return;
    }
    setRenameBusy(true);
    setRenameFailed(false);
    try {
      await apiPatch(`/contacts/${buyer.contact.id}/name`, { name: next });
      /*
       * המסך מתעדכן רק אחרי שהשרת אישר. עדכון אופטימי היה מציג
       * שם חדש על כרטיס ששמו לא השתנה — והמתווך היה ממשיך משם.
       */
      setBuyer((prev) =>
        prev ? { ...prev, contact: { ...prev.contact, name: next } } : prev,
      );
      setRenaming(null);
    } catch {
      setRenameFailed(true);
    } finally {
      setRenameBusy(false);
    }
  }

  /**
   * ‎**שתי השכבות עוברות דרך אותה פונקציה, והשרת הוא שמכריע.**
   *
   * בחירת סטטוס משרד גוררת דרגה, ושינוי דרגה עשוי להפיל סטטוס סותר
   * ‎(ראו `statusAfterMaturityChange`). מסך שהיה מעדכן רק את השדה
   * שנשלח היה מציג „במשא ומתן” לצד „לא בשל” עד לרענון — כלומר מראה
   * מצב שאינו קיים במסד.
   *
   * ולכן התשובה נכתבת כמו שהיא: הכרטיס המעודכן חוזר מה-PATCH ממילא.
   */
  async function changeStatus(patch: {
    maturity?: string;
    officeStatus?: string | null;
  }) {
    const saved = await apiPatch<{ maturity: string; officeStatus?: string }>(
      `/buyers/${id}`,
      patch,
    );
    setBuyer((prev) =>
      prev === null
        ? prev
        : { ...prev, maturity: saved.maturity, officeStatus: saved.officeStatus },
    );
  }

  async function saveNotes(next: string): Promise<void> {
    await apiPatch(`/buyers/${id}`, { agentNotes: next });
    setBuyer((prev) => (prev ? { ...prev, agentNotes: next } : prev));
  }

  async function sendOffer(m: MatchRow) {
    setSending(m.id);
    try {
      const offer = await apiPost<OfferInfo>("/offers", { matchId: m.id });
      setOffers((prev) => ({ ...prev, [m.id]: offer }));
    } finally {
      setSending(null);
    }
  }

  /* אותה טעינה חוזרת כמו בכרטיס הנכס — ראו ההסבר שם. */
  const loadMatches = useCallback((): void => {
    setMatchesFailed(false);
    setOffersKnown(false);
    apiGet<MatchRow[]>(`/buyers/${id}/matches`)
      .then((rows) => {
        setMatches(rows);
        /* אין התאמות ⇒ אין הצעות, וזו ידיעה ולא היעדר תשובה */
        if (rows.length === 0) {
          setOffersKnown(true);
          return;
        }
        const ids = rows.map((m) => m.id).join(",");
        apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
          .then((sent) => {
            setOffers(sent);
            setOffersKnown(true);
          })
          .catch(() => undefined);
      })
      .catch(() => setMatchesFailed(true));
  }, [id]);

  useEffect(() => {
    if (authLoading) return;
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then(setBuyer)
      .catch(() => setError("הקונה לא נמצא"));
    loadMatches();
  }, [authLoading, id, loadMatches]);

  if (error) {
    return (
      <Notice tone="danger">{error} —{" "}
        <Link href="/buyers" className="underline">
          חזרה לרשימה
        </Link></Notice>
    );
  }
  if (!buyer) return <p aria-live="polite">טוען…</p>;

  const musts = Object.entries(buyer.requirements.features).filter(
    ([, l]) => l === "must",
  );
  const floorNeed = floorPreferenceText(buyer.requirements.floorPreference);
  const entryNeed = describeEntryNeed({
    entryType: buyer.requirements.entryType as Parameters<
      typeof describeEntryNeed
    >[0]["entryType"],
    ...(buyer.requirements.entryBy !== undefined
      ? { entryBy: new Date(buyer.requirements.entryBy) }
      : {}),
  });
  const nices = Object.entries(buyer.requirements.features).filter(
    ([, l]) => l === "nice",
  );
  const pill = MATURITY_PILL[buyer.maturity] ?? MATURITY_PILL["not_ripe"]!;
  /*
   * ‎**הסטטוס ששמור על הכרטיס נכנס לרשימה גם כשהוא הוסר משימוש.**
   *
   * בלעדיו הבורר לא היה מוצא התאמה לערך שלו ומציג את הפריט הראשון —
   * כלומר כרטיס שנראה כאילו הוא בסטטוס אחר לגמרי, בלי שאיש שינה
   * אותו. הבחירה בו אינה אפשרית מחדש אחרי שיוצאים ממנו, וזה בסדר:
   * הוא מתעד מה היה.
   */
  const current = officeStatusById(officeStatuses, buyer.officeStatus);
  const statusOptions = [
    { value: "", label: "בלי סטטוס" },
    ...activeOfficeStatuses(officeStatuses).map((entry) => ({
      value: entry.id,
      label: entry.label,
    })),
    ...(current !== null && current.archived
      ? [{ value: current.id, label: `${current.label} (הוסר)` }]
      : []),
  ];
  const sentOffers = Object.entries(offers);
  const isHotNoOffers =
    (buyer.maturity === "very_hot" || buyer.maturity === "hot") &&
    sentOffers.length === 0;

  const profile = buyerProfileCompleteness(
    buyer.requirements as unknown as BuyerRequirements,
  );

  return (
    <>
      <Link
        href="/buyers"
        className="mb-3.5 inline-block text-[length:var(--type-body-sm)] font-bold no-underline hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        → חזרה לרשימת הקונים
      </Link>

      {/*
        ---- כותרת ----
        עונה על שתי שאלות בלבד: מי זה, ומה עושים איתו עכשיו. כל השאר
        ירד ללשוניות — כותרת שמנסה לספר הכול היא כותרת שלא קוראים.
      */}
      <div
        className="mv-list-card mb-3 flex flex-wrap items-center gap-4 px-6 py-5"
        style={{ overflow: "visible" }}
      >
        {/* ‏ריבוע מעוגל ולא עיגול: אין כאן תמונה, יש כאן ישות */}
        <span aria-hidden="true" className="mv-avatar mv-avatar--lg flex-none">
          {initials(buyer.contact.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0" style={{ fontSize: "calc(21 / 16 * 1rem)", fontWeight: 800 }}>
              {buyer.contact.name}
            </h1>
            {/*
              ‎**עריכת השם ליד השם.**

              היכולת היא `buyers.edit` — אותה יכולת שהשרת דורש, כך
              ששינוי הרשאות במקום אחד לא ישאיר כאן כפתור שיידחה.
            */}
            {canEditPeople ? (
              <button
                type="button"
                className="mv-btn-plain"
                style={{ padding: "3px 9px", fontSize: "var(--type-caption)" }}
                onClick={() => {
                  setRenameFailed(false);
                  setRenaming(buyer.contact.name);
                }}
              >
                <IconEdit s={13} /> שינוי שם
              </button>
            ) : null}
            {/*
              קונה או שוכר — צמוד לשם.

              ההבדל קובע כמעט כל שיחה עם הלקוח (תקציב חודשי מול
              סכום רכישה, מועד כניסה, סוג ההסכם), והוא היה קבור
              בטופס העריכה בלבד. סוכן שפתח את הכרטיס ראה „לקוח פאר”
              ותקציב, ולא ידע איזו שיחה הוא עומד לנהל.

              גלולה סטטית ולא רשימה נפתחת: החלפת סוג העסקה משנה את
              משמעות התקציב ומאפסת את ההתאמות, ולכן היא נעשית
              במסך העריכה — לא בלחיצה אחת ליד השם.
            */}
            <span
              className="mv-pill"
              style={{
                background: "var(--color-primary-soft)",
                color: "var(--color-primary)",
                fontWeight: 700,
              }}
            >
              {DEAL_TYPE_LABELS[buyer.requirements.dealType] ?? buyer.requirements.dealType}
            </span>
            {/*
              ‎„של מי הכרטיס הזה?” — והעברה בין סוכנים למי שרשאי.
              ‎`allowUnassign` כבוי: קונה בלי בעלים אינו „של כולם”
              אלא בלתי נראה לכל סוכן שאין לו `buyers.view_all`.
            */}
            <AgentPicker
              canAssign={canAssignAgent}
              allowUnassign={false}
              labelText="הסוכן המטפל בקונה"
              onChange={changeAgent}
              {...(buyer.ownerUserId === undefined ? {} : { agentUserId: buyer.ownerUserId })}
              {...(buyer.agentName === undefined ? {} : { agentName: buyer.agentName })}
            />
            {/*
              רשימה מעוצבת ולא `select` נייטיב: הגלולה נראתה נכון
              סגורה, ובפתיחה נפתחה רשימת מערכת עם הדגשה כחולה שאינה
              שייכת לשום מקום במערכת.
            */}
            <SelectMenu
              value={buyer.maturity}
              onChange={(next) => void changeStatus({ maturity: next })}
              options={Object.entries(MATURITY_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
              label="עדכון בשלות"
              minWidth={128}
              tone={{ fg: pill.fg, bg: pill.bg }}
            />
            {/*
              ‎**שכבה ב׳ — הסטטוס של המשרד, לצד הדרגה ולא במקומה.**

              הדרגה נשארת גלויה כי היא מה שכל שאר המערכת פועלת לפיו
              (דשבורד, התאמות, התראות), והמתווך יכול לשנות גם אותה
              ישירות. הסטטוס הוא המילים של המשרד עליה.

              הבורר אינו מוצג כשהמשרד לא הגדיר סטטוסים **ולכרטיס אין
              אחד** — שדה ריק שאין בו מה לבחור הוא רעש. משרד שהגדיר
              ואז מחק רואה עדיין את מה ששמור על הכרטיס.
            */}
            {statusOptions.length > 1 ? (
              <SelectMenu
                value={buyer.officeStatus ?? ""}
                onChange={(next) =>
                  void changeStatus({ officeStatus: next === "" ? null : next })
                }
                options={statusOptions}
                label="סטטוס המשרד"
                minWidth={150}
              />
            ) : null}
          </div>
          {/*
            ‎**התיבה נפתחת מתחת לשם, ולא במקומו.**

            השם הנוכחי נשאר גלוי בזמן העריכה: מי שמתקן „מספר טלפון
            במקום שם” צריך לראות מול מה הוא מתקן.
          */}
          {renaming !== null ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveName();
              }}
            >
              <input
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                aria-label="שם הקונה"
                maxLength={120}
                className="rounded-lg border px-3 py-2"
                style={{
                  background: "var(--color-field)",
                  borderColor: "var(--color-input-border)",
                  minWidth: 220,
                }}
              />
              <button
                type="submit"
                className="mv-btn-action"
                disabled={renameBusy || renaming.trim().length < 2}
              >
                שמירה
              </button>
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => {
                  setRenaming(null);
                  setRenameFailed(false);
                }}
              >
                ביטול
              </button>
              {/*
                ‎**כישלון נאמר, והתיבה נשארת פתוחה.** סגירה שקטה
                הייתה מציגה את השם הישן וקוראת כאילו נשמר.
              */}
              {renameFailed ? (
                <span
                  className="text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-danger)" }}
                >
                  השם לא נשמר. אפשר לנסות שוב.
                </span>
              ) : null}
            </form>
          ) : null}
          <p
            className="m-0 mt-1 text-[length:var(--type-caption-lg)]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span dir="ltr">{buyer.contact.phone}</span> ·{" "}
            {formatBuyerSource(buyer.source)} · מימון:{" "}
            {labelOf(FINANCING_LABELS, buyer.financing) ?? buyer.financing}
            {/* מתי הכרטיס נכנס למערכת — ראו את אותה שורה בכרטיס הליד */}
            {" · נקלט: "}
            <span style={{ color: "var(--color-text)" }}>
              {formatDate(buyer.createdAt)}
            </span>
            {/*
              ‎---- מתי נגעו בו לאחרונה ---- (קובץ העיצוב)

              ‏זו השאלה שמתווך שואל את עצמו לפני שהוא מתקשר, והיא
              ‏הייתה מחייבת מעבר ללשונית ציר הזמן וקריאת התאריך
              ‏העליון. „לפני 6 ימים” היא התשובה עצמה.

              ‏מעל שבוע הוא נצבע — אותו כתום של שאר האזהרות הרכות
              ‏במערכת — כי אז המספר אינו נתון אלא סימן. הצבע אינו
              ‏לבדו: השעון והניסוח נושאים את אותה משמעות למי שאינו
              ‏מבחין בגוונים.
            */}
            {lastActivity !== null ? (
              <>
                {" · "}
                <span
                  className="inline-flex items-center gap-1 align-middle"
                  style={
                    lastActivity.stale
                      ? { color: "var(--color-warning)", fontWeight: 800 }
                      : undefined
                  }
                  title={formatDateTime(buyer.lastActivityAt)}
                >
                  <IconClock s={14} /> פעילות אחרונה {lastActivity.text}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="mv-cardactions ms-auto">
          {/*
            ‎**הכיוון ההפוך של „שליחת הצעת נכס”.**

            ‏מכרטיס הנכס בוחרים קונים; כאן בוחרים נכסים. אותה
            ‏פעולה, אותו חלון, אותו שירות — הצד הקבוע הוא הקונה
            ‏שכרטיסו פתוח.

            ‎**ראשון בשורה, וירוק** — לפי קובץ העיצוב: הוא הפעולה
            ‏הראשית של הכרטיס, והשאר משניות. קודם הוא ישב אחרון
            ‏ובסגנון משני, כלומר נראה כמו עוד אחד מחמישה.

            ‎**מי שאינו יכול לשלוח אינו רואה אותו** (ביקורת Codex,
            ‏P2). עוזר או צופה פותחים כרטיסים אבל אין להם
            ‎`offers.send`: מכאן הם היו בוחרים נכסים ומקבלים 403
            ‏בסוף. השרת ממילא חוסם — זה מה שמונע להציע תהליך שאינו
            ‏קיים.
          */}
          {can(user, "offers.send") ? (
            <button
              type="button"
              className="mv-btn-primary mv-cardactions__primary"
              style={{ minHeight: 36, paddingInline: 16, fontSize: "var(--type-caption-lg)" }}
              onClick={() => setPitchOpen(true)}
            >
              הצע נכס לקונה
            </button>
          ) : null}
          <Link
            href={`/buyers/${id}/edit`}
            className="mv-btn-plain mv-act"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconEdit s={14} /> ערוך דרישות
          </Link>
          {/*
            ‎**קביעת סיור מצד הלקוח.**

            עד כה הכפתור היה קיים רק בכרטיס הנכס, ולכן הסיור נקבע
            תמיד מהכיוון של „איזה נכס” — בזמן שהעבודה היומית של
            מתווך מתחילה מ„עם מי”. מכאן הלקוח כבר מקושר, וטופס
            הפגישה מבקש רק את הנכס (או פותח נכס חדש ומחזיר לכאן).
          */}
          <Link
            href={`/calendar/new?buyerId=${id}&kind=viewing`}
            className="mv-btn-plain mv-act"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconCalendar s={14} /> קביעת סיור
          </Link>
          <a
            href={`tel:${buyer.contact.phone}`}
            className="mv-btn-plain mv-act"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconPhone s={14} /> חייג
          </a>
          <a
            href={waMeUrl(buyer.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain mv-act"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconChat s={14} /> וואטסאפ
          </a>
          {/*
            ‏„מהמרכזייה” אינו בקובץ העיצוב — הוא יכולת שקיימת רק
            ‏כשהטלפוניה מחוברת, ולכן הוא אחרון ולא בין הארבעה.
          */}
          <ClickToDial
            contactId={buyer.contact.id}
            phone={buyer.contact.phone}
            label="מהמרכזייה"
          />
        </div>
      </div>

      <PropertyPitchDialog
        open={pitchOpen}
        onClose={() => setPitchOpen(false)}
        side="properties"
        fixedIds={[id]}
      />

      {/* ---- לשוניות ---- */}
      <EntityTabs
        label="לשוניות כרטיס הקונה"
        active={tab}
        onSelect={selectTab}
        tabs={[
          { key: "overview", label: "סקירה" },
          { key: "matches", label: "התאמות", count: matches?.length },
          { key: "tasks", label: "משימות", count: openTasks },
          { key: "timeline", label: "ציר זמן" },
          { key: "agreements", label: "מסמכים והסכמים" },
          { key: "network", label: "שיתופי פעולה" },
        ]}
      />

      {/* ============================================================
          סקירה — מה שסוכן קורא לפני שיחה
          ============================================================ */}
      <TabPanel tab="overview" active={tab}>
        {/*
          ‎---- הפעולה הבאה ---- ‏על פני כל הרוחב, מעל הטורים

          ‏קובץ העיצוב מציב אותה מעל שלושת הטורים ולא בתוך אחד
          ‏מהם: היא משפט על **הכרטיס** כולו, לא כרטיסייה שמתחרה
          ‏עם השכנות שלה על אותה עמודה.

          ‏משפט אחד ופעולה אחת, בראש הלשונית: יש כאן N התאמות
          ‏שממתינות, וזו הגבוהה שבהן. הסוכן שפותח את הכרטיס אינו
          ‏צריך לגלול ולהסיק — הדבר שכדאי לעשות עכשיו כתוב.

          ‏מוצג רק כשבאמת נשארה שליחה: כשאין התאמה שלא נשלחה
          ‏(`topMatch` ריק) אין פעולה, ובאנר שאומר „0 מחכים” הוא
          רעש בראש הכרטיס. וגם רק כשידוע מה כבר נשלח — לא לפני
          שההצעות חזרו, וגם לא כששליפתן נכשלה: מפה ריקה שלא הגיעה
          מהשרת אינה „לא נשלח כלום”.
        */}
        {offersKnown && topMatch !== undefined ? (
          <div className="mv-nextaction mv-domain-violet">
            <span
              aria-hidden="true"
              className="mv-tile mv-tile--44 mv-domain-violet flex-none"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
              >
                <circle cx="9" cy="12" r="5.5" />
                <circle cx="15" cy="12" r="5.5" />
              </svg>
            </span>
            <div className="min-w-0">
              <div
                className="font-black"
                style={{ fontSize: "calc(17 / 16 * 1rem)" }}
              >
                {waitingMatches.length === 1
                  ? "נכס מתאים אחד מחכה לשליחה"
                  : `${waitingMatches.length} נכסים מתאימים מחכים לשליחה`}
              </div>
              <div
                className="mt-0.5 text-[length:var(--type-body-sm)]"
                style={{ color: "var(--domain-violet-fg)" }}
              >
                ההתאמה הגבוהה ביותר — {topMatch.score}% ·{" "}
                {topMatch.property.address}
              </div>
            </div>
            <button
              type="button"
              className="mv-btn-primary ms-auto flex-none"
              onClick={() => selectTab("matches")}
            >
              צפה בהתאמות
            </button>
          </div>
        ) : null}

        {/*
          ‎---- שלושה טורים ---- (קובץ העיצוב)

          ‏מה הוא מחפש · מה שולחים ומה כתוב עליו · מי אנשי הקשר.
          ‏שלוש שאלות שסוכן שואל לפני שיחה, ואף אחת מהן אינה המשך
          ‏של השנייה — ולכן הן זו לצד זו ולא זו מתחת לזו. בטלפון
          ‏הרשת מתקפלת לטור אחד באותו סדר.

          ‏עד כאן זה היה טור צר של 340px ולידו רחב: „מה הוא מחפש”,
          ‏הכרטיסייה הארוכה בעמוד, הייתה נדחסת לצר בזמן שהערות
          ‏ואנשי הקשר קיבלו את הרחב.
        */}
        <div className="grid items-start gap-[18px] lg:grid-cols-3">
          <div className="grid content-start gap-[18px]">
            {/*
              ---- שלמות פרופיל החיפוש ----
              כרטיס חצי-מלא נראה בדיוק כמו כרטיס מלא, ולכן סוכן מריץ
              התאמות על תקציב ועיר בלבד ומסיק שהמנוע לא מדויק. כאן
              רואים מה עוד לא נשאל, וכל חוסר הוא קישור להשלמה.
            */}
            <section
              className="mv-list-card px-5 py-[18px]"
              aria-labelledby="profile-heading"
            >
              <div className="mb-2 flex items-baseline gap-2">
                <h2
                  id="profile-heading"
                  className="m-0"
                  style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
                >
                  פרטי חיפוש
                </h2>
                {/*
                  ‎**המונה נצבע לפי המצב, ולא רק נספר.**

                  ‏„1 מתוך 7” באפור נקרא כמידע; באותו כתום של שאר
                  ‏האזהרות במערכת הוא נקרא כמשהו שצריך לעשות איתו
                  ‏משהו. פרופיל מלא חוזר לירוק — סיום, לא אזהרה.
                */}
                <span
                  className={`mv-pill ms-auto ${
                    profile.missing.length === 0 ? "mv-domain-green" : "mv-domain-amber"
                  }`}
                >
                  {profile.filled} מתוך {profile.total} מולא
                </span>
              </div>
              <div className="mv-progress mb-3.5" style={{ maxWidth: "none", height: 8 }}>
                <span
                  style={{
                    width: `${Math.round((profile.filled / profile.total) * 100)}%`,
                    background: "linear-gradient(90deg, #3fbf63, #7df39c)",
                  }}
                />
              </div>
              {profile.missing.length === 0 ? (
                <p
                  className="m-0 text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  הפרופיל מלא — ההתאמות רצות על כל מה שהלקוח אמר.
                </p>
              ) : (
                /*
                  ‎**שורה מקווקוות לכל חוסר, ולא צ׳יפ.**

                  ‏הצ׳יפים נקראו כתגיות — כלומר כתיאור של הכרטיס —
                  ‏בזמן שהם למעשה **הזמנה למלא**. שורה ברוחב מלא עם
                  ‏מסגרת מקווקוות אומרת „כאן חסר משהו” בלי מילה,
                  ‏וההשלמה יושבת בשורה עצמה.
                */
                <div className="flex flex-col gap-2.5">
                  {profile.missing.map((f) => (
                    <Link
                      key={f.key}
                      href={`/buyers/${id}/edit`}
                      className="mv-fieldrow mv-fieldrow--missing no-underline"
                    >
                      <span
                        className="text-[length:var(--type-caption-lg)] font-bold"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {f.label}
                      </span>
                      <span
                        className="ms-auto text-[length:var(--type-caption)] font-black"
                        style={{ color: "var(--color-primary)" }}
                      >
                        + השלמה
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* ---- מה הוא מחפש ---- */}
            <section
              className="mv-list-card px-5 py-[18px]"
              aria-labelledby="req-heading"
            >
              <h2
                id="req-heading"
                className="m-0 mb-3"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                מה הוא מחפש
              </h2>

              <div
                className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                תקציב
              </div>
              <div
                className="mb-[13px]"
                style={{ fontSize: "var(--type-metric)", fontWeight: 800 }}
              >
                {buyer.requirements.budgetMaxAgorot === undefined
                  ? "תקציב לא צוין"
                  : buyer.requirements.budgetMinAgorot !== undefined
                    ? `${formatPrice(buyer.requirements.budgetMinAgorot)}–${formatPrice(buyer.requirements.budgetMaxAgorot)}`
                    : `עד ${formatPrice(buyer.requirements.budgetMaxAgorot)}`}
              </div>
              {/* גם במילים — אימות מהיר שהסכום שנשמר הוא הסכום שהתכוונו לו */}
              <div
                className="mb-[13px] -mt-2 text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {buyer.requirements.budgetMaxAgorot === undefined
                  ? "בלי תקציב ההתאמות מדויקות פחות — שווה להשלים בשיחה הבאה"
                  : priceInWordsWithCurrency(
                      Math.round(buyer.requirements.budgetMaxAgorot / 100),
                    )}
              </div>

              <div
                className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                אזורים
              </div>
              <div className="mb-1 text-[length:var(--type-body)] font-bold">
                {buyer.requirements.cities.join(", ") || "—"}
              </div>
              {/*
                השכונות היו נשמרות ומשפיעות על ניקוד ההתאמה — ולא מוצגות
                בשום מקום. סוכן שראה רק "בני ברק" לא ידע שהלקוח ביקש
                שכונה מסוימת, וזה בדיוק הפרט שקובע אם שווה להתקשר.
              */}
              {buyer.requirements.neighborhoods.length > 0 ? (
                <div
                  className="mb-3.5 text-[length:var(--type-caption-lg)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  שכונות: {buyer.requirements.neighborhoods.join(" · ")}
                </div>
              ) : (
                <div className="mb-3.5" />
              )}

              {/*
                אותו כשל שהיה בשכונות: הסוגים פוסלים נכסים במנוע
                ההתאמות, ולא הופיעו בשום מקום בכרטיס. סוכן שראה רשימת
                התאמות קצרה מהצפוי לא יכול היה לדעת שהוא עצמו צמצם
                אותה. „כל הסוגים” אינו נכתב — היעדר צמצום אינו מידע.
              */}
              {buyer.requirements.propertyTypes.length > 0 ? (
                <>
                  <div
                    className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    סוג נכס
                  </div>
                  <div className="mb-3.5 text-[length:var(--type-body)] font-bold">
                    {buyer.requirements.propertyTypes
                      .map((t) => PROPERTY_TYPE_LABELS[t] ?? t)
                      .join(" · ")}
                  </div>
                </>
              ) : (
                /*
                 * ריק כאן אינו „כל הסוגים”: המנוע מסמן התאמה בלי סוג
                 * נכס כ„אין מספיק פרטים” ואינו מציע דבר — בניגוד לרשימת
                 * ערים ריקה, שכן פירושה „בלי מגבלה”. הטופס דורש סוג,
                 * אבל קונה שנקלט בייבוא או דרך ה-API מגיע בלעדיו, ואז
                 * המסך הראה „אין התאמות” בלי להגיד למה.
                 */
                <div className="mb-3.5">
                  <Notice tone="warning">
                    לא נבחר סוג נכס — בלי סוג נכס מנוע ההתאמות לא מציע דבר לקונה הזה.{" "}
                    <Link href={`/buyers/${buyer.id}/edit`} className="underline">
                      להשלים בדרישות
                    </Link>
                  </Notice>
                </div>
              )}

              {buyer.requirements.roomsMin !== undefined ||
              buyer.requirements.roomsMax !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    חדרים
                  </div>
                  <div className="mb-3.5 text-[length:var(--type-body)] font-bold">
                    {buyer.requirements.roomsMin ?? "—"}–
                    {buyer.requirements.roomsMax ?? "—"}
                  </div>
                </>
              ) : null}
              {buyer.requirements.areaSqmMin !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    שטח מינימלי
                  </div>
                  <div className="mb-3.5 text-[length:var(--type-body)] font-bold">
                    {buyer.requirements.areaSqmMin} מ&quot;ר
                  </div>
                </>
              ) : null}
              {/*
                ‎**הקומה מוצגת כמשפט ולא כמספרים.** „קרקע, קומה 1” ו„קומה
                3 ומעלה” הן שתי דרישות שונות בצורתן, וזוג מספרים לא היה
                יכול לשאת את שתיהן.
              */}
              {floorNeed !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    קומה רצויה
                  </div>
                  <div className="mb-3.5 text-[length:var(--type-body)] font-bold">{floorNeed}</div>
                </>
              ) : null}
              {/* "גמיש" ו"מיידי" הם אילוץ בדיוק כמו תאריך — ולכן מוצגים */}
              {entryNeed !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    מועד כניסה
                  </div>
                  <div className="mb-3.5 text-[length:var(--type-body)] font-bold">
                    {entryNeed}
                  </div>
                </>
              ) : null}

              <div
                className="mb-[7px] text-[length:var(--type-caption-lg)] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                דרישות חובה — שוברות התאמה
              </div>
              <div className="mb-3.5 flex flex-wrap gap-[7px]">
                {musts.length === 0 ? (
                  <span
                    className="text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    אין
                  </span>
                ) : (
                  musts.map(([k]) => (
                    <span
                      key={k}
                      className="mv-pill"
                      /*
                        אותו זוג טוקנים כמו ב-‎.mv-chip[aria-pressed]‎
                        וב„בקרוב” שבהגדרות (#266): הערך הקשיח שהיה כאן,
                        קפוא בשלוש הערכות, נתן 1.07:1 מול הכרטיס במצב
                        כהה.
                      */
                      style={{
                        background: "var(--color-primary)",
                        color: "var(--color-surface)",
                        fontSize: "var(--type-caption)",
                        padding: "4px 12px",
                      }}
                    >
                      {FEATURE_LABELS[k] ?? k}
                    </span>
                  ))
                )}
              </div>

              <div
                className="mb-[7px] text-[length:var(--type-caption-lg)] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                עדיפויות — משפיעות על הניקוד בלבד
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {nices.length === 0 ? (
                  <span
                    className="text-sm"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    אין
                  </span>
                ) : (
                  nices.map(([k]) => (
                    <span
                      key={k}
                      className="mv-pill"
                      style={{
                        background: "var(--chip-neutral-bg)",
                        /*
                          הצמד מומר יחד (#266): רקע שהומר וטקסט שנשאר
                          ישיר נתן כאן 2.02:1 בערכה הכהה — בדיוק ההמרה
                          החלקית שהשער הזה קיים כדי לתפוס. הטוקן הניטרלי
                          הקיים במרחק מאית מהערך שהיה, ולכן המראה נשמר.
                        */
                        color: "var(--domain-neutral-fg)",
                        fontSize: "var(--type-caption)",
                        padding: "4px 12px",
                      }}
                    >
                      {FEATURE_LABELS[k] ?? k}
                    </span>
                  ))
                )}
              </div>

              {buyer.requirements.flexibilityNotes ? (
                <>
                  <div
                    className="mb-1.5 mt-3.5 text-[length:var(--type-caption-lg)] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    גמישות
                  </div>
                  <div className="text-sm">
                    {buyer.requirements.flexibilityNotes}
                  </div>
                </>
              ) : null}
            </section>
          </div>

          <div className="grid content-start gap-[18px]">
            {/*
              ---- הערות הסוכן ----

              ‏בראש הטור, בהחלטת בעל המוצר. מה שהסוכן כתב ביד אחרי
              ‏השיחה הקודמת הוא מה שנקרא לפני הבאה, ולכן הוא מעל
              ‏ההזמנה למילוי עצמי ולא מתחתיה.
            */}
            <EntityNotes
              value={buyer.agentNotes}
              fieldId="agentNotes"
              title="הערות הסוכן"
              canEdit={canEditPeople}
              onSave={saveNotes}
            />

            {/*
              ---- הלקוח ממלא בעצמו ----

              ‏מתחת להערות. קודם ישב כאן ראשון, בנימוק שהכרטיס שמעל
              ‏אומר „מה חסר” וזה אומר „איך להשלים בלי להקליד” —
              ‏נימוק תקף, וההערה נשארת כאן כדי שלא יוחזר בתום לב.
              ‏הוא נדחה מפני זה: ההערות נקראות בכל פתיחה של הכרטיס,
              ‏וההזמנה נשלחת פעם אחת.
            */}
            <IntakePanel subject="buyer" entityId={id} canEdit={canEditPeople} />
          </div>

          <div className="grid content-start gap-[18px]">
            {/* `canErase={false}`: מחיקת הלקוח ירדה לאזור המחיקות
                בתחתית הכרטיס, יחד עם מחיקת הכרטיס */}
            <ContactPeople
              contactId={buyer.contact.id}
              canEdit={canEditPeople}
            />
          </div>
        </div>

        {/*
          ‏„מה עוד קשור לאדם הזה” אינו אחד משלושת הטורים — הוא
          ‏מסקנה עליהם, ולכן מתחתיהם ועל פני כל הרוחב.
        */}
        <RelatedEntities
          contactId={buyer.contact.id}
          exclude={{ kind: "buyer", id: buyer.id }}
        />

        {/*
          שתי המחיקות יחד, מתחת לטורים ומקופלות.
          מחיקת הכרטיס נפרדת ממחיקת הלקוח, ובכוונה: הכרטיס הוא
          הביקוש, והאדם נשאר עם הלידים וההיסטוריה שלו — וזו בדיוק
          הבחירה שהמשתמש לא ראה כשהשתיים ישבו בשני מקומות שונים.
        */}
        {can(user, "buyers.delete") || can(user, "contacts.delete") ? (
          <DangerZone>
            {can(user, "buyers.delete") ? <DeleteBuyer buyerId={id} /> : null}
            {can(user, "contacts.delete") ? (
              <ContactErasure
                contactId={buyer.contact.id}
                name={buyer.contact.name}
              />
            ) : null}
          </DangerZone>
        ) : null}
      </TabPanel>

      {/* ============================================================
          התאמות — אותה שאלה משני מקורות, ומה כבר נשלח
          ============================================================ */}
      <TabPanel tab="matches" active={tab}>
        <div className="grid items-start gap-[18px]">
          {/*
            שמאל: המאגר הפנימי. ימין: הרשת. אותה שאלה, שני מקורות —
            וכל עוד הן היו במסכים נפרדים הסוכן ראה חצי תשובה וסגר את
            הכרטיס. אותו מנוע ניקוד ואותו סף בשתיהן, אחרת אי אפשר
            להשוות ביניהן.
          */}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section
              className="mv-list-card px-[22px] py-[18px]"
              aria-labelledby="matches-heading"
            >
              <h2
                id="matches-heading"
                className="m-0 mb-1"
                style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
              >
                נכסים מתאימים
              </h2>
              <p
                className="m-0 mb-2.5 text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                נכסים ששוברים דרישת חובה אינם מופיעים
              </p>

              {matchesFailed ? (
                <LoadError
                  message="לא הצלחנו לטעון את ההתאמות"
                  onRetry={loadMatches}
                />
              ) : matches === null ? (
                <p aria-live="polite">מחשב התאמות…</p>
              ) : matches.length === 0 ? (
                <p
                  className="m-0 py-2"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  אין עדיין נכסים מתאימים במאגר.
                </p>
              ) : (
                matches.map((m) => {
                  const offer = offers[m.id];
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
                      <div
                        className="min-w-0 flex-1"
                        style={{ lineHeight: 1.4 }}
                      >
                        <div className="text-[length:var(--type-body)] font-bold">
                          <Link
                            href={`/properties/${m.propertyId}`}
                            className="no-underline hover:underline"
                            style={{ color: "inherit" }}
                          >
                            {m.property.title ?? m.property.address}
                          </Link>
                          {m.property.priceAgorot !== undefined ? (
                            <span
                              className="ms-1.5 text-[length:var(--type-caption)] font-semibold"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              · {formatPrice(m.property.priceAgorot)}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="text-[length:var(--type-caption-lg)]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {m.explanation}
                        </div>
                      </div>
                      <div className="ms-auto flex-none">
                        {offer ? (
                          <a
                            href={offer.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mv-pill no-underline"
                            style={{
                              background: "var(--color-primary-soft)",
                              color: "var(--color-primary)",
                            }}
                          >
                            הצעה נשלחה ✓
                          </a>
                        ) : (
                          <button
                            type="button"
                            className="mv-btn-action"
                            style={{ padding: "7px 15px", fontSize: "var(--type-caption-lg)" }}
                            disabled={sending !== null}
                            onClick={() => void sendOffer(m)}
                          >
                            {sending === m.id ? "שולח…" : "שלח הצעה"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            <NetworkPropertyMatches buyerId={id} />
          </div>

          {/* היסטוריית ההצעות נשארת רוחב מלא — היא לא עמודה, היא ציר זמן */}
          <section className="mv-list-card px-[22px] py-[18px]">
            <h2
              className="m-0 mb-2"
              style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}
            >
              היסטוריית הצעות
            </h2>
            {sentOffers.length === 0 ? (
              isHotNoOffers ? (
                <p
                  className="m-0 rounded-[9px] px-[13px] py-2.5 text-[length:var(--type-body-sm)] font-bold"
                  style={{ color: "var(--color-danger)", background: "var(--color-danger-soft)" }}
                >
                  קונה חם שעדיין לא קיבל אף הצעה — שווה לטפל היום.
                </p>
              ) : (
                <p
                  className="m-0 text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  עוד לא נשלחו הצעות לקונה הזה.
                </p>
              )
            ) : (
              sentOffers.map(([matchId, offer]) => {
                const match = (matches ?? []).find((m) => m.id === matchId);
                const chip = offerChip(offer);
                return (
                  <div
                    key={offer.id}
                    className="flex flex-wrap items-center gap-2.5 py-[9px] text-[length:var(--type-body-sm)]"
                    style={{
                      borderBottom: "1px solid var(--color-row-border)",
                    }}
                  >
                    <span className="font-bold">
                      {match?.property.title ??
                        match?.property.address ??
                        "נכס"}
                    </span>
                    <span style={{ color: "var(--color-text-muted)" }}>
                      {offer.openCount === 0
                        ? "טרם נפתחה"
                        : `נפתחה ${offer.openCount} פעמים`}
                    </span>
                    <span
                      className="mv-pill ms-auto"
                      style={{
                        color: chip.fg,
                        background: chip.bg,
                        fontSize: "var(--type-caption)",
                      }}
                    >
                      {chip.label}
                    </span>
                  </div>
                );
              })
            )}
          </section>
        </div>
      </TabPanel>

      <TabPanel tab="tasks" active={tab}>
        <EntityTasks entityType="buyer" entityId={id} />
      </TabPanel>

      <TabPanel tab="timeline" active={tab}>
        <TimelineSection buyerId={id} />
      </TabPanel>

      <TabPanel tab="agreements" active={tab}>
        <AgreementsPanel
          contactId={buyer.contact.id}
          kind="brokerage"
          title="הזמנה בכתב (הסכם תיווך)"
        />
        {/*
          ‎**אותה לשונית** (בקשת המשתמשת): הזמנה בכתב שנחתמה במערכת
          והזמנה בכתב שנחתמה על נייר הן אותה עובדה, ושתיהן פותחות את
          שער ההצעות. הפרדה לשני מקומות הייתה מבקשת מהמתווך לזכור
          איפה חתם הלקוח הזה.
        */}
        <DocumentsPanel
          contactId={buyer.contact.id}
          defaultKind="brokerage"
          canEdit={can(user, "offers.send")}
        />
      </TabPanel>

      <TabPanel tab="network" active={tab}>
        <NetworkShareSection
          kind="buyer"
          entityId={id}
          {...(buyer.agentNotes ? { defaultNote: buyer.agentNotes } : {})}
        />
      </TabPanel>

      {/*
        ‎---- ניווט תחתון — מובייל בלבד ---- (בקשת המשתמש)

        ‏ארבע הלשוניות שסוכן עובר ביניהן בשטח, במרחק אגודל. הן
        ‏**אותן** לשוניות של הפס העליון ואותו `selectTab` — לא ניווט
        ‏שני שצריך לזכור לסנכרן, אלא אותו מצב בשתי נקודות מגע.
        ‏„מסמכים” ו„שיתופי פעולה” נשארים בפס העליון: הם נפתחים במשרד,
        ‏לא בין פגישות.

        ‎`aria-current` ולא צבע בלבד — במצב ניגודיות גבוהה שני
        ‏הגוונים נופלים לאותו שחור.

        ‏הפס מרחף מעל התוכן (`fixed`), ולכן לפניו מרווח בגובהו:
        ‏בלעדיו הכפתור האחרון בלשונית היה יושב מתחתיו ולא ניתן
        ‏ללחיצה.
      */}
      <div className="mv-bottomnav-space" aria-hidden="true" />
      <nav className="mv-bottomnav" aria-label="לשוניות הכרטיס">
        {(
          [
            ["overview", "כרטיס"],
            ["matches", "התאמות"],
            ["tasks", "משימות"],
            ["timeline", "ציר זמן"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key}
            onClick={() => selectTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
