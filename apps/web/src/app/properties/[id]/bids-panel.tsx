"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BID_NOTE_MAX,
  BID_SIDE_LABELS,
  BID_STATUS_LABELS,
  type BidDecision,
  type BidEvent,
  type BidSide,
  type BidsSummary,
} from "@metavchim/shared";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { IconBanknote } from "../../icons";
import { Notice } from "../../notice";

/**
 * ‏לשונית „הצעות מחיר” בכרטיס הנכס (docs/03 — property_bids).
 *
 * ‏למעלה — מה שהמוכר שואל: כמה הצעות, הגבוהה, הצעת הנגד האחרונה.
 * ‏מתחת — שרשור לכל קונה, מהחדש לישן, עם ההצעה הפתוחה מודגשת
 * ‏ופעולות עליה: הצעת נגד, קבל, דחה, הקונה משך. הטופס למעלה רושם
 * ‏צעד חדש; הקונים בבורר הם מי שכבר נגע בנכס.
 */

interface ThreadDto {
  buyer: { id: string; name: string; visible: boolean };
  events: BidEvent[];
  open: BidEvent | null;
  outcome: BidDecision | null;
  lastAt: string;
}

export interface PropertyBidsResponse {
  threads: ThreadDto[];
  summary: BidsSummary;
  sentences: string[];
  buyerOptions: { id: string; name: string }[];
}

function shekelsToAgorot(input: string): number | null {
  const digits = Number(input.replace(/[^\d.]/gu, ""));
  if (!Number.isFinite(digits) || digits <= 0) return null;
  return Math.round(digits * 100);
}

export function BidsPanel({
  propertyId,
  canEdit,
  onSummary,
}: {
  propertyId: string;
  canEdit: boolean;
  /** ‏המונה על הלשונית — שרשורים עם הצעה פתוחה */
  onSummary?: (summary: BidsSummary) => void;
}) {
  const [data, setData] = useState<PropertyBidsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* ‏טופס הצעד החדש — קונה מהבורר, צד, סכום בשקלים, הערה */
  const [buyerId, setBuyerId] = useState("");
  const [side, setSide] = useState<BidSide>("buyer");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [counterFor, setCounterFor] = useState<string | null>(null);
  /* ‏„הצעת נגד” נלחץ בשרשור למטה — הטופס למעלה, ומביאים אותו לעין */
  const formRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (counterFor !== null) formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [counterFor]);

  const apply = useCallback(
    (next: PropertyBidsResponse) => {
      setData(next);
      onSummary?.(next.summary);
    },
    [onSummary],
  );

  useEffect(() => {
    let cancelled = false;
    apiGet<PropertyBidsResponse>(`/properties/${propertyId}/bids`)
      .then((res) => {
        if (!cancelled) apply(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "הצעות המחיר לא נטענו");
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, apply]);

  async function submit(target: { buyerId: string; side: BidSide }): Promise<void> {
    const amountAgorot = shekelsToAgorot(amount);
    if (amountAgorot === null) {
      setError("צריך סכום בשקלים");
      return;
    }
    if (target.buyerId === "") {
      setError("בחרו קונה");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      apply(
        await apiPost<PropertyBidsResponse>(`/properties/${propertyId}/bids`, {
          buyerId: target.buyerId,
          side: target.side,
          amountAgorot,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        }),
      );
      setAmount("");
      setNote("");
      setCounterFor(null);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הרישום נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function decide(bidId: string, status: BidDecision): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      apply(await apiPatch<PropertyBidsResponse>(`/properties/${propertyId}/bids/${bidId}`, { status }));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return error ? <Notice tone="danger">{error}</Notice> : <p aria-live="polite">טוען הצעות מחיר…</p>;
  }
  const { threads, summary, sentences, buyerOptions } = data;

  return (
    <div className="flex flex-col gap-4">
      <section className="mv-card mv-card--pad" aria-labelledby="bids-summary">
        <div className="mv-card-head mv-domain-green">
          <span className="mv-tile" aria-hidden="true"><IconBanknote s={19} /></span>
          <h2 id="bids-summary" className="mv-card-head__title m-0">מו״מ על הנכס</h2>
        </div>
        {sentences.length === 0 ? (
          <p className="m-0" style={{ color: "var(--color-text-soft)" }}>עדיין אין הצעות מחיר. רשמו את הראשונה כשהיא מגיעה — גם בטלפון.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="סיכום למוכר">
            {sentences.map((sentence) => (
              <li key={sentence} className="font-semibold">{sentence}</li>
            ))}
          </ul>
        )}
        {summary.bidders > 0 ? (
          <p className="mv-form-hint mt-2">הסיכום הזה נכנס גם לדוח הפעילות למוכר — בלי שמות.</p>
        ) : null}
      </section>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {canEdit ? (
        <section ref={formRef} className="mv-card mv-card--pad" aria-labelledby="bid-form-heading">
          <h3 id="bid-form-heading" className="m-0 mb-3 text-[length:var(--type-body)] font-extrabold">
            {counterFor === null ? "צעד חדש במו״מ" : "הצעת נגד של המוכר"}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {counterFor === null ? (
              <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
                קונה
                <select className="mv-control" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">בחרו קונה…</option>
                  {buyerOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {counterFor === null ? (
              <div className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
                מי מציע
                <div className="mv-seg" role="group" aria-label="צד ההצעה">
                  <button type="button" aria-pressed={side === "buyer"} onClick={() => setSide("buyer")}>הקונה</button>
                  <button type="button" aria-pressed={side === "seller"} onClick={() => setSide("seller")}>המוכר (נגד)</button>
                </div>
              </div>
            ) : null}
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              סכום
              <span className="flex items-center gap-2">
                <input className="mv-control mv-ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2,350,000" />
                <span style={{ color: "var(--color-text-muted)" }}>₪</span>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-[length:var(--type-caption)] font-semibold">
              הערה (לא חובה)
              <input className="mv-control" value={note} maxLength={BID_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="תנאים, מועד כניסה, מימון" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="mv-btn-action"
              disabled={busy}
              onClick={() => void submit(counterFor === null ? { buyerId, side } : { buyerId: counterFor, side: "seller" })}
            >
              {busy ? "רושם…" : counterFor === null ? "לרשום" : "לרשום הצעת נגד"}
            </button>
            {counterFor !== null ? (
              <button type="button" className="mv-btn-plain" onClick={() => setCounterFor(null)}>ביטול</button>
            ) : null}
            {counterFor === null && buyerOptions.length === 0 ? (
              <span className="text-[length:var(--type-caption)]" style={{ color: "var(--color-text-muted)" }}>
                הבורר מציג קונים שביקרו בנכס או הותאמו לו. קבעו סיור לקונה כדי שיופיע כאן.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <ol className="m-0 flex list-none flex-col gap-3 p-0" aria-label="שרשורי המו״מ">
        {threads.map((thread) => (
          <li key={thread.buyer.id} className="mv-card mv-card--pad">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-[length:var(--type-body)] font-extrabold">{thread.buyer.name}</h3>
              {thread.open !== null ? (
                <span className="mv-pill mv-domain-green">
                  {BID_SIDE_LABELS[thread.open.side]}: {formatPrice(thread.open.amountAgorot)} — על השולחן
                </span>
              ) : thread.outcome !== null ? (
                <span className={`mv-pill ${thread.outcome === "accepted" ? "mv-domain-green" : "mv-domain-neutral"}`}>
                  {BID_STATUS_LABELS[thread.outcome]}
                </span>
              ) : null}
            </div>
            <ol className="m-0 mt-2 flex list-none flex-col gap-1 p-0" aria-label={`הצעדים במו״מ עם ${thread.buyer.name}`}>
              {thread.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 text-[length:var(--type-caption-lg)]">
                  <span style={{ color: "var(--color-text-muted)" }}>{formatDateTime(event.createdAt)}</span>
                  <span className="font-semibold">{BID_SIDE_LABELS[event.side]}</span>
                  <span className="mv-ltr font-bold">{formatPrice(event.amountAgorot)}</span>
                  <span style={{ color: "var(--color-text-soft)" }}>{BID_STATUS_LABELS[event.status]}</span>
                  {event.note !== null ? <span style={{ color: "var(--color-text-soft)" }}>· {event.note}</span> : null}
                </li>
              ))}
            </ol>
            {canEdit && thread.open !== null ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {thread.open.side === "buyer" ? (
                  <button type="button" className="mv-btn-soft" disabled={busy} onClick={() => { setCounterFor(thread.buyer.id); setAmount(""); }}>
                    הצעת נגד
                  </button>
                ) : null}
                <button type="button" className="mv-btn-soft" disabled={busy} onClick={() => void decide(thread.open!.id, "accepted")}>
                  {thread.open.side === "buyer" ? "המוכר קיבל" : "הקונה קיבל"}
                </button>
                <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void decide(thread.open!.id, "rejected")}>
                  {thread.open.side === "buyer" ? "המוכר דחה" : "הקונה דחה"}
                </button>
                {thread.open.side === "buyer" ? (
                  <button type="button" className="mv-btn-plain" disabled={busy} onClick={() => void decide(thread.open!.id, "withdrawn")}>
                    הקונה משך
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
