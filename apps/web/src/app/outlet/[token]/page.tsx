"use client";

import { useCallback, useEffect, useState } from "react";
import { type MediaProductKind } from "@metavchim/shared";
import { apiGet, apiPost, ApiError, mediaSrc } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { IconCheck, IconDoc, IconDownload, IconSend } from "../../icons";
import { Notice } from "../../notice";

/**
 * עמוד ההזמנה של נציג המדיה — הקישור הקבוע שבמייל.
 *
 * דף ציבורי (ב-`PUBLIC_PREFIXES`): לנציג אין חשבון, והאסימון שבכתובת
 * הוא ההרשאה. כאן הוא רואה את ההזמנה כפי שהיא במייל, את קובץ המודעה
 * העדכני (לא הקישור הישן), ועושה את שני הדברים שעד עכשיו דרשו טלפון:
 * מאשר שההזמנה התקבלה, ומסמן כשהמודעה יצאה — עם הערה (גיליון, עמוד).
 * המשרד מקבל על שניהם מייל והתראה בפעמון.
 *
 * בלי מספרי העמלה — הם של הפלטפורמה. הזמנה שאינה אצל המדיה (ממתינה,
 * בוטלה) מחזירה 404, והדף אומר שהקישור אינו בתוקף.
 */

interface OutletOrderView {
  outletName: string;
  productName: string;
  quantity: number;
  kind: MediaProductKind;
  amountAgorot: number;
  brief: string;
  officeName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  createdAt: string;
  creative: { name: string; mime: string; uploadedAt: string } | null;
  outletConfirmedAt: string | null;
  publishedAt: string | null;
  publishedNote: string;
  publishedBy: string;
  closingText: string;
  nextClosingAt: string | null;
}

export default function OutletOrderPage({ params }: { params: Promise<{ token: string }> }): React.JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<OutletOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"confirm" | "publish" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback((t: string) => {
    return apiGet<OutletOrderView>(`/public/media/orders/${t}`)
      .then((res) => setView(res))
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && err.status === 404
            ? "הקישור אינו בתוקף — ההזמנה אינה פעילה, או שהכתובת שגויה. בדקו את המייל האחרון שקיבלתם."
            : "לא הצלחנו לטעון את ההזמנה. נסו שוב בעוד רגע.",
        );
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    params
      .then(({ token: t }) => {
        if (cancelled) return;
        setToken(t);
        void load(t);
      })
      .catch(() => setError("לא הצלחנו לטעון את ההזמנה. נסו שוב בעוד רגע."));
    return () => {
      cancelled = true;
    };
  }, [params, load]);

  async function act(kind: "confirm" | "publish"): Promise<void> {
    if (token === null) return;
    setBusy(kind);
    setActionError(null);
    setDone(null);
    try {
      if (kind === "confirm") {
        await apiPost(`/public/media/orders/${token}/confirm`, {});
        setDone("תודה — המשרד קיבל הודעה שההזמנה אצלכם.");
      } else {
        await apiPost(`/public/media/orders/${token}/publish`, { note: note.trim() });
        setDone("תודה — המשרד קיבל הודעה שהמודעה פורסמה.");
      }
      await load(token);
    } catch (err: unknown) {
      setActionError(err instanceof ApiError ? err.message : "הפעולה נכשלה — נסו שוב");
    } finally {
      setBusy(null);
    }
  }

  const fileUrl = token === null ? null : mediaSrc(`public/media/orders/${token}/creative`);
  const closing =
    view === null
      ? null
      : view.nextClosingAt
        ? `הגיליון הקרוב נסגר ב-${formatDateTime(view.nextClosingAt)}`
        : view.closingText || null;

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page mx-auto max-w-3xl">
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconSend s={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">{view ? `הזמנה מ${view.officeName}` : "הזמנת פרסום"}</h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            {view ? `${view.outletName} — ${view.productName}${view.quantity > 1 ? ` ×${view.quantity}` : ""}` : "מערכת מתווכים · רכש מדיה"}
          </p>
        </div>
      </header>

      {error ? (
        <div className="mv-card mv-card--pad" role="alert">
          <p className="m-0 font-bold">{error}</p>
        </div>
      ) : view === null || fileUrl === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          {done ? <Notice tone="success">{done}</Notice> : null}
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}

          {/* איפה זה עומד — ומה הנציג יכול לעשות */}
          <section className="mv-card mv-card--pad" aria-labelledby="outlet-status-heading">
            <h2 id="outlet-status-heading" className="m-0 mb-3 text-[length:var(--type-row-title)] font-extrabold">
              איפה זה עומד
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="mv-pill mv-domain-green">{view.kind === "paid" ? "שולם במערכת" : "פנייה לתיאום"}</span>
              <span className={`mv-pill ${view.outletConfirmedAt ? "mv-domain-green" : "mv-domain-amber"}`}>
                {view.outletConfirmedAt ? `אישרתם קבלה ${formatDateTime(view.outletConfirmedAt)}` : "טרם אישרתם קבלה"}
              </span>
              <span className={`mv-pill ${view.publishedAt ? "mv-domain-violet" : "mv-domain-neutral"}`}>
                {view.publishedAt ? `פורסם ${formatDateTime(view.publishedAt)}` : "טרם פורסם"}
              </span>
            </div>

            {view.outletConfirmedAt === null ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button type="button" className="mv-btn-action" disabled={busy !== null} onClick={() => void act("confirm")}>
                  <IconCheck s={15} /> {busy === "confirm" ? "שולחים…" : "קיבלנו את ההזמנה"}
                </button>
                <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  המשרד יקבל הודעה שההזמנה אצלכם ושאפשר להתקדם.
                </span>
              </div>
            ) : null}

            {view.publishedAt === null ? (
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("publish");
                }}
              >
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[length:var(--type-body-sm)] font-bold">איפה פורסם (לא חובה)</span>
                  <input
                    className="mv-field"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={300}
                    placeholder="גיליון 412, עמ׳ 7"
                  />
                </label>
                <button type="submit" className="mv-btn-soft" disabled={busy !== null}>
                  {busy === "publish" ? "מסמנים…" : "המודעה פורסמה"}
                </button>
              </form>
            ) : (
              <p className="m-0 mt-3 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
                {view.publishedNote ? `${view.publishedNote} · ` : ""}
                {view.publishedBy === "outlet" ? "סומן על ידכם." : "סומן על ידי הפלטפורמה."} תודה!
              </p>
            )}
          </section>

          {/* ההזמנה */}
          <section className="mv-card mv-card--pad mt-4" aria-labelledby="outlet-order-heading">
            <h2 id="outlet-order-heading" className="m-0 mb-3 text-[length:var(--type-row-title)] font-extrabold">
              פרטי ההזמנה
            </h2>
            <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>משרד</dt>
                <dd className="m-0 font-bold">{view.officeName}</dd>
              </div>
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>מוצר</dt>
                <dd className="m-0 font-bold">
                  {view.productName}
                  {view.quantity > 1 ? ` × ${view.quantity}` : ""}
                </dd>
              </div>
              {view.kind === "paid" ? (
                <div>
                  <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>סכום</dt>
                  <dd className="m-0 font-bold">{formatPrice(view.amountAgorot)} + מע"מ · שולם במערכת</dd>
                </div>
              ) : (
                <div>
                  <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>מחיר</dt>
                  <dd className="m-0 font-bold">לפי תיאום ישיר מול המשרד</dd>
                </div>
              )}
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>איש קשר במשרד</dt>
                <dd className="m-0 font-bold">
                  {view.contactName}
                  <span className="block font-normal" dir="ltr">
                    <a href={`tel:${view.contactPhone}`}>{view.contactPhone}</a>
                  </span>
                  <span className="block font-normal" dir="ltr">
                    <a href={`mailto:${view.contactEmail}`}>{view.contactEmail}</a>
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>תאריך ההזמנה</dt>
                <dd className="m-0 font-bold">{formatDateTime(view.createdAt)}</dd>
              </div>
              {closing ? (
                <div>
                  <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>סגירת גיליון</dt>
                  <dd className="m-0 font-bold">{closing}</dd>
                </div>
              ) : null}
            </dl>
            {view.brief ? (
              <p className="m-0 mt-3 whitespace-pre-line text-[length:var(--type-body-sm)]">
                <span className="font-bold">מה לפרסם: </span>
                {view.brief}
              </p>
            ) : null}
          </section>

          {/* קובץ המודעה */}
          <section className="mv-card mv-card--pad mt-4" aria-labelledby="outlet-file-heading">
            <div className="flex flex-wrap items-center gap-3">
              <span className="mv-hero-icon" aria-hidden="true">
                <IconDoc s={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="outlet-file-heading" className="m-0 text-[length:var(--type-row-title)] font-extrabold" dir="auto">
                  {view.creative ? view.creative.name : "קובץ המודעה"}
                </h2>
                <p className="m-0 mt-1 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
                  {view.creative
                    ? `${view.creative.mime === "application/pdf" ? "PDF" : view.creative.mime === "image/png" ? "PNG" : "JPEG"} · הועלה ${formatDateTime(view.creative.uploadedAt)} · תמיד הגרסה העדכנית`
                    : "המשרד טרם העלה את הקובץ — תקבלו מייל כשיעלה, והוא יופיע גם כאן."}
                </p>
              </div>
              {view.creative ? (
                <a className="mv-btn-action" href={fileUrl} download={view.creative.name}>
                  <IconDownload s={15} /> הורדת הקובץ
                </a>
              ) : null}
            </div>
          </section>

          {view.creative ? (
            <section className="mv-card mt-4 overflow-hidden" aria-label="תצוגה מקדימה של המודעה">
              {view.creative.mime === "application/pdf" ? (
                <iframe
                  title={`תצוגה מקדימה — ${view.creative.name}`}
                  src={fileUrl}
                  className="block w-full border-0"
                  style={{ height: "min(80vh, 1000px)", background: "var(--color-surface)" }}
                />
              ) : (
                <img src={fileUrl} alt={`המודעה — ${view.creative.name}`} className="block h-auto w-full" />
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
