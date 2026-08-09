"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import {
  COMMISSION_SPLIT_OPTIONS,
  DEFAULT_COMMISSION_SPLIT,
  describeCommissionSplit,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { FINANCING_LABELS, formatBuyerSource, formatDate, formatPrice, MATURITY_LABELS, waMeUrl } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { WithDictation } from "../../dictation-field";
import { TimelineSection } from "./timeline-section";
import { ContactPeople } from "../../contact-people";
import { RelatedEntities } from "../../related-entities";
import { EntityTasks } from "../../entity-tasks";
import { ClickToDial } from "../../click-to-dial";
import { AgreementsPanel } from "../../agreements-panel";

/**
 * כרטיס הקונה לפי קובץ העיצוב: כרטיס כותרת עם אווטאר וגלולת בשלות,
 * "מה הוא מחפש" בטור צדדי (תקציב גדול, דרישות חובה כגלולות כהות),
 * ולצידו נכסים מתאימים עם טבעות ניקוד והיסטוריית הצעות.
 */

interface BuyerDetail {
  id: string;
  contact: { id: string; name: string; phone: string };
  requirements: {
    cities: string[];
    budgetMinAgorot?: number;
    budgetMaxAgorot: number;
    roomsMin?: number;
    roomsMax?: number;
    areaSqmMin?: number;
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
  if (o.status === "interested") return { label: "מעוניין ✓", fg: "#0C6E34", bg: "#E5FCEA" };
  if (o.status === "declined") return { label: "לא מתאים", fg: "#68716a", bg: "#eef1ec" };
  if (o.openCount >= 3) return { label: "מתלבט — שווה טלפון", fg: "#7a5c1f", bg: "#f7efdd" };
  if (o.openCount > 0) return { label: "נפתחה", fg: "#3F4742", bg: "#EDEFED" };
  return { label: "נשלחה", fg: "#68716a", bg: "#eef1ec" };
}

function initials(name: string): string {
  return name.trim().slice(0, 1);
}

export default function BuyerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading: authLoading } = useRequireAuth();
  // היכולת נגזרת מטבלת התפקידים המשותפת ולא מרשימת תפקידים מקומית —
  // שינוי הרשאות במקום אחד לא ישאיר כאן כפתור שהשרת ידחה
  const canEditPeople = can(user, "buyers.edit");
  const [buyer, setBuyer] = useState<BuyerDetail | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [offers, setOffers] = useState<Record<string, OfferInfo>>({});
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  /*
   * חלוקת העמלה נבחרת **לפני** השיתוף ולא אחריו. מו"מ על אחוזים
   * אחרי שהקונה כבר התעניין הוא המקום שבו שיתופי פעולה נשברים.
   */
  const [shareSplit, setShareSplit] = useState(DEFAULT_COMMISSION_SPLIT);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [notesSaved, setNotesSaved] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  /** עדכון בשלות במקום — הקונה "התחמם"? בחירה אחת והמערכת מסונכרנת. */
  async function changeMaturity(maturity: string) {
    await apiPatch(`/buyers/${id}`, { maturity });
    setBuyer((prev) => (prev ? { ...prev, maturity } : prev));
  }

  async function saveNotes() {
    if (notesDraft === null) return;
    await apiPatch(`/buyers/${id}`, { agentNotes: notesDraft });
    setBuyer((prev) => (prev ? { ...prev, agentNotes: notesDraft } : prev));
    setNotesDraft(null);
    setNotesSaved(true);
  }

  async function shareToNetwork() {
    try {
      await apiPost("/collaboration/share", { buyerId: id, commissionSplit: shareSplit });
      setShareStatus(
        `✓ הקונה שותף ברשת כביקוש אנונימי — בלי שם, בלי טלפון, תקציב מעוגל. חלוקת עמלה: ${describeCommissionSplit(shareSplit)}`,
      );
    } catch (err: unknown) {
      setShareStatus(err instanceof ApiError ? err.message : "השיתוף נכשל");
    }
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
          apiGet<Record<string, OfferInfo>>(`/offers/for-matches?matchIds=${ids}`)
            .then(setOffers)
            .catch(() => undefined);
        }
      })
      .catch(() => setMatches([]));
  }, [authLoading, id]);

  if (error) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/buyers" className="underline">חזרה לרשימה</Link>
      </p>
    );
  }
  if (!buyer) return <p aria-live="polite">טוען…</p>;

  const musts = Object.entries(buyer.requirements.features).filter(([, l]) => l === "must");
  const nices = Object.entries(buyer.requirements.features).filter(([, l]) => l === "nice");
  const pill = MATURITY_PILL[buyer.maturity] ?? MATURITY_PILL["not_ripe"]!;
  const sentOffers = Object.entries(offers);
  const isHotNoOffers =
    (buyer.maturity === "very_hot" || buyer.maturity === "hot") && sentOffers.length === 0;

  return (
    <>
      <Link
        href="/buyers"
        className="mb-3.5 inline-block text-[13.5px] font-bold no-underline hover:underline"
        style={{ color: "var(--color-primary)" }}
      >
        → חזרה לרשימת הקונים
      </Link>

      {/* ---- כרטיס הכותרת ---- */}
      <div className="mv-list-card mb-[18px] flex flex-wrap items-center gap-4 p-6" style={{ overflow: "visible" }}>
        <span
          aria-hidden="true"
          className="grid flex-none place-items-center rounded-full"
          style={{ width: 52, height: 52, background: "var(--color-primary-soft)", color: "var(--color-primary)", fontWeight: 800, fontSize: 19 }}
        >
          {initials(buyer.contact.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0" style={{ fontSize: 22, fontWeight: 800 }}>{buyer.contact.name}</h1>
            <label>
              <span className="mv-visually-hidden">עדכון בשלות</span>
              <select
                value={buyer.maturity}
                onChange={(e) => void changeMaturity(e.target.value)}
                className="mv-pill border-0"
                style={{ color: pill.fg, background: pill.bg, cursor: "pointer", fontSize: 12.5 }}
              >
                {Object.entries(MATURITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="m-0 mt-1 text-[13.5px]" style={{ color: "var(--color-text-muted)" }}>
            <span dir="ltr">{buyer.contact.phone}</span> · מקור: {formatBuyerSource(buyer.source)} ·
            מימון: {FINANCING_LABELS[buyer.financing] ?? buyer.financing}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <a
            href={waMeUrl(buyer.contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="mv-btn-plain"
            style={{ padding: "7px 14px", fontSize: 13 }}
          >
            וואטסאפ
          </a>
          {/* מהמכשיר — תמיד זמין, ולא נרשם במערכת */}
          <a href={`tel:${buyer.contact.phone}`} className="mv-btn-plain" style={{ padding: "7px 14px", fontSize: 13 }}>
            חייג מהנייד
          </a>
          {/* דרך המרכזייה — נרשם בכרטיס מעצמו, עם משך והקלטה */}
          <ClickToDial contactId={buyer.contact.id} phone={buyer.contact.phone} label="חייג מהמרכזייה" />
          <Link href={`/buyers/${id}/edit`} className="mv-btn-plain" style={{ padding: "7px 14px", fontSize: 13 }}>
            ערוך דרישות
          </Link>
          <label className="flex items-center gap-1.5 text-sm">
            <span>חלוקת עמלה</span>
            <select
              value={shareSplit}
              onChange={(e) => setShareSplit(Number(e.target.value))}
              className="rounded-lg border px-2 py-1.5"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              aria-label="חלוקת העמלה בשיתוף"
            >
              {COMMISSION_SPLIT_OPTIONS.map((share) => (
                <option key={share} value={share}>
                  {describeCommissionSplit(share)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="mv-btn-soft" style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => void shareToNetwork()}>
            שתף ברשת (אנונימי)
          </button>
        </div>
        {shareStatus ? (
          <p role="status" className="m-0 w-full text-sm" style={{ color: "var(--color-primary)" }}>
            {shareStatus}
          </p>
        ) : null}
      </div>

      <AgreementsPanel
        contactId={buyer.contact.id}
        kind="brokerage"
        title="הזמנה בכתב (הסכם תיווך)"
      />

      <RelatedEntities contactId={buyer.contact.id} exclude={{ kind: "buyer", id: buyer.id }} />

      <EntityTasks entityType="buyer" entityId={id} />

      <ContactPeople contactId={buyer.contact.id} canEdit={canEditPeople} />

      <div className="grid items-start gap-[18px] lg:[grid-template-columns:340px_1fr]">
        {/* ---- מה הוא מחפש ---- */}
        <section className="mv-list-card px-5 py-[18px]" aria-labelledby="req-heading">
          <h2 id="req-heading" className="m-0 mb-3" style={{ fontSize: 15.5, fontWeight: 800 }}>
            מה הוא מחפש
          </h2>

          <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>תקציב</div>
          <div className="mb-[13px]" style={{ fontSize: 19, fontWeight: 800 }}>
            {buyer.requirements.budgetMinAgorot !== undefined
              ? `${formatPrice(buyer.requirements.budgetMinAgorot)}–${formatPrice(buyer.requirements.budgetMaxAgorot)}`
              : `עד ${formatPrice(buyer.requirements.budgetMaxAgorot)}`}
          </div>

          <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>אזורים</div>
          <div className="mb-3.5 text-[14.5px] font-bold">{buyer.requirements.cities.join(", ") || "—"}</div>

          {buyer.requirements.roomsMin !== undefined || buyer.requirements.roomsMax !== undefined ? (
            <>
              <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>חדרים</div>
              <div className="mb-3.5 text-[14.5px] font-bold">
                {buyer.requirements.roomsMin ?? "—"}–{buyer.requirements.roomsMax ?? "—"}
              </div>
            </>
          ) : null}
          {buyer.requirements.areaSqmMin !== undefined ? (
            <>
              <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>שטח מינימלי</div>
              <div className="mb-3.5 text-[14.5px] font-bold">{buyer.requirements.areaSqmMin} מ&quot;ר</div>
            </>
          ) : null}
          {buyer.requirements.entryBy ? (
            <>
              <div className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>כניסה עד</div>
              <div className="mb-3.5 text-[14.5px] font-bold">{formatDate(buyer.requirements.entryBy)}</div>
            </>
          ) : null}

          <div className="mb-[7px] text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
            דרישות חובה — שוברות התאמה
          </div>
          <div className="mb-3.5 flex flex-wrap gap-[7px]">
            {musts.length === 0 ? (
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>אין</span>
            ) : (
              musts.map(([k]) => (
                <span key={k} className="mv-pill" style={{ background: "#111513", color: "#fff", fontSize: 12.5, padding: "4px 12px" }}>
                  {FEATURE_LABELS[k] ?? k}
                </span>
              ))
            )}
          </div>

          <div className="mb-[7px] text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
            עדיפויות — משפיעות על הניקוד בלבד
          </div>
          <div className="flex flex-wrap gap-[7px]">
            {nices.length === 0 ? (
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>אין</span>
            ) : (
              nices.map(([k]) => (
                <span key={k} className="mv-pill" style={{ background: "#eef1ec", color: "#4a534c", fontSize: 12.5, padding: "4px 12px" }}>
                  {FEATURE_LABELS[k] ?? k}
                </span>
              ))
            )}
          </div>

          {buyer.requirements.flexibilityNotes ? (
            <>
              <div className="mb-1.5 mt-3.5 text-[13px] font-semibold" style={{ color: "var(--color-text-muted)" }}>גמישות</div>
              <div className="text-sm">{buyer.requirements.flexibilityNotes}</div>
            </>
          ) : null}
        </section>

        {/* ---- נכסים מתאימים + היסטוריית הצעות ---- */}
        <section className="mv-list-card px-[22px] py-[18px]" aria-labelledby="matches-heading">
          <h2 id="matches-heading" className="m-0 mb-1" style={{ fontSize: 15.5, fontWeight: 800 }}>
            נכסים מתאימים
          </h2>
          <p className="m-0 mb-2.5 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            נכסים ששוברים דרישת חובה אינם מופיעים
          </p>

          {matches === null ? (
            <p aria-live="polite">מחשב התאמות…</p>
          ) : matches.length === 0 ? (
            <p className="m-0 py-2" style={{ color: "var(--color-text-muted)" }}>
              אין עדיין נכסים מתאימים במאגר.
            </p>
          ) : (
            matches.map((m) => {
              const offer = offers[m.id];
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
                      <Link href={`/properties/${m.propertyId}`} className="no-underline hover:underline" style={{ color: "inherit" }}>
                        {m.property.title ?? m.property.address}
                      </Link>
                      {m.property.priceAgorot !== undefined ? (
                        <span className="ms-1.5 text-[12.5px] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                          · {formatPrice(m.property.priceAgorot)}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>{m.explanation}</div>
                  </div>
                  <div className="ms-auto flex-none">
                    {offer ? (
                      <a href={offer.url} target="_blank" rel="noreferrer" className="mv-pill no-underline" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                        הצעה נשלחה ✓
                      </a>
                    ) : (
                      <button
                        type="button"
                        className="mv-btn-action"
                        style={{ padding: "7px 15px", fontSize: 13 }}
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

          <h2 className="mb-2 mt-[18px]" style={{ fontSize: 15.5, fontWeight: 800 }}>
            היסטוריית הצעות
          </h2>
          {sentOffers.length === 0 ? (
            isHotNoOffers ? (
              <p className="m-0 rounded-[9px] px-[13px] py-2.5 text-[13.5px] font-bold" style={{ color: "#b0512c", background: "#faf1ec" }}>
                קונה חם שעדיין לא קיבל אף הצעה — שווה לטפל היום.
              </p>
            ) : (
              <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                עוד לא נשלחו הצעות לקונה הזה.
              </p>
            )
          ) : (
            sentOffers.map(([matchId, offer]) => {
              const match = (matches ?? []).find((m) => m.id === matchId);
              const chip = offerChip(offer);
              return (
                <div key={offer.id} className="flex flex-wrap items-center gap-2.5 py-[9px] text-[13.5px]" style={{ borderBottom: "1px solid var(--color-row-border)" }}>
                  <span className="font-bold">{match?.property.title ?? match?.property.address ?? "נכס"}</span>
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {offer.openCount === 0 ? "טרם נפתחה" : `נפתחה ${offer.openCount} פעמים`}
                  </span>
                  <span className="mv-pill ms-auto" style={{ color: chip.fg, background: chip.bg, fontSize: 12.5 }}>
                    {chip.label}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>

      {/* ---- הערות הסוכן + ציר הזמן ---- */}
      <section
        aria-labelledby="notes-heading"
        className="mv-list-card mb-[18px] mt-[18px] px-[22px] py-[18px]"
      >
        <h2 id="notes-heading" className="m-0 mb-3" style={{ fontSize: 15.5, fontWeight: 800 }}>הערות הסוכן</h2>
        {notesDraft === null ? (
          <>
            <p className="mb-3 mt-0 whitespace-pre-wrap">
              {buyer.agentNotes?.trim() ? buyer.agentNotes : <span style={{ color: "var(--color-text-muted)" }}>אין הערות עדיין.</span>}
            </p>
            <div className="flex items-center gap-3">
              <button type="button" className="mv-btn-plain" onClick={() => { setNotesSaved(false); setNotesDraft(buyer.agentNotes ?? ""); }}>
                {buyer.agentNotes?.trim() ? "ערוך הערות" : "הוסף הערות"}
              </button>
              {notesSaved ? <span role="status" style={{ color: "var(--color-primary)" }}>✓ נשמר</span> : null}
            </div>
          </>
        ) : (
          <>
            <label htmlFor="agentNotes" className="mv-visually-hidden">הערות הסוכן</label>
            <WithDictation value={notesDraft} onChange={setNotesDraft}>
              <textarea
                id="agentNotes"
                rows={4}
                maxLength={4000}
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                className="mb-2 w-full rounded-lg border px-3 py-2.5"
                style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)", color: "var(--color-text)" }}
              />
            </WithDictation>
            <div className="mt-3 flex gap-3">
              <Button onClick={() => void saveNotes()}>שמור הערות</Button>
              <Button variant="ghost" onClick={() => setNotesDraft(null)}>ביטול</Button>
            </div>
          </>
        )}
      </section>

      <TimelineSection buyerId={id} />
    </>
  );
}
