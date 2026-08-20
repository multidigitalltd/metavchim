"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  canMoveCoopDeal,
  COOP_DEAL_STAGE_HINTS,
  COOP_DEAL_STAGE_LABELS,
  COOP_DEAL_STAGES,
  coopDealSplitLabel,
  isFinalCoopDealStage,
  MAX_COOP_DEAL_MESSAGE,
  type CoopDealStage,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import {
  IconChat,
  IconHandshake,
  IconHome,
  IconMail,
  IconPhone,
  IconUser,
  IconUsers,
} from "../../../icons";
import { LoadError } from "../../../load-error";

/**
 * חדר העסקה — סביבת העבודה המשותפת של שני המשרדים.
 *
 * ## מה יש כאן
 *
 * ארבעה דברים, וכולם דברים שקודם לא היו בשום מקום: **מי מולי**
 * (שם הסוכן, טלפון ואימייל), **מה הנכס** (כולל הכתובת המדויקת —
 * בלעדיה אי אפשר להגיע לסיור), **איפה זה עומד** (ציר שלבים ששני
 * הצדדים מזיזים), ו**מה נאמר** (שרשור אחד, כרונולוגי).
 *
 * ## מה אין כאן, ולמה
 *
 * פרטי הלקוחות. הקונה נשאר של המשרד שהביא אותו והמוכר של המשרד
 * שגייס אותו — זה בדיוק מה ששיתוף פעולה בין מתווכים הוא. מי שרוצה
 * לדבר עם הקונה מדבר עם הסוכן שלו, ופרטיו של הסוכן דווקא כן כאן.
 * השרת אינו מחזיר את הפרטים האלה כלל, ולא מסתיר אותם במסך.
 */

interface DealSide {
  officeName: string;
  officeLogoUrl?: string;
  agentName?: string;
  agentPhone?: string;
  agentEmail?: string;
}

interface DealEntry {
  id: string;
  kind: string;
  body: string;
  mine: boolean;
  authorName?: string;
  createdAt: string;
}

interface Deal {
  id: string;
  stage: CoopDealStage;
  mySide: "listing" | "buyer";
  commissionSplit: number;
  title: string;
  counterpartOffice: string;
  counterpartLogoUrl?: string;
  lastActivityAt: string;
  createdAt: string;
  me: DealSide;
  counterpart: DealSide;
  property: {
    id: string;
    linkable: boolean;
    address: string;
    city?: string;
    rooms?: number;
    areaSqm?: number;
    priceAgorot?: string;
  };
  buyer: {
    id: string;
    linkable: boolean;
    budgetMaxAgorot?: string;
    rooms?: number;
    cities: string[];
  };
  closedNote?: string;
  entries: DealEntry[];
}

/** אגורות מגיעות כמחרוזת (BigInt) — המרה אחת, במקום אחד. */
function agorot(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

export default function DealRoomPage() {
  const { loading: authLoading } = useRequireAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [deal, setDeal] = useState<Deal | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadEnd = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<Deal>(`/collaboration/deals/${id}`)
      .then(setDeal)
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(load, [load]);

  /*
   * גלילה לסוף השרשור אחרי כל טעינה. בלעדיה חדר עם עשרים הודעות
   * נפתח על ההודעה הראשונה — כלומר על מה שכבר נקרא.
   */
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "nearest" });
  }, [deal?.entries.length]);

  if (authLoading) return null;

  async function send(): Promise<void> {
    if (draft.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/collaboration/deals/${id}/messages`, { body: draft });
      setDraft("");
      load();
    } catch {
      setError("ההודעה לא נשלחה — נסו שוב");
    } finally {
      setBusy(false);
    }
  }

  async function move(stage: CoopDealStage, note?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/collaboration/deals/${id}/stage`, {
        stage,
        ...(note === undefined ? {} : { note }),
      });
      load();
    } catch {
      setError("לא הצלחנו לעדכן את שלב העסקה");
    } finally {
      setBusy(false);
    }
  }

  if (failed)
    return (
      <main className="mv-page">
        <LoadError message="לא הצלחנו לטעון את חדר העסקה" onRetry={load} />
      </main>
    );
  if (deal === null) return null;

  const closed = isFinalCoopDealStage(deal.stage);

  return (
    <main className="mv-page">
      <Link href="/collaboration?tab=deals" className="mb-3 inline-block">
        ← לכל העסקאות המשותפות
      </Link>

      <header className="mv-list-card mb-4 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="m-0 text-xl font-bold">
            <IconHandshake s={19} /> {deal.property.address}
          </h1>
          <span className="mv-chip">
            {coopDealSplitLabel(deal.commissionSplit, deal.mySide)}
          </span>
        </div>
        <p
          className="m-0 text-[15.5px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          שיתוף פעולה מול {deal.counterpartOffice} · נפתח{" "}
          {formatDateTime(deal.createdAt)}
        </p>
        {deal.closedNote === undefined ? null : (
          <p className="mt-2 mb-0 text-[15.5px]">
            <strong>סיבת הסגירה:</strong> {deal.closedNote}
          </p>
        )}
      </header>

      {error === null ? null : (
        <p role="alert" className="mb-3" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <StageRail stage={deal.stage} busy={busy} onMove={move} />
          <Thread entries={deal.entries} endRef={threadEnd} />
          {closed ? (
            <p
              className="mv-list-card p-4 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              העסקה נסגרה. השרשור נשמר לשני המשרדים כפי שהוא.
            </p>
          ) : (
            <form
              className="mv-list-card p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label htmlFor="deal-message" className="mb-1 block font-semibold">
                הודעה למשרד השותף
              </label>
              <textarea
                id="deal-message"
                className="mv-input mb-2 w-full"
                rows={3}
                maxLength={MAX_COOP_DEAL_MESSAGE}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="למשל: אפשר לתאם סיור מחר ב-17:00?"
              />
              <Button type="submit" disabled={busy || draft.trim() === ""}>
                <IconChat s={15} /> שליחה
              </Button>
            </form>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <SideCard
            title="הסוכן שמולכם"
            side={deal.counterpart}
            highlight
          />
          <SideCard title="הצד שלכם" side={deal.me} />

          <section className="mv-list-card p-4">
            <h2 className="mt-0 mb-2 text-base font-semibold">
              <IconHome s={16} /> הנכס
            </h2>
            <p className="m-0 mb-1">{deal.property.address}</p>
            <p
              className="m-0 text-[15px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {[
                deal.property.rooms === undefined
                  ? null
                  : `${deal.property.rooms} חד׳`,
                deal.property.areaSqm === undefined
                  ? null
                  : `${deal.property.areaSqm} מ״ר`,
                deal.property.priceAgorot === undefined
                  ? null
                  : formatPrice(agorot(deal.property.priceAgorot)),
              ]
                .filter((part) => part !== null)
                .join(" · ") || "אין פרטים נוספים"}
            </p>
            {deal.property.linkable ? (
              <Link
                href={`/properties/${deal.property.id}`}
                className="mt-2 inline-block"
              >
                לכרטיס הנכס
              </Link>
            ) : null}
          </section>

          <section className="mv-list-card p-4">
            <h2 className="mt-0 mb-2 text-base font-semibold">
              <IconUser s={16} /> הקונה
            </h2>
            <p
              className="m-0 text-[15px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {[
                deal.buyer.budgetMaxAgorot === undefined
                  ? null
                  : `עד ${formatPrice(agorot(deal.buyer.budgetMaxAgorot))}`,
                deal.buyer.rooms === undefined
                  ? null
                  : `מ-${deal.buyer.rooms} חד׳`,
                deal.buyer.cities.length === 0
                  ? null
                  : deal.buyer.cities.join(", "),
              ]
                .filter((part) => part !== null)
                .join(" · ") || "אין פרטים נוספים"}
            </p>
            {deal.buyer.linkable ? (
              <Link
                href={`/buyers/${deal.buyer.id}`}
                className="mt-2 inline-block"
              >
                לכרטיס הקונה
              </Link>
            ) : (
              /*
               * לא "מוסתר" — פשוט אינו שלכם. השורה הזו היא מה שמונע
               * את השאלה "למה אני לא רואה את הפרטים": התשובה היא
               * הכלל, לא תקלה.
               */
              <p
                className="mt-2 mb-0 text-[14.5px]"
                style={{ color: "var(--color-text-muted)" }}
              >
                הקונה שייך למשרד השותף. לתיאום מולו — דרך הסוכן שמולכם.
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

/**
 * ציר השלבים.
 *
 * כפתור לכל שלב, ומה שאסור פשוט מושבת ולא נעלם: ציר שמסתיר את
 * „נחתם” עד שמגיעים אליו אינו מספר לסוכן לאן הוא הולך.
 */
function StageRail({
  stage,
  busy,
  onMove,
}: {
  stage: CoopDealStage;
  busy: boolean;
  onMove: (stage: CoopDealStage, note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState<CoopDealStage | null>(null);

  return (
    <section className="mv-list-card mb-4 p-4">
      <h2 className="mt-0 mb-3 text-base font-semibold">שלב העסקה</h2>
      <div className="flex flex-wrap gap-2">
        {COOP_DEAL_STAGES.map((option) => {
          const current = option === stage;
          const allowed = canMoveCoopDeal(stage, option);
          return (
            <button
              key={option}
              type="button"
              className={current ? "mv-seg-on" : "mv-btn-plain"}
              aria-current={current ? "step" : undefined}
              disabled={busy || (!current && !allowed)}
              title={COOP_DEAL_STAGE_HINTS[option]}
              onClick={() => {
                if (!allowed) return;
                // סגירה מבקשת סיבה; התקדמות רגילה לא צריכה טופס
                if (isFinalCoopDealStage(option)) setClosing(option);
                else void onMove(option);
              }}
            >
              {COOP_DEAL_STAGE_LABELS[option]}
            </button>
          );
        })}
      </div>
      <p
        className="mt-2 mb-0 text-[15px]"
        style={{ color: "var(--color-text-muted)" }}
      >
        {COOP_DEAL_STAGE_HINTS[stage]}
      </p>

      {closing === null ? null : (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onMove(closing, note.trim() === "" ? undefined : note);
            setClosing(null);
            setNote("");
          }}
        >
          <label htmlFor="close-note" className="mb-1 block font-semibold">
            {`סגירת העסקה כ״${COOP_DEAL_STAGE_LABELS[closing]}״ — מה קרה?`}
          </label>
          <textarea
            id="close-note"
            className="mv-input mb-2 w-full"
            rows={2}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="הקונה בחר נכס אחר"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              אישור סגירה
            </Button>
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => setClosing(null)}
            >
              ביטול
            </button>
          </div>
          <p
            className="mt-2 mb-0 text-[14.5px]"
            style={{ color: "var(--color-text-muted)" }}
          >
            עסקה סגורה אינה נפתחת מחדש — שני המשרדים נשענים על הרישום
            הזה בחלוקת העמלה.
          </p>
        </form>
      )}
    </section>
  );
}

/** השרשור — מה שנכתב ומה שקרה, ברצף אחד. */
function Thread({
  entries,
  endRef,
}: {
  entries: DealEntry[];
  endRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section
      className="mv-list-card mb-4 p-4"
      style={{ maxHeight: 460, overflowY: "auto" }}
      aria-label="שרשור העסקה"
    >
      {entries.length === 0 ? (
        <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
          עוד לא נכתב כאן דבר.
        </p>
      ) : null}
      <ol className="m-0 list-none p-0">
        {entries.map((entry) =>
          entry.kind === "event" ? (
            /*
             * אירוע נראה אחרת מהודעה בכוונה: הוא לא נאמר בידי אף
             * אחד אל אף אחד, והוא הדבר שמאפשר לקרוא את החדר כסיפור.
             */
            <li
              key={entry.id}
              className="my-2 text-center text-[14.5px]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {entry.body} · {formatDateTime(entry.createdAt)}
            </li>
          ) : (
            <li
              key={entry.id}
              className="mb-3 flex"
              style={{ justifyContent: entry.mine ? "flex-start" : "flex-end" }}
            >
              <div
                className="rounded-xl px-3 py-2"
                style={{
                  maxWidth: "80%",
                  background: entry.mine
                    ? "var(--color-surface-alt)"
                    : "var(--color-primary-soft, var(--color-surface-alt))",
                  border: "1px solid var(--color-border)",
                }}
              >
                <p
                  className="m-0 mb-1 text-[14.5px] font-semibold"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {entry.authorName ?? (entry.mine ? "המשרד שלנו" : "המשרד השותף")}
                  {" · "}
                  {formatDateTime(entry.createdAt)}
                </p>
                <p className="m-0 whitespace-pre-wrap">{entry.body}</p>
              </div>
            </li>
          ),
        )}
      </ol>
      <div ref={endRef} />
    </section>
  );
}

/**
 * כרטיס צד — משרד, סוכן ודרכי הקשר אליו.
 *
 * הטלפון והאימייל הם קישורים פעילים ולא טקסט: כל התכלית של החדר
 * היא שהשיחה הבאה תקרה, ומספר שצריך להעתיק ביד הוא חיכוך מיותר
 * בדיוק במקום שבו אסור שיהיה.
 */
function SideCard({
  title,
  side,
  highlight = false,
}: {
  title: string;
  side: DealSide;
  highlight?: boolean;
}) {
  return (
    <section
      className="mv-list-card p-4"
      style={
        highlight ? { borderColor: "var(--color-primary)" } : undefined
      }
    >
      <h2 className="mt-0 mb-2 text-base font-semibold">{title}</h2>
      <p className="m-0 mb-1 flex items-center gap-1.5 font-bold">
        {side.officeLogoUrl === undefined ? (
          <IconUsers s={16} />
        ) : (
          <img
            src={side.officeLogoUrl}
            alt=""
            loading="lazy"
            style={{ height: 22, width: "auto", borderRadius: 4 }}
          />
        )}
        {side.officeName}
      </p>
      {side.agentName === undefined ? (
        <p className="m-0 text-[15px]" style={{ color: "var(--color-text-muted)" }}>
          אין סוכן משויך
        </p>
      ) : (
        <>
          <p className="m-0 mb-1">{side.agentName}</p>
          {side.agentPhone === undefined ? null : (
            <p className="m-0 mb-1">
              <a href={`tel:${side.agentPhone}`}>
                <IconPhone s={15} /> {side.agentPhone}
              </a>
            </p>
          )}
          {side.agentEmail === undefined ? null : (
            <p className="m-0">
              <a href={`mailto:${side.agentEmail}`}>
                <IconMail s={15} /> {side.agentEmail}
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
