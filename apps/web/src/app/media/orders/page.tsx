"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { type MediaOrderStatus, type MediaProductKind } from "@metavchim/shared";
import { apiGet, apiList } from "@/lib/api";
import { formatDateTime, formatPrice } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { IconList } from "../../icons";
import { LoadError } from "../../load-error";

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
  const { loading } = useRequireAuth();
  const [items, setItems] = useState<OrderRow[] | null>(null);
  const [failed, setFailed] = useState(false);

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
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
