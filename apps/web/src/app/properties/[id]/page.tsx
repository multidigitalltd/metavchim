"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLE_CAPABILITIES } from "@metavchim/shared";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import {
  FIELD_LABELS,
  formatDate,
  formatPrice,
  MATURITY_LABELS,
  PROPERTY_TYPE_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { MediaSection } from "./media-section";
import { PropertyOwner, type OwnerContact } from "../property-owner";

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
  entryDate?: string;
  status: string;
  marketingTitle?: string;
  readinessScore: number;
  missingFields: string[];
  ownerContact?: OwnerContact;
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

const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: "הצעה נשלחה",
  opened: "הקונה פתח את ההצעה",
  interested: "👍 הקונה מעוניין!",
  declined: "הקונה דחה",
};

const MATURITY_TAG: Record<string, { fg: string; bg: string }> = {
  very_hot: { fg: "#b0512c", bg: "#faf1ec" },
  hot: { fg: "#7a5c1f", bg: "#f7efdd" },
  interested: { fg: "#0C6E34", bg: "#E5FCEA" },
  not_ripe: { fg: "#68716a", bg: "#eef1ec" },
};

function readinessColor(score: number): string {
  if (score >= 85) return "#12A150";
  if (score >= 70) return "#c98a2e";
  return "#b0512c";
}
function readinessTextColor(score: number): string {
  if (score >= 85) return "var(--color-primary)";
  if (score >= 70) return "#8a6414";
  return "#b0512c";
}

export default function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  const canEditOwner = (ROLE_CAPABILITIES[user?.role ?? ""] ?? []).includes("properties.edit");
  const router = useRouter();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
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

  useEffect(() => {
    if (authLoading) return;
    loadProperty();
    apiGet<MatchRow[]>(`/properties/${id}/matches`)
      .then((rows) => {
        setMatches(rows);
        if (rows.length > 0) {
          const ids = rows.map((m) => m.id).join(",");
          apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
            .then(setOffers)
            .catch(() => undefined);
        }
      })
      .catch(() => setMatches([]));
  }, [authLoading, id, loadProperty]);

  async function createOffer(matchId: string) {
    const offer = await apiPost<OfferInfo & { matchId: string }>("/offers", { matchId });
    setOffers((prev) => ({ ...prev, [matchId]: offer }));
    await navigator.clipboard.writeText(offer.url).catch(() => undefined);
    setCopiedFor(matchId);
  }

  /** פותח וואטסאפ עם ההודעה והקישור מוכנים — המתווך רק לוחץ שלח (אפיון §10). */
  async function sendWhatsApp(offerId: string) {
    const { waUrl } = await apiPost<{ waUrl: string }>(`/offers/${offerId}/whatsapp`, {});
    window.open(waUrl, "_blank", "noopener");
  }

  /** עדכון שיווק לבעל הנכס — משפך הנכס בהודעת וואטסאפ מוכנה לשליחה. */
  async function sendOwnerUpdate() {
    const { waUrl } = await apiPost<{ waUrl: string }>(`/properties/${id}/owner-update`, {});
    window.open(waUrl, "_blank", "noopener");
  }

  /** דף נחיתה ציבורי לנכס — יצירת הקישור והעתקתו ללוח. */
  async function createLanding() {
    setLandingBusy(true);
    try {
      const { url } = await apiPost<{ url: string }>(`/properties/${id}/landing`, {});
      setLandingUrl(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
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

  /** שליחה מרובה בשני שלבים — אישור מפורש לפני יצירת הצעות (אפיון §10). */
  async function bulkSend() {
    if (!bulkConfirm) {
      setBulkConfirm(true);
      return;
    }
    setBulkConfirm(false);
    const result = await apiPost<{ created: number }>("/offers/bulk", {
      propertyId: id,
      minScore: 85,
    });
    setBulkResult(`נוצרו ${result.created} הצעות — לחצו "שלח בוואטסאפ" על כל אחת`);
    const rows = await apiGet<MatchRow[]>(`/properties/${id}/matches`);
    setMatches(rows);
    if (rows.length > 0) {
      const ids = rows.map((m) => m.id).join(",");
      apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
        .then(setOffers)
        .catch(() => undefined);
    }
  }

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/properties" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!property) return <p aria-live="polite">טוען…</p>;

  const address = [property.street, property.neighborhood, property.city].filter(Boolean).join(", ");
  const features = [
    property.hasElevator && "מעלית",
    property.hasParking && "חניה",
    property.hasBalcony && "מרפסת",
    property.hasSafeRoom && 'ממ"ד',
  ].filter(Boolean) as string[];

  const detailFields: [string, string][] = [
    ["סוג", property.propertyType ? (PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType) : "—"],
    ["חדרים", property.rooms !== undefined ? String(property.rooms) : "—"],
    ["שטח", property.areaSqm ? `${property.areaSqm} מ"ר` : "—"],
    ["קומה", property.floor !== undefined ? `${property.floor}${property.totalFloors ? ` מתוך ${property.totalFloors}` : ""}` : "—"],
    ["כניסה", formatDate(property.entryDate) || "—"],
    ["מאפיינים", features.length > 0 ? features.join(", ") : "—"],
  ];

  const bulkEligible = (matches ?? []).filter((m) => m.score >= 85 && !offers[m.id]).length;

  return (
    <>
      <Link
        href="/properties"
        className="mb-3.5 inline-block text-[13.5px] font-bold no-underline hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        → חזרה לרשימת הנכסים
      </Link>

      {/* ---- כרטיס הכותרת ---- */}
      <div className="mv-list-card mb-[18px] p-6" style={{ overflow: "visible" }}>
        <div className="flex flex-wrap items-start gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0" style={{ fontSize: 23, fontWeight: 800 }}>
                {property.marketingTitle ?? (address || "נכס")}
              </h1>
              <label>
                <span className="mv-visually-hidden">שינוי סטטוס הנכס</span>
                <select
                  value={property.status}
                  disabled={statusSaving}
                  onChange={(e) => void changeStatus(e.target.value)}
                  className="mv-pill border-0"
                  style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)", cursor: "pointer" }}
                >
                  {Object.entries(STATUS_LABELS)
                    .filter(([value]) => value !== "archived")
                    .map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                </select>
              </label>
            </div>
            <p className="m-0 mt-[5px] text-sm" style={{ color: "var(--color-text-muted)" }}>
              {/*
                בעל הנכס היה כאן כשורה בכותרת המשנה. הוא עבר לסעיף
                משלו בטור הראשי — הוא צד לעסקה, לא הערת שוליים לכתובת.
              */}
              {address}
            </p>
          </div>
          <div className="ms-auto text-start">
            <div style={{ fontSize: 25, fontWeight: 800 }}>{formatPrice(property.priceAgorot)}</div>
            <div className="mt-[9px] flex flex-wrap gap-2">
              <Link href={`/properties/${id}/edit`} className="mv-btn-plain" style={{ padding: "7px 13px", fontSize: 13 }}>
                עריכה
              </Link>
              <Link href={`/calendar/new?propertyId=${id}`} className="mv-btn-plain" style={{ padding: "7px 13px", fontSize: 13 }}>
                קבע סיור
              </Link>
              <button
                type="button"
                className="mv-btn-soft"
                style={{ padding: "7px 13px", fontSize: 13 }}
                disabled={landingBusy}
                onClick={() => void createLanding()}
              >
                {landingBusy ? "יוצר…" : "צור דף נחיתה"}
              </button>
              <a href="#matches-heading" className="mv-btn-action" style={{ padding: "7px 15px", fontSize: 13 }}>
                מצא לי קונים
              </a>
            </div>
          </div>
        </div>

        {landingUrl ? (
          <p role="status" className="m-0 mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#F1FEF4", border: "1px solid #BDF4CB" }}>
            <span className="font-bold" style={{ color: "var(--color-primary)" }}>✓ דף הנחיתה מוכן והקישור הועתק:</span>
            <a href={landingUrl} target="_blank" rel="noopener noreferrer" dir="ltr" className="underline" style={{ color: "var(--color-primary)" }}>
              {landingUrl}
            </a>
            <span style={{ color: "var(--color-text-muted)" }}>
              — שלחו בוואטסאפ, פרסמו במודעה, וכל פנייה מהדף תיכנס ללידים.
            </span>
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-[18px] lg:[grid-template-columns:1fr_340px]">
        {/* ---- הטור הראשי ---- */}
        <div className="flex flex-col gap-[18px]">
          <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="details-heading">
            <h2 id="details-heading" className="m-0 mb-3.5" style={{ fontSize: 15.5, fontWeight: 800 }}>
              פרטי הנכס
            </h2>
            <dl className="m-0 grid gap-x-[18px] gap-y-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              {detailFields.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>{label}</dt>
                  <dd className="m-0 mt-0.5 text-[14.5px] font-bold">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <PropertyOwner
            propertyId={id}
            owner={property.ownerContact}
            canEdit={canEditOwner}
            onChanged={loadProperty}
            onSendUpdate={() => void sendOwnerUpdate()}
          />

          <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="matches-heading">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 id="matches-heading" className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
                קונים מתאימים מהמאגר
              </h2>
              <span className="text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
                כל התאמה מוסברת — בלי קופסה שחורה
              </span>
              {bulkEligible >= 2 ? (
                <button
                  type="button"
                  className={bulkConfirm ? "mv-btn-plain ms-auto" : "mv-btn-action ms-auto"}
                  style={bulkConfirm ? { color: "var(--color-danger)" } : { padding: "7px 15px", fontSize: 13 }}
                  onClick={() => void bulkSend()}
                >
                  {bulkConfirm ? `לאשר יצירת ${bulkEligible} הצעות?` : "צור הצעות לכל המתאימים (85%+)"}
                </button>
              ) : null}
            </div>
            {bulkResult ? (
              <p role="status" className="mb-3 text-sm font-bold" style={{ color: "var(--color-primary)" }}>
                ✓ {bulkResult}
              </p>
            ) : null}

            {matches === null ? (
              <p aria-live="polite">מחשב התאמות…</p>
            ) : matches.length === 0 ? (
              <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                אין עדיין קונים מתאימים. <Link href="/buyers/new" className="underline">הוסיפו קונה</Link> — וההתאמות יחושבו אוטומטית.
              </p>
            ) : (
              matches.map((m) => {
                const offer = offers[m.id];
                const tag = m.buyerMaturity ? MATURITY_TAG[m.buyerMaturity] : undefined;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-[15px] py-[13px]" style={{ borderBottom: "1px solid var(--color-row-border)" }}>
                    <span
                      className="mv-score-ring"
                      style={{ width: 46, height: 46, background: `conic-gradient(#2ECC66 ${Math.round(m.score * 3.6)}deg, var(--color-progress-track) 0deg)` }}
                      aria-hidden="true"
                    >
                      <span style={{ width: 35, height: 35, fontSize: 12 }}>{m.score}%</span>
                    </span>
                    <div className="min-w-0 flex-1" style={{ lineHeight: 1.4 }}>
                      <div className="text-[14.5px] font-bold">
                        {m.buyerName ? (
                          <Link href={`/buyers/${m.buyerId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                            {m.buyerName}
                          </Link>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>קונה של סוכן אחר</span>
                        )}
                        {tag && m.buyerMaturity ? (
                          <span className="mv-tag ms-1.5" style={{ color: tag.fg, background: tag.bg, fontWeight: 600, fontSize: 12.5, padding: "1px 8px" }}>
                            {MATURITY_LABELS[m.buyerMaturity] ?? m.buyerMaturity}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>{m.explanation}</div>
                      {offer ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[13px]">
                          <span className="font-bold" style={{ color: offer.status === "interested" ? "var(--color-primary)" : "var(--color-text-soft)" }}>
                            {OFFER_STATUS_LABELS[offer.status] ?? offer.status}
                            {offer.openCount > 0 ? ` (${offer.openCount} צפיות)` : ""}
                          </span>
                          <a href={offer.url} target="_blank" rel="noreferrer" className="underline">דף ההצעה</a>
                          {copiedFor === m.id ? (
                            <span role="status" style={{ color: "var(--color-primary)" }}>✓ הקישור הועתק</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="ms-auto flex flex-none gap-2">
                      {offer ? (
                        <button type="button" className="mv-btn-action" style={{ padding: "7px 15px", fontSize: 13 }} onClick={() => void sendWhatsApp(offer.id)}>
                          שלח בוואטסאפ
                        </button>
                      ) : (
                        <button type="button" className="mv-btn-action" style={{ padding: "7px 15px", fontSize: 13 }} onClick={() => void createOffer(m.id)}>
                          שלח הצעה
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <p className="m-0 mt-3 rounded-[9px] px-[13px] py-[9px] text-[12.5px]" style={{ color: "var(--color-text-muted)", background: "var(--color-table-head)" }}>
              קונים שדרישת חובה שלהם נשברת (למשל: חובה מעלית ואין) — לא מוצגים כאן בכלל.
            </p>
          </section>
        </div>

        {/* ---- הטור הצדדי ---- */}
        <div className="flex flex-col gap-[18px]">
          <section className="mv-list-card px-5 py-[18px]" aria-labelledby="readiness-heading">
            <div className="flex items-baseline">
              <h2 id="readiness-heading" className="m-0" style={{ fontSize: 15.5, fontWeight: 800 }}>
                מוכנות לשיווק
              </h2>
              <span className="ms-auto" style={{ fontSize: 21, fontWeight: 800, color: readinessTextColor(property.readinessScore) }}>
                {property.readinessScore}%
              </span>
            </div>
            <div className="my-[11px] mb-[13px] overflow-hidden rounded-full" style={{ height: 7, background: "var(--color-progress-track)" }}>
              <div style={{ height: "100%", width: `${property.readinessScore}%`, background: readinessColor(property.readinessScore), borderRadius: 99 }} />
            </div>
            {property.missingFields.length === 0 ? (
              <p className="m-0 text-[13px] font-bold" style={{ color: "var(--color-primary)" }}>
                ✓ הנכס מוכן לשיווק
              </p>
            ) : (
              property.missingFields.map((field) => (
                <div key={field} className="flex items-center gap-2 py-[5px] text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                  <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: "#c98a2e" }} />
                  {FIELD_LABELS[field] ?? field}
                </div>
              ))
            )}
            {property.missingFields.length > 0 ? (
              <Link href={`/properties/${id}/edit`} className="mv-btn-soft mt-2 inline-block">
                השלם פרטים
              </Link>
            ) : null}
          </section>

          <section className="mv-list-card px-5 py-[18px]" aria-labelledby="media-heading">
            <h2 id="media-heading" className="m-0 mb-3" style={{ fontSize: 15.5, fontWeight: 800 }}>
              תמונות
            </h2>
            <MediaSection propertyId={id} address={address} />
          </section>

          <button
            type="button"
            className="mv-btn-plain self-start"
            style={{ color: archiveConfirm ? "var(--color-danger)" : "var(--color-text-muted)" }}
            onClick={() => void archive()}
          >
            {archiveConfirm ? "לאשר העברה לארכיון?" : "העבר לארכיון"}
          </button>
          {archiveConfirm ? (
            <button type="button" className="mv-btn-plain self-start" onClick={() => setArchiveConfirm(false)}>
              ביטול
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
