"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  MEDIA_CREATIVE_MAX_BYTES,
  type MediaOrderStatus,
  type MediaProductKind,
  type MediaTimelineState,
} from "@metavchim/shared";
import { API_BASE, apiGet, apiPost, ApiError, mediaSrc } from "@/lib/api";
import { formatBytes, formatDateTime, formatPrice } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ConfirmDialog } from "../../../confirm-dialog";
import { IconCard, IconCheck, IconDoc, IconList, IconUpload } from "../../../icons";
import { LoadError } from "../../../load-error";
import { Notice } from "../../../notice";

/**
 * עמוד ההזמנה — מה קרה, מה עכשיו, ומה אפשר לעשות.
 *
 * הרשימה עונה על „שלחנו?”; העמוד הזה עונה על „איפה זה עומד”: ציר זמן
 * מההזמנה ועד הפרסום, קובץ המודעה (להעלות, להחליף, לראות), ופעולות —
 * המשך לתשלום, ביטול, הזמנה חוזרת.
 *
 * ## קובץ המודעה
 *
 * זה מה שהמגזין באמת צריך. ההעלאה פתוחה לכל משתמש במשרד (מי שמנהל
 * את המודעה אינו בהכרח מי שמשלם), כל עוד ההזמנה חיה וטרם פורסמה.
 * ‎`fetch` ישיר ולא `apiPost`: multipart, בלי כותרת JSON.
 */

interface TimelineStep {
  key: "created" | "paid" | "sent" | "creative" | "published";
  label: string;
  at: string | null;
  state: MediaTimelineState;
}

interface OrderDetail {
  id: string;
  canResume: boolean;
  canUploadCreative: boolean;
  outletName: string;
  outletSlug: string | null;
  productName: string;
  kind: MediaProductKind;
  status: MediaOrderStatus;
  statusLabel: string;
  quantity: number;
  amountAgorot: number;
  unitPriceAgorot: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  brief: string;
  createdAt: string;
  paidAt: string | null;
  notifiedAt: string | null;
  creativeName: string | null;
  creativeMime: string | null;
  creativeUploadedAt: string | null;
  publishedAt: string | null;
  publishedNote: string;
  timeline: TimelineStep[];
  outletContact: { name: string; phone: string } | null;
}

const STATUS_TONE: Record<MediaOrderStatus, string> = {
  pending_payment: "mv-domain-amber",
  paid: "mv-domain-green",
  referred: "mv-domain-blue",
  failed: "mv-domain-peach",
  cancelled: "mv-domain-neutral",
  published: "mv-domain-violet",
};

const STEP_TONE: Record<MediaTimelineState, string> = {
  done: "var(--color-primary)",
  current: "var(--color-warning, #b7791f)",
  pending: "var(--color-text-muted)",
  failed: "var(--color-danger, #b42318)",
};

export default function MediaOrderPage({ params }: { params: Promise<{ id: string }> }): React.JSX.Element | null {
  const { user, loading } = useRequireAuth();
  const [id, setId] = useState<string | null>(null);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"pay" | "cancel" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mayPay = can(user, "billing.manage");

  useEffect(() => {
    void params.then(({ id: value }) => setId(value));
  }, [params]);

  const load = useCallback(() => {
    if (id === null) return;
    setFailed(false);
    apiGet<OrderDetail>(`/media/orders/${id}`)
      .then(setOrder)
      .catch(() => setFailed(true));
  }, [id]);

  useEffect(() => {
    if (loading || id === null) return;
    load();
  }, [loading, id, load]);

  if (loading || id === null) return null;

  async function resume(): Promise<void> {
    if (!order) return;
    setBusy("pay");
    setError(null);
    try {
      const res = await apiPost<{ url: string }>(`/media/orders/${order.id}/checkout`, {});
      window.location.assign(res.url);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    if (!order) return;
    setBusy("cancel");
    setError(null);
    try {
      await apiPost(`/media/orders/${order.id}/cancel`, {});
      setCancelling(false);
      setMessage("ההזמנה בוטלה.");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File): Promise<void> {
    if (!order) return;
    if (file.size > MEDIA_CREATIVE_MAX_BYTES) {
      setError(`הקובץ גדול מדי — עד ${formatBytes(MEDIA_CREATIVE_MAX_BYTES)}`);
      return;
    }
    setBusy("upload");
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`${API_BASE}/media/orders/${order.id}/creative`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const text =
          payload !== null && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
            ? payload.message
            : "ההעלאה נכשלה";
        throw new Error(text);
      }
      setMessage(order.creativeName ? "קובץ המודעה הוחלף." : "קובץ המודעה הועלה.");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "ההעלאה נכשלה");
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <Link href="/media/orders" className="mb-3 inline-block">
        ← לכל ההזמנות
      </Link>

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את ההזמנה" onRetry={load} />
      ) : order === null ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          <header className="mv-hero mb-5">
            <span className="mv-hero-icon" aria-hidden="true">
              <IconList s={26} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`mv-pill ${STATUS_TONE[order.status] ?? "mv-domain-neutral"}`}>{order.statusLabel}</span>
                <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  הזמנה מ-{formatDateTime(order.createdAt)}
                </span>
              </div>
              <h1 className="m-0 mt-1 text-2xl font-extrabold">
                {order.outletName} — {order.productName}
                {order.quantity > 1 ? ` ×${order.quantity}` : ""}
              </h1>
              <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                {order.kind === "paid"
                  ? `${formatPrice(order.amountAgorot)} + מע"מ${order.quantity > 1 ? ` (${formatPrice(order.unitPriceAgorot)} ליחידה)` : ""}`
                  : "פנייה לנציג — המחיר לפי תיאום"}
              </p>
            </div>
          </header>

          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice tone="success">{message}</Notice> : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {/* ציר הזמן */}
            <section className="mv-card mv-card--pad" aria-labelledby="order-timeline-heading">
              <h2 id="order-timeline-heading" className="m-0 mb-3 text-[length:var(--type-row-title)] font-extrabold">
                איפה זה עומד
              </h2>
              <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {order.timeline.map((step) => (
                  <li key={step.key} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-sm font-bold"
                      style={{
                        borderColor: STEP_TONE[step.state],
                        color: step.state === "done" ? "var(--color-on-action, #fff)" : STEP_TONE[step.state],
                        background: step.state === "done" ? STEP_TONE.done : "transparent",
                      }}
                    >
                      {step.state === "done" ? <IconCheck s={12} /> : step.state === "failed" ? "!" : ""}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 font-bold" style={{ color: step.state === "pending" ? "var(--color-text-muted)" : undefined }}>
                        {step.label}
                        {step.state === "current" ? (
                          <span className="ms-2 text-[length:var(--type-caption)] font-normal" style={{ color: STEP_TONE.current }}>
                            השלב הנוכחי
                          </span>
                        ) : null}
                      </p>
                      {step.at ? (
                        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                          {formatDateTime(step.at)}
                          {step.key === "published" && order.publishedNote ? ` · ${order.publishedNote}` : ""}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>

              {order.canResume ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {mayPay ? (
                    <>
                      <button type="button" className="mv-btn-action" disabled={busy !== null} onClick={() => void resume()}>
                        <IconCard s={15} /> {busy === "pay" ? "פותחים דף תשלום…" : "המשך לתשלום"}
                      </button>
                      <button type="button" className="mv-btn-plain" disabled={busy !== null} onClick={() => setCancelling(true)}>
                        ביטול ההזמנה
                      </button>
                    </>
                  ) : (
                    <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                      ההזמנה ממתינה לתשלום — מי שמנהל את החיוב במשרד יכול להשלים אותה.
                    </span>
                  )}
                </div>
              ) : null}
            </section>

            {/* קובץ המודעה */}
            <section className="mv-card mv-card--pad" aria-labelledby="order-creative-heading">
              <h2 id="order-creative-heading" className="m-0 mb-1 text-[length:var(--type-row-title)] font-extrabold">
                קובץ המודעה
              </h2>
              <p className="m-0 mb-3 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
                מה שהמגזין מקבל לדפוס: מודעה מעוצבת ב-PDF, או תמונה מוכנה (JPEG / PNG), עד {formatBytes(MEDIA_CREATIVE_MAX_BYTES)}.
                הקובץ נשמר כפי שהוא, ונציג המדיה מקבל קישור אליו במייל.
              </p>

              {order.creativeName ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3" style={{ borderColor: "var(--color-row-border)" }}>
                  <IconDoc s={22} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 font-bold" dir="auto">
                      {order.creativeName}
                    </p>
                    <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                      הועלה {order.creativeUploadedAt ? formatDateTime(order.creativeUploadedAt) : ""}
                    </p>
                  </div>
                  <a
                    className="mv-btn-soft"
                    href={mediaSrc(`media/orders/${order.id}/creative`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    לצפייה
                  </a>
                </div>
              ) : (
                <p className="m-0 rounded-xl border p-3 text-[length:var(--type-body-sm)]" style={{ borderColor: "var(--color-row-border)", color: "var(--color-text-muted)" }}>
                  {order.canUploadCreative
                    ? "עדיין לא הועלה קובץ. אפשר להעלות עכשיו, גם לפני שהתשלום הושלם."
                    : "לא הועלה קובץ להזמנה הזו."}
                </p>
              )}

              {order.canUploadCreative ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    className="mv-visually-hidden"
                    id="creative-file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                  <button
                    type="button"
                    className="mv-btn-action"
                    disabled={busy !== null}
                    onClick={() => fileInput.current?.click()}
                  >
                    <IconUpload s={15} /> {busy === "upload" ? "מעלים…" : order.creativeName ? "החלפת הקובץ" : "העלאת קובץ המודעה"}
                  </button>
                  {order.creativeName && (order.status === "paid" || order.status === "referred") ? (
                    <span className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                      החלפה שולחת לנציג קישור חדש, והקישור הקודם מפסיק לעבוד.
                    </span>
                  ) : null}
                </div>
              ) : order.status === "published" ? (
                <p className="m-0 mt-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  המודעה פורסמה — הקובץ נשמר כתיעוד ואינו ניתן להחלפה.
                </p>
              ) : null}
            </section>
          </div>

          {/* הפרטים */}
          <section className="mv-card mv-card--pad mt-4" aria-labelledby="order-details-heading">
            <h2 id="order-details-heading" className="m-0 mb-3 text-[length:var(--type-row-title)] font-extrabold">
              פרטי ההזמנה
            </h2>
            <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>איש קשר במשרד</dt>
                <dd className="m-0 font-bold">
                  {order.contactName}
                  <span className="block font-normal" dir="ltr">{order.contactPhone}</span>
                  <span className="block font-normal" dir="ltr">{order.contactEmail}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>נציג המדיה</dt>
                <dd className="m-0 font-bold">
                  {order.outletContact ? (
                    <>
                      {order.outletContact.name || "—"}
                      {order.outletContact.phone ? <span className="block font-normal" dir="ltr">{order.outletContact.phone}</span> : null}
                    </>
                  ) : (
                    <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>יחזור אליכם דרך הפלטפורמה</span>
                  )}
                </dd>
              </div>
              {order.brief ? (
                <div className="sm:col-span-2">
                  <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>מה לפרסם</dt>
                  <dd className="m-0 whitespace-pre-line">{order.brief}</dd>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <dt className="text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>מספר הזמנה</dt>
                <dd className="m-0" dir="ltr">{order.id}</dd>
              </div>
            </dl>
            {order.outletSlug ? (
              <div className="mt-4">
                <Link href={`/media/${order.outletSlug}`} className="mv-btn-soft inline-flex">
                  הזמנה חוזרת מ{order.outletName}
                </Link>
              </div>
            ) : null}
          </section>
        </>
      )}

      <ConfirmDialog
        open={cancelling}
        title={order ? `לבטל את ההזמנה ב${order.outletName}?` : ""}
        tone="danger"
        confirmLabel="ביטול ההזמנה"
        cancelLabel="להשאיר"
        busy={busy === "cancel"}
        busyLabel="מבטלים…"
        onConfirm={() => void cancel()}
        onClose={() => {
          if (busy === null) setCancelling(false);
        }}
      >
        <p className="m-0">לא בוצע חיוב, ולא נשלח דבר למדיה. אפשר להזמין שוב בכל עת.</p>
      </ConfirmDialog>
    </div>
  );
}
