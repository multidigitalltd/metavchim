"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  buyerProfileCompleteness,
  describeEntryNeed,
  priceInWordsWithCurrency,  labelOf } from "@metavchim/shared";
import type { BuyerRequirements } from "@metavchim/shared";
import { activeOfficeStatuses, officeStatusById } from "@metavchim/shared";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  formatBuyerSource,
  formatDate,
  formatPrice,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  waMeUrl,
} from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { IconCalendar, IconChat, IconEdit, IconPhone } from "../../icons";
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
import { Notice } from "../../notice";

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
  source: string;
  agentNotes?: string;
  /** מתי הכרטיס נקלט — היה בשרת מאז ומתמיד ולא הוצהר כאן */
  createdAt: string;
}

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
  const [error, setError] = useState<string | null>(null);
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
    apiGet<MatchRow[]>(`/buyers/${id}/matches`)
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
        <span
          aria-hidden="true"
          className="grid flex-none place-items-center rounded-full"
          style={{
            width: 48,
            height: 48,
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
            fontWeight: 800,
            fontSize: "19px",
          }}
        >
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
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <a
            href={waMeUrl(buyer.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconChat s={14} /> וואטסאפ
          </a>
          <a
            href={`tel:${buyer.contact.phone}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconPhone s={14} /> חייג
          </a>
          <ClickToDial
            contactId={buyer.contact.id}
            phone={buyer.contact.phone}
            label="מהמרכזייה"
          />
          {/*
            ‎**קביעת סיור מצד הלקוח.**

            עד כה הכפתור היה קיים רק בכרטיס הנכס, ולכן הסיור נקבע
            תמיד מהכיוון של „איזה נכס” — בזמן שהעבודה היומית של
            מתווך מתחילה מ„עם מי”. מכאן הלקוח כבר מקושר, וטופס
            הפגישה מבקש רק את הנכס (או פותח נכס חדש ומחזיר לכאן).
          */}
          <Link
            href={`/calendar/new?buyerId=${id}&kind=viewing`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconCalendar s={14} /> קביעת סיור
          </Link>
          <Link
            href={`/buyers/${id}/edit`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: "var(--type-caption-lg)" }}
          >
            <IconEdit s={14} /> ערוך דרישות
          </Link>
        </div>
      </div>

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
        <div className="grid items-start gap-[18px] lg:[grid-template-columns:340px_1fr]">
          <div className="grid gap-[18px]">
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
                <span
                  className="ms-auto text-[length:var(--type-caption)] font-bold"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {profile.filled} מתוך {profile.total}
                </span>
              </div>
              <div
                className="mb-3 overflow-hidden rounded-full"
                style={{ height: 6, background: "var(--color-progress-track)" }}
              >
                <div
                  style={{
                    width: `${Math.round((profile.filled / profile.total) * 100)}%`,
                    height: "100%",
                    background: "var(--color-primary)",
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
                <div className="flex flex-wrap gap-1.5">
                  {profile.missing.map((f) => (
                    <Link
                      key={f.key}
                      href={`/buyers/${id}/edit`}
                      className="mv-chip no-underline"
                      style={{ color: "var(--color-text-soft)" }}
                    >
                      + {f.label}
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/*
              ---- הלקוח ממלא בעצמו ----
              מיד אחרי „פרטי חיפוש”, וזה לא מקרי: הכרטיס שמעל אומר
              מה חסר, וזה אומר איך להשלים את זה בלי להקליד. הלקוח
              יודע את התשובות טוב יותר, וממלא כשנוח לו.
            */}
            <IntakePanel subject="buyer" entityId={id} canEdit={canEditPeople} />

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
              ) : null}

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

          <div className="grid gap-[18px]">
            {/* ---- הערות הסוכן ---- */}
            <EntityNotes
              value={buyer.agentNotes}
              fieldId="agentNotes"
              title="הערות הסוכן"
              canEdit={canEditPeople}
              onSave={saveNotes}
            />

            {/* `canErase={false}`: מחיקת הלקוח ירדה לאזור המחיקות
                בתחתית הכרטיס, יחד עם מחיקת הכרטיס */}
            <ContactPeople
              contactId={buyer.contact.id}
              canEdit={canEditPeople}
            />

            <RelatedEntities
              contactId={buyer.contact.id}
              exclude={{ kind: "buyer", id: buyer.id }}
            />
          </div>
        </div>

        {/*
          שתי המחיקות יחד, מתחת לשני הטורים ומקופלות.
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
    </>
  );
}
