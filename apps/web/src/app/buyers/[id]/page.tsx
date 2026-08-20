"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import {
  buyerProfileCompleteness,
  describeEntryNeed,
  priceInWordsWithCurrency,
} from "@metavchim/shared";
import type { BuyerRequirements } from "@metavchim/shared";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  DEAL_TYPE_LABELS,
  FINANCING_LABELS,
  formatBuyerSource,
  formatPrice,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  waMeUrl,
} from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { IconChat, IconEdit, IconPhone } from "../../icons";
import { NetworkShareSection } from "../../network-share-section";
import { NetworkPropertyMatches } from "../network-property-matches";
import { TimelineSection } from "./timeline-section";
import { ContactPeople } from "../../contact-people";
import { DeleteBuyer } from "../delete-buyer";
import { ContactErasure } from "../../contact-erasure";
import { DangerZone } from "../../danger-zone";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks } from "../../entity-tasks";
import { ClickToDial } from "../../click-to-dial";
import { AgreementsPanel } from "../../agreements-panel";
import { EntityNotes } from "../../entity-notes";
import { SelectMenu } from "../../select-menu";
import { EntityTabs, TabPanel, useEntityTab } from "../../entity-tabs";
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
  source: string;
  agentNotes?: string;
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
  very_hot: { fg: "#b0512c", bg: "#faf1ec" },
  hot: { fg: "#7a5c1f", bg: "#f7efdd" },
  interested: { fg: "#0C6E34", bg: "#E5FCEA" },
  not_ripe: { fg: "#68716a", bg: "#eef1ec" },
};

/* גלולות סטטוס ההצעה בהיסטוריה — כללי stChip מהעיצוב */
function offerChip(o: OfferInfo): { label: string; fg: string; bg: string } {
  if (o.status === "interested")
    return { label: "מעוניין ✓", fg: "#0C6E34", bg: "#E5FCEA" };
  if (o.status === "declined")
    return { label: "לא מתאים", fg: "#68716a", bg: "#eef1ec" };
  if (o.openCount >= 3)
    return { label: "מתלבט — שווה טלפון", fg: "#7a5c1f", bg: "#f7efdd" };
  if (o.openCount > 0) return { label: "נפתחה", fg: "#3F4742", bg: "#EDEFED" };
  return { label: "נשלחה", fg: "#68716a", bg: "#eef1ec" };
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
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
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
    apiGet<{ status: string }[]>(`/tasks/for/buyer/${id}`)
      .then((rows) =>
        setOpenTasks(rows.filter((t) => t.status === "open").length),
      )
      .catch(() => setOpenTasks(undefined));
  }, [id]);

  const [tab, selectTab] = useEntityTab(
    ["overview", "matches", "tasks", "timeline", "agreements", "network"],
    "overview",
  );

  /** עדכון בשלות במקום — הקונה "התחמם"? בחירה אחת והמערכת מסונכרנת. */
  async function changeMaturity(maturity: string) {
    await apiPatch(`/buyers/${id}`, { maturity });
    setBuyer((prev) => (prev ? { ...prev, maturity } : prev));
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

  useEffect(() => {
    if (authLoading) return;
    apiGet<BuyerDetail>(`/buyers/${id}`)
      .then(setBuyer)
      .catch(() => setError("הקונה לא נמצא"));
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
      .catch(() => setMatches([]));
  }, [authLoading, id]);

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
        className="mb-3.5 inline-block text-[15px] font-bold no-underline hover:underline"
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
            fontSize: 19,
          }}
        >
          {initials(buyer.contact.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0" style={{ fontSize: 21, fontWeight: 800 }}>
              {buyer.contact.name}
            </h1>
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
              onChange={(next) => void changeMaturity(next)}
              options={Object.entries(MATURITY_LABELS).map(
                ([value, label]) => ({ value, label }),
              )}
              label="עדכון בשלות"
              minWidth={128}
              tone={{ fg: pill.fg, bg: pill.bg }}
            />
          </div>
          <p
            className="m-0 mt-1 text-[14.5px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span dir="ltr">{buyer.contact.phone}</span> ·{" "}
            {formatBuyerSource(buyer.source)} · מימון:{" "}
            {FINANCING_LABELS[buyer.financing] ?? buyer.financing}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <a
            href={waMeUrl(buyer.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconChat s={14} /> וואטסאפ
          </a>
          <a
            href={`tel:${buyer.contact.phone}`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconPhone s={14} /> חייג
          </a>
          <ClickToDial
            contactId={buyer.contact.id}
            phone={buyer.contact.phone}
            label="מהמרכזייה"
          />
          <Link
            href={`/buyers/${id}/edit`}
            className="mv-btn-plain"
            style={{ minHeight: 36, paddingInline: 13, fontSize: 14.5 }}
          >
            <IconEdit s={14} /> ערוך דרישות
          </Link>
        </div>
      </div>

      {/* ---- לשוניות ---- */}
      <div
        className="mv-list-card mb-[18px] px-4"
        style={{ overflow: "visible" }}
      >
        <EntityTabs
          label="לשוניות כרטיס הקונה"
          active={tab}
          onSelect={selectTab}
          tabs={[
            { key: "overview", label: "סקירה" },
            { key: "matches", label: "התאמות", count: matches?.length },
            { key: "tasks", label: "משימות", count: openTasks },
            { key: "timeline", label: "ציר זמן" },
            { key: "agreements", label: "הסכמים" },
            { key: "network", label: "שיתופי פעולה" },
          ]}
        />
      </div>

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
                  style={{ fontSize: 16.5, fontWeight: 800 }}
                >
                  פרטי חיפוש
                </h2>
                <span
                  className="ms-auto text-[14px] font-bold"
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
                  className="m-0 text-[14.5px]"
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

            {/* ---- מה הוא מחפש ---- */}
            <section
              className="mv-list-card px-5 py-[18px]"
              aria-labelledby="req-heading"
            >
              <h2
                id="req-heading"
                className="m-0 mb-3"
                style={{ fontSize: 16.5, fontWeight: 800 }}
              >
                מה הוא מחפש
              </h2>

              <div
                className="mb-1.5 text-[14.5px] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                תקציב
              </div>
              <div
                className="mb-[13px]"
                style={{ fontSize: 20, fontWeight: 800 }}
              >
                {buyer.requirements.budgetMaxAgorot === undefined
                  ? "תקציב לא צוין"
                  : buyer.requirements.budgetMinAgorot !== undefined
                    ? `${formatPrice(buyer.requirements.budgetMinAgorot)}–${formatPrice(buyer.requirements.budgetMaxAgorot)}`
                    : `עד ${formatPrice(buyer.requirements.budgetMaxAgorot)}`}
              </div>
              {/* גם במילים — אימות מהיר שהסכום שנשמר הוא הסכום שהתכוונו לו */}
              <div
                className="mb-[13px] -mt-2 text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {buyer.requirements.budgetMaxAgorot === undefined
                  ? "בלי תקציב ההתאמות מדויקות פחות — שווה להשלים בשיחה הבאה"
                  : priceInWordsWithCurrency(
                      Math.round(buyer.requirements.budgetMaxAgorot / 100),
                    )}
              </div>

              <div
                className="mb-1.5 text-[14.5px] font-semibold"
                style={{ color: "var(--color-text-muted)" }}
              >
                אזורים
              </div>
              <div className="mb-1 text-[15.5px] font-bold">
                {buyer.requirements.cities.join(", ") || "—"}
              </div>
              {/*
                השכונות היו נשמרות ומשפיעות על ניקוד ההתאמה — ולא מוצגות
                בשום מקום. סוכן שראה רק "בני ברק" לא ידע שהלקוח ביקש
                שכונה מסוימת, וזה בדיוק הפרט שקובע אם שווה להתקשר.
              */}
              {buyer.requirements.neighborhoods.length > 0 ? (
                <div
                  className="mb-3.5 text-[14.5px]"
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
                    className="mb-1.5 text-[14.5px] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    סוג נכס
                  </div>
                  <div className="mb-3.5 text-[15.5px] font-bold">
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
                    className="mb-1.5 text-[14.5px] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    חדרים
                  </div>
                  <div className="mb-3.5 text-[15.5px] font-bold">
                    {buyer.requirements.roomsMin ?? "—"}–
                    {buyer.requirements.roomsMax ?? "—"}
                  </div>
                </>
              ) : null}
              {buyer.requirements.areaSqmMin !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[14.5px] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    שטח מינימלי
                  </div>
                  <div className="mb-3.5 text-[15.5px] font-bold">
                    {buyer.requirements.areaSqmMin} מ&quot;ר
                  </div>
                </>
              ) : null}
              {/* "גמיש" ו"מיידי" הם אילוץ בדיוק כמו תאריך — ולכן מוצגים */}
              {entryNeed !== undefined ? (
                <>
                  <div
                    className="mb-1.5 text-[14.5px] font-semibold"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    מועד כניסה
                  </div>
                  <div className="mb-3.5 text-[15.5px] font-bold">
                    {entryNeed}
                  </div>
                </>
              ) : null}

              <div
                className="mb-[7px] text-[14.5px] font-semibold"
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
                      style={{
                        background: "#111513",
                        color: "#fff",
                        fontSize: 14,
                        padding: "4px 12px",
                      }}
                    >
                      {FEATURE_LABELS[k] ?? k}
                    </span>
                  ))
                )}
              </div>

              <div
                className="mb-[7px] text-[14.5px] font-semibold"
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
                        background: "#eef1ec",
                        color: "#4a534c",
                        fontSize: 14,
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
                    className="mb-1.5 mt-3.5 text-[14.5px] font-semibold"
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
                style={{ fontSize: 16.5, fontWeight: 800 }}
              >
                נכסים מתאימים
              </h2>
              <p
                className="m-0 mb-2.5 text-[14px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                נכסים ששוברים דרישת חובה אינם מופיעים
              </p>

              {matches === null ? (
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
                        className="mv-score-ring"
                        style={{
                          width: 46,
                          height: 46,
                          background: `conic-gradient(#2ECC66 ${Math.round(m.score * 3.6)}deg, var(--color-progress-track) 0deg)`,
                        }}
                        aria-hidden="true"
                      >
                        <span style={{ width: 35, height: 35, fontSize: 14 }}>
                          {m.score}%
                        </span>
                      </span>
                      <div
                        className="min-w-0 flex-1"
                        style={{ lineHeight: 1.4 }}
                      >
                        <div className="text-[15.5px] font-bold">
                          <Link
                            href={`/properties/${m.propertyId}`}
                            className="no-underline hover:underline"
                            style={{ color: "inherit" }}
                          >
                            {m.property.title ?? m.property.address}
                          </Link>
                          {m.property.priceAgorot !== undefined ? (
                            <span
                              className="ms-1.5 text-[14px] font-semibold"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              · {formatPrice(m.property.priceAgorot)}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="text-[14.5px]"
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
                            style={{ padding: "7px 15px", fontSize: 14.5 }}
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
              style={{ fontSize: 16.5, fontWeight: 800 }}
            >
              היסטוריית הצעות
            </h2>
            {sentOffers.length === 0 ? (
              isHotNoOffers ? (
                <p
                  className="m-0 rounded-[9px] px-[13px] py-2.5 text-[15px] font-bold"
                  style={{ color: "#b0512c", background: "#faf1ec" }}
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
                    className="flex flex-wrap items-center gap-2.5 py-[9px] text-[15px]"
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
                        fontSize: 14,
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
