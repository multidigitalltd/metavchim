"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { type MediaOrderStatus, type MediaProductKind } from "@metavchim/shared";
import { apiGet, apiList, apiPost, ApiError } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ConfirmDialog } from "../../confirm-dialog";
import { IconCard, IconList } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * ההזמנות של המשרד — מה הוזמן, מתי, ומה קרה איתו.
 *
 * הרשימה עונה על השאלה "שלחנו?" בלי לפתוח את המייל: הזמנה בתשלום
 * שנשלחה למדיה מסומנת כך, והפניה שנשלחה לנציג — כך. הזמנה שממתינה
 * לתשלום היא דף שנפתח ולא הסתיים; אין כאן מה לעשות איתה מלבד
 * להזמין מחדש.
 */

interface OrderRow {
  id: string;
  canResume: boolean;
  outletName: string;
  outletSlug: string | null;
  productName: string;
  kind: MediaProductKind;
  status: MediaOrderStatus;
  statusLabel: string;
  quantity: number;
  amountAgorot: number;
  contactName: string;
  brief: string;
  createdAt: string;
  paidAt: string | null;
}

const STATUS_TONE: Record<MediaOrderStatus, string> = {
  pending_payment: "mv-domain-amber",
  paid: "mv-domain-green",
  referred: "mv-domain-blue",
  failed: "mv-domain-peach",
  cancelled: "mv-domain-neutral",
};

export default function MediaOrdersPage(): React.JSX.Element | null {
  const { user, loading } = useRequireAuth();
  const [items, setItems] = useState<OrderRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<OrderRow | null>(null);
  const mayPay = can(user, "billing.manage");

  const load = useCallback(() => {
    setFailed(false);
    setItems(null);
    apiGet<{ orders: OrderRow[] }>("/media/orders")
      .then((res) => setItems(apiList(res.orders, "orders")))
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (loading) return;
    load();
  }, [loading, load]);

  if (loading) return null;

  /** המשך לתשלום — דף חדש להזמנה שנשארה ממתינה; יציאה לקארדקום. */
  async function resume(order: OrderRow): Promise<void> {
    setBusy(order.id);
    setError(null);
    try {
      const res = await apiPost<{ url: string }>(`/media/orders/${order.id}/checkout`, {});
      window.location.assign(res.url);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(null);
    }
  }

  async function cancel(order: OrderRow): Promise<void> {
    setBusy(order.id);
    setError(null);
    try {
      await apiPost(`/media/orders/${order.id}/cancel`, {});
      setCancelling(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    } finally {
      setBusy(null);
    }
  }

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <Link href="/media" className="mb-3 inline-block">
        ← לכל המדיות
      </Link>
      <header className="mv-hero mb-5">
        <span className="mv-hero-icon" aria-hidden="true">
          <IconList s={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-2xl font-extrabold">ההזמנות שלנו</h1>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            כל מה שהמשרד הזמין או ביקש במדיות, מהחדש לישן.
          </p>
        </div>
      </header>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {failed ? (
        <LoadError message="לא הצלחנו לטעון את ההזמנות" onRetry={load} />
      ) : items === null ? (
        <p aria-live="polite">טוען…</p>
      ) : items.length === 0 ? (
        <div className="mv-card mv-card--pad text-center">
          <p className="m-0 font-bold">עדיין לא הזמנתם דבר</p>
          <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
            בוחרים מדיה בארכיון, ומשם מזמינים.
          </p>
          <Link href="/media" className="mv-btn-soft mt-4 inline-flex">
            לארכיון המדיות
          </Link>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((order) => (
            <li key={order.id} className="mv-card mv-card--pad">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`mv-pill ${STATUS_TONE[order.status] ?? "mv-domain-neutral"}`}>
                  {order.statusLabel}
                </span>
                <h2 className="m-0 text-[length:var(--type-row-title)] font-extrabold">
                  {order.outletSlug ? (
                    <Link href={`/media/${order.outletSlug}`} className="no-underline hover:underline">
                      {order.outletName}
                    </Link>
                  ) : (
                    order.outletName
                  )}
                  {" — "}
                  {order.productName}
                  {order.quantity > 1 ? ` ×${order.quantity}` : ""}
                </h2>
                <span className="ms-auto text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  {formatDateTime(order.createdAt)}
                </span>
              </div>
              <p className="m-0 mt-2 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                {order.kind === "paid"
                  ? `${formatPrice(order.amountAgorot)} + מע"מ · איש קשר: ${order.contactName}`
                  : `פנייה לנציג · איש קשר: ${order.contactName}`}
              </p>
              {order.brief ? (
                <p className="m-0 mt-1 whitespace-pre-line text-[length:var(--type-body-sm)]">{order.brief}</p>
              ) : null}
              {order.canResume ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {mayPay ? (
                    <>
                      <button
                        type="button"
                        className="mv-btn-action"
                        disabled={busy !== null}
                        onClick={() => void resume(order)}
                      >
                        <IconCard s={15} /> {busy === order.id ? "פותחים דף תשלום…" : "המשך לתשלום"}
                      </button>
                      <button
                        type="button"
                        className="mv-btn-plain"
                        disabled={busy !== null}
                        onClick={() => setCancelling(order)}
                      >
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
            </li>
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        title={cancelling ? `לבטל את ההזמנה ב${cancelling.outletName}?` : ""}
        tone="danger"
        confirmLabel="ביטול ההזמנה"
        cancelLabel="להשאיר"
        busy={busy !== null}
        busyLabel="מבטלים…"
        onConfirm={() => {
          if (cancelling) void cancel(cancelling);
        }}
        onClose={() => {
          if (busy === null) setCancelling(null);
        }}
      >
        <p className="m-0">לא בוצע חיוב, ולא נשלח דבר למדיה. אפשר להזמין שוב בכל עת.</p>
      </ConfirmDialog>
    </div>
  );
}
