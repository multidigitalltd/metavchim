"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  MEDIA_ORDER_BRIEF_MAX,
  MEDIA_ORDER_MAX_QUANTITY,
  MEDIA_OUTLET_KIND_LABEL,
  grossFromNet,
  type MediaOutletKind,
  type MediaProductKind,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { can, useRequireAuth } from "@/lib/use-auth";
import { ActionToast, type ToastState } from "../../action-toast";
import { ConfirmDialog } from "../../confirm-dialog";
import { IconCard, IconCheck, IconEye, IconSend } from "../../icons";
import { LoadError } from "../../load-error";
import { Notice } from "../../notice";

/**
 * העמוד הפנימי של מדיה — מה כלול, מה החשיפה, ומה אפשר להזמין.
 *
 * ## שני כפתורים, שני מסלולים
 *
 * - **הזמנה ותשלום** — מוצר עם מחיר. נפתח טופס קצר (כמות, תדריך,
 *   איש קשר), ומשם לדף התשלום של קארדקום. ההזמנה יוצאת לנציג המדיה
 *   רק אחרי שהתשלום אושר. רק מי שמנהל את החיוב במשרד יכול לשלם —
 *   כמו כל רכישה בכרטיס המשרד.
 * - **פנייה לנציג** — מוצר בלי מחיר קבוע. אותו טופס, בלי תשלום:
 *   הפנייה נשלחת לנציג והוא חוזר למשרד. כל משתמש יכול.
 *
 * המחירים מוצגים נטו + מע"מ, כמו במסך המנוי. הסכום שנגבה מוצג
 * בטופס לפני האישור — אותה פונקציה שהשרת מחשב בה.
 */

interface ProductRow {
  id: string;
  name: string;
  description: string;
  specs: string;
  kind: MediaProductKind;
  priceAgorot: number | null;
}

interface OutletDetail {
  id: string;
  slug: string;
  name: string;
  kind: MediaOutletKind;
  tagline: string;
  description: string;
  audience: string;
  reachText: string;
  frequency: string;
  highlights: string[];
  hasContact: boolean;
  products: ProductRow[];
  checkoutAvailable: boolean;
  vatPercent: number;
}

interface OrderForm {
  quantity: number;
  brief: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
}

export default function MediaOutletPage(): React.JSX.Element | null {
  const { user, loading: authLoading } = useRequireAuth();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [outlet, setOutlet] = useState<OutletDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [ordering, setOrdering] = useState<ProductRow | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<OutletDetail>(`/media/${encodeURIComponent(slug)}`)
      .then(setOutlet)
      .catch(() => setFailed(true));
  }, [slug]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  if (authLoading) return null;
  if (failed) {
    return (
      <div className="mv-page">
        <Link href="/media" className="mb-3 inline-block">
          ← לכל המדיות
        </Link>
        <LoadError message="לא הצלחנו לטעון את פרטי המדיה" onRetry={load} />
      </div>
    );
  }
  if (outlet === null) return <p aria-live="polite">טוען…</p>;

  const mayPay = can(user, "billing.manage");

  return (
    // div ולא main — העטיפה של AppShell היא ה-main landmark היחיד
    <div className="mv-page">
      <Link href="/media" className="mb-3 inline-block">
        ← לכל המדיות
      </Link>

      <header className="mv-card mv-card--pad mb-4">
        <span className="mv-pill mv-domain-blue">{MEDIA_OUTLET_KIND_LABEL[outlet.kind] ?? outlet.kind}</span>
        <h1 className="m-0 mt-2 text-2xl font-extrabold">{outlet.name}</h1>
        {outlet.tagline ? (
          <p className="m-0 mt-1 text-[length:var(--type-body)]" style={{ color: "var(--color-text-soft)" }}>
            {outlet.tagline}
          </p>
        ) : null}
        {outlet.reachText || outlet.frequency ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {outlet.reachText ? (
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--color-primary-soft)" }}>
                <span className="block text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-text-muted)" }}>
                  <IconEye s={14} /> חשיפה
                </span>
                <span className="block font-extrabold">{outlet.reachText}</span>
              </div>
            ) : null}
            {outlet.frequency ? (
              <div className="rounded-xl px-4 py-3" style={{ background: "var(--color-bg)" }}>
                <span className="block text-[length:var(--type-caption)] font-bold" style={{ color: "var(--color-text-muted)" }}>
                  תדירות
                </span>
                <span className="block font-extrabold">{outlet.frequency}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="mv-card mv-card--pad" aria-labelledby="media-about">
          <h2 id="media-about" className="m-0 text-[length:var(--type-card-title)] font-extrabold">
            על המדיה
          </h2>
          <p className="m-0 mt-2 whitespace-pre-line leading-relaxed">
            {outlet.description || "תיאור המדיה יתווסף בקרוב."}
          </p>
          {outlet.highlights.length > 0 ? (
            <>
              <h3 className="m-0 mt-4 text-[length:var(--type-body)] font-extrabold">מה כלול</h3>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {outlet.highlights.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span aria-hidden="true" style={{ color: "var(--color-primary)" }}>
                      <IconCheck s={16} />
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="mv-card mv-card--pad" aria-labelledby="media-audience">
          <h2 id="media-audience" className="m-0 text-[length:var(--type-card-title)] font-extrabold">
            החשיפה
          </h2>
          <p className="m-0 mt-2 whitespace-pre-line leading-relaxed">
            {outlet.audience || "פרטי החשיפה יתווספו בקרוב."}
          </p>
        </section>
      </div>

      <section className="mt-4" aria-labelledby="media-products">
        <h2 id="media-products" className="m-0 mb-3 text-[length:var(--type-card-title)] font-extrabold">
          מוצרים לרכישה
        </h2>

        {!outlet.checkoutAvailable && outlet.products.some((p) => p.kind === "paid") ? (
          <Notice tone="info">
            הסליקה טרם הופעלה במערכת — מוצרים בתשלום מוצגים לעיון, וההזמנה דרך הנציג.
          </Notice>
        ) : null}

        {outlet.products.length === 0 ? (
          <div className="mv-card mv-card--pad text-center">
            <p className="m-0 font-bold">טרם הוגדרו מוצרים למדיה הזו</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {outlet.products.map((product) => {
              const paid = product.kind === "paid" && product.priceAgorot !== null;
              return (
                <li key={product.id} className="mv-card mv-card--pad flex flex-col">
                  <span className={`mv-pill self-start ${paid ? "mv-domain-green" : "mv-domain-amber"}`}>
                    {paid ? "הזמנה ותשלום במערכת" : "פנייה לנציג"}
                  </span>
                  <h3 className="m-0 mt-2 text-[length:var(--type-row-title)] font-extrabold leading-snug">
                    {product.name}
                  </h3>
                  {product.specs ? (
                    <p className="m-0 mt-1 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                      {product.specs}
                    </p>
                  ) : null}
                  {product.description ? (
                    <p className="m-0 mt-2 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-soft)" }}>
                      {product.description}
                    </p>
                  ) : null}
                  <p className="m-0 mt-3 text-[length:var(--type-metric)] font-extrabold">
                    {paid ? (
                      <>
                        {formatPrice(product.priceAgorot ?? 0)}{" "}
                        <span className="text-[length:var(--type-caption-lg)] font-semibold" style={{ color: "var(--color-text-muted)" }}>
                          + מע&quot;מ
                        </span>
                      </>
                    ) : (
                      <span className="text-[length:var(--type-body)] font-bold">מחיר לפי תיאום</span>
                    )}
                  </p>
                  <div className="mt-auto pt-4">
                    {paid ? (
                      outlet.checkoutAvailable && mayPay ? (
                        <button type="button" className="mv-btn-action" onClick={() => setOrdering(product)}>
                          <IconCard s={15} /> הזמנה ותשלום
                        </button>
                      ) : (
                        <p className="m-0 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                          {outlet.checkoutAvailable
                            ? "רק מי שמנהל את החיוב במשרד יכול להזמין בתשלום."
                            : "ההזמנה כרגע דרך נציג המדיה."}
                        </p>
                      )
                    ) : (
                      <button type="button" className="mv-btn-soft" onClick={() => setOrdering(product)}>
                        <IconSend s={15} /> פנייה לנציג
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ‏נבנה מחדש לכל מוצר — התדריך של מודעה אחת אינו של השנייה */}
      {ordering !== null ? (
        <OrderDialog
          key={ordering.id}
          outlet={outlet}
          product={ordering}
          defaults={{ contactName: user?.name ?? "", contactEmail: user?.email ?? "" }}
          onClose={() => setOrdering(null)}
          onReferred={() => {
            setOrdering(null);
            setToast({ text: "הפנייה נשלחה לנציג המדיה — הוא יחזור אליכם", tone: "success" });
          }}
        />
      ) : null}
      <ActionToast state={toast} onClose={() => setToast(null)} />
    </div>
  );
}

/**
 * טופס ההזמנה — אותו טופס לשני המסלולים; רק הכפתור והיעד שונים.
 *
 * ‎`ConfirmDialog` ולא טופס בעמוד: ההזמנה היא החלטה קטנה שמסתיימת
 * בלחיצה אחת, ודיאלוג מחזיק את המיקוד עד שהיא מסתיימת או מתבטלת.
 */
function OrderDialog({
  outlet,
  product,
  defaults,
  onClose,
  onReferred,
}: {
  outlet: OutletDetail;
  product: ProductRow;
  defaults: { contactName: string; contactEmail: string };
  onClose: () => void;
  onReferred: () => void;
}): React.JSX.Element {
  const [form, setForm] = useState<OrderForm>({
    quantity: 1,
    brief: "",
    contactName: defaults.contactName,
    contactPhone: "",
    contactEmail: defaults.contactEmail,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = product.kind === "paid" && product.priceAgorot !== null;
  const net = (product.priceAgorot ?? 0) * form.quantity;
  // אותה פונקציה שהשרת בונה בה את הסכום לחיוב — לא העתק שלה
  const gross = grossFromNet(net, outlet.vatPercent);
  const ready =
    form.contactName.trim().length >= 2 &&
    form.contactPhone.trim().length >= 9 &&
    form.contactEmail.includes("@");

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const body = {
      productId: product.id,
      quantity: form.quantity,
      brief: form.brief.trim(),
      contactName: form.contactName.trim(),
      contactPhone: form.contactPhone.trim(),
      contactEmail: form.contactEmail.trim(),
    };
    try {
      if (paid) {
        const res = await apiPost<{ url: string }>("/media/orders/checkout", body);
        // יציאה לדף של קארדקום. assign ולא replace: "אחורה" מדף התשלום
        // צריך להחזיר לכאן
        window.location.assign(res.url);
        return;
      }
      await apiPost("/media/orders/referral", body);
      onReferred();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError
          ? (err.issues[0]?.message ?? err.message)
          : paid
            ? "פתיחת התשלום נכשלה"
            : "שליחת הפנייה נכשלה",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title={paid ? `הזמנה — ${product.name}` : `פנייה לנציג — ${product.name}`}
      confirmLabel={paid ? `לתשלום ${formatPrice(gross)}` : "שליחת הפנייה"}
      busy={busy}
      busyLabel={paid ? "פותחים דף תשלום…" : "שולחים…"}
      confirmDisabled={!ready}
      onConfirm={() => void submit()}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="m-0 mb-3 text-[length:var(--type-body-sm)]" style={{ color: "var(--color-text-muted)" }}>
        {paid
          ? `${outlet.name} — ${product.name}. התשלום במערכת, וההזמנה עוברת למדיה מיד אחרי אישור התשלום.`
          : `${outlet.name} — ${product.name}. הפנייה נשלחת לנציג המדיה, והוא חוזר אליכם לתיאום מחיר ומועד.`}
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-3">
        <label>
          <span className="mb-1 block text-sm font-bold">כמות</span>
          <input
            className="mv-field"
            type="number"
            inputMode="numeric"
            min={1}
            max={MEDIA_ORDER_MAX_QUANTITY}
            value={form.quantity}
            onChange={(e) =>
              setForm({
                ...form,
                quantity: Math.max(1, Math.min(MEDIA_ORDER_MAX_QUANTITY, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
        <label>
          <span className="mb-1 block text-sm font-bold">מה לפרסם</span>
          <textarea
            className="mv-field"
            rows={4}
            maxLength={MEDIA_ORDER_BRIEF_MAX}
            placeholder="איזה נכס, מה להדגיש, הערות למעצב"
            value={form.brief}
            onChange={(e) => setForm({ ...form, brief: e.target.value })}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="mb-1 block text-sm font-bold">איש קשר במשרד</span>
            <input
              className="mv-field"
              autoComplete="name"
              maxLength={120}
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              required
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-bold">טלפון</span>
            <input
              className="mv-field"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              maxLength={25}
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              required
            />
          </label>
        </div>
        <label>
          <span className="mb-1 block text-sm font-bold">דוא&quot;ל</span>
          <input
            className="mv-field"
            type="email"
            dir="ltr"
            autoComplete="email"
            maxLength={254}
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            required
          />
        </label>
      </div>

      {paid ? (
        <dl className="m-0 mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-[length:var(--type-body-sm)]">
          <dt className="m-0">
            {product.name} × {form.quantity}
          </dt>
          <dd className="m-0 text-end">{formatPrice(net)}</dd>
          <dt className="m-0">מע&quot;מ {outlet.vatPercent}%</dt>
          <dd className="m-0 text-end">{formatPrice(gross - net)}</dd>
          <dt className="m-0 font-extrabold">לתשלום</dt>
          <dd className="m-0 text-end font-extrabold">{formatPrice(gross)}</dd>
        </dl>
      ) : null}
    </ConfirmDialog>
  );
}
