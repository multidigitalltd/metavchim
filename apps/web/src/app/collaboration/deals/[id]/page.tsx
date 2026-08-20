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
import { apiGet, ApiError, apiPatch, apiPost } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import {
  IconChat,
  IconCheck,
  IconHandshake,
  IconHome,
  IconMail,
  IconPhone,
  IconTarget,
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
    } catch (err: unknown) {
      /*
       * הודעת השרת ולא נוסח כללי. שני משרדים עובדים כאן במקביל,
       * והשגיאה השכיחה היא „הצד השני עדכן באותו רגע” — הודעה
       * שאומרת מה קרה ומה לעשות, בעוד „לא הצלחנו לעדכן” משאירה
       * את הסוכן בלי מושג אם ללחוץ שוב.
       */
      setError(
        err instanceof ApiError ? err.message : "לא הצלחנו לעדכן את שלב העסקה",
      );
      // רענון גם בכישלון: הסיבה השכיחה היא שהמצב במסך כבר אינו עדכני
      load();
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

      {/*
        כותרת חיה ולא שורה אפורה: החדר הוא רגע ההצלחה של הרשת —
        שני משרדים שהתחברו — והעמוד צריך להיראות כמו הרגע הזה
        (בקשת המשתמש: "מעוצב חי ומושך בסגנון של כל המערכת").
      */}
      <header className="mv-deal-hero">
        <div className="mv-deal-hero-head">
          <span className="mv-deal-badge">
            <IconHandshake s={24} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-xl font-extrabold">
              {deal.property.address}
            </h1>
            <p
              className="m-0 mt-0.5 text-[15px]"
              style={{ color: "var(--color-text-soft)" }}
            >
              עסקה משותפת מול {deal.counterpartOffice} · נפתחה{" "}
              {formatDateTime(deal.createdAt)}
            </p>
          </div>
        </div>
        <div className="mv-deal-hero-meta">
          <span className="mv-net-chip mv-net-chip--money">
            {coopDealSplitLabel(deal.commissionSplit, deal.mySide)}
          </span>
          <span className="mv-net-chip">
            <IconUsers s={14} /> {deal.counterpartOffice}
          </span>
          {closed ? (
            <span className="mv-net-chip">
              העסקה נסגרה — {COOP_DEAL_STAGE_LABELS[deal.stage]}
            </span>
          ) : null}
        </div>
        {deal.closedNote === undefined ? null : (
          <p className="mt-3 mb-0 text-[15.5px]">
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
              className="mv-deal-card m-0 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              העסקה נסגרה. השרשור נשמר לשני המשרדים כפי שהוא.
            </p>
          ) : (
            <form
              className="mv-deal-card"
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

          <section className="mv-deal-card">
            <h2 className="mv-deal-card-title">
              <span className="mv-deal-card-icon">
                <IconHome s={16} />
              </span>
              הנכס
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

          <section className="mv-deal-card">
            <h2 className="mv-deal-card-title">
              <span className="mv-deal-card-icon">
                <IconUser s={16} />
              </span>
              הקונה
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

  const currentIdx = COOP_DEAL_STAGES.indexOf(stage);
  return (
    <section className="mv-deal-card mb-4">
      <h2 className="mv-deal-card-title">
        <span className="mv-deal-card-icon">
          <IconTarget s={16} />
        </span>
        שלב העסקה
      </h2>
      {/*
        גלולות שמתמלאות עם ההתקדמות: מה שכבר נעשה בצבע רך, השלב
        הנוכחי מלא, ומה שעוד לא — ריק. הציר נקרא כמסלול, לא כרשימת
        כפתורים אפורים.
      */}
      <div className="mv-deal-steps">
        {COOP_DEAL_STAGES.map((option, idx) => {
          const current = option === stage;
          const allowed = canMoveCoopDeal(stage, option);
          const done = idx < currentIdx && !isFinalCoopDealStage(option);
          return (
            <span key={option} className="inline-flex items-center gap-1">
              {idx > 0 ? <span className="mv-deal-step-connector" /> : null}
              <button
                type="button"
                className={`mv-deal-step${current ? " mv-deal-step--current" : done ? " mv-deal-step--done" : ""}`}
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
                {done ? <IconCheck s={14} /> : null}
                {COOP_DEAL_STAGE_LABELS[option]}
              </button>
            </span>
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
    <section className="mv-deal-thread mb-4" aria-label="שרשור העסקה">
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
            <li key={entry.id} className="my-2 text-center">
              <span className="mv-deal-event">
                {entry.body} · {formatDateTime(entry.createdAt)}
              </span>
            </li>
          ) : (
            /*
             * בועות צ'אט: שלנו בצבע המערכת ומיושרות לצד אחד, של
             * המשרד השותף על משטח ומהצד השני — שיחה, לא טבלה.
             */
            <li
              key={entry.id}
              className="mb-3 flex"
              style={{ justifyContent: entry.mine ? "flex-start" : "flex-end" }}
            >
              <div
                className={`mv-deal-bubble ${entry.mine ? "mv-deal-bubble--mine" : "mv-deal-bubble--theirs"}`}
              >
                <p className="mv-deal-bubble-meta">
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
      className={`mv-deal-card${highlight ? " mv-deal-card--accent" : ""}`}
    >
      <h2 className="mv-deal-card-title">
        <span className="mv-deal-card-icon">
          <IconUsers s={16} />
        </span>
        {title}
      </h2>
      <p className="m-0 mb-1 flex items-center gap-1.5 font-bold">
        {side.officeLogoUrl === undefined ? null : (
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
