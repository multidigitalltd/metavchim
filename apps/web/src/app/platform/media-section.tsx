"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import {
  MAX_MEDIA_COMMISSION_PERCENT,
  MEDIA_OUTLET_KINDS,
  MEDIA_OUTLET_KIND_LABEL,
  MEDIA_PRODUCT_KINDS,
  MEDIA_PRODUCT_KIND_LABEL,
  type MediaOrderStatus,
  type MediaOutletKind,
  type MediaProductKind,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiList, apiPatch, apiPost, ApiError } from "@/lib/api";
import { formatDateTime, formatPrice, shekelsToAgorot } from "@/lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { IconGlobe, IconList, IconPlus, IconTrash } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * רכש מדיה — ניהול הארכיון במסך הפלטפורמה.
 *
 * שלושה דברים נקבעים כאן, וכולם נתונים ולא קוד:
 *
 * 1. **המדיות** — שם, סוג, מה כלול, החשיפה. מדיה חדשה מופיעה
 *    בארכיון של כל המשרדים בלי פריסה.
 * 2. **איש הקשר והעמלה** של כל מדיה — מי מקבל את ההזמנות במייל,
 *    וכמה אחוזים הפלטפורמה גובה על הזמנה בתשלום. מדיה בלי כתובת
 *    מסומנת כאן באזהרה: ההזמנות שלה מגיעות רק למנהלי הפלטפורמה.
 * 3. **המוצרים** — בתשלום (סליקה במערכת) או הפניה (הנציג סוגר
 *    ומשלם על ההפניה). המחירים נקובים בשקלים נטו במסך ונשמרים
 *    באגורות.
 *
 * ולמטה — ההזמנות של כל המשרדים, עם העמלה שנרשמה על כל אחת.
 */

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;
const inputClass = "w-full rounded-lg border px-3 py-2";

interface AdminProduct {
  id: string;
  name: string;
  description: string;
  specs: string;
  kind: MediaProductKind;
  priceAgorot: number | null;
  leadFeeAgorot: number | null;
  active: boolean;
  sortOrder: number;
}

interface AdminOutlet {
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
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  commissionPercent: number;
  active: boolean;
  sortOrder: number;
  products: AdminProduct[];
}

interface AdminOrder {
  id: string;
  tenantId: string;
  officeName: string;
  customerNo: number | null;
  outletName: string;
  productName: string;
  kind: MediaProductKind;
  status: MediaOrderStatus;
  statusLabel: string;
  quantity: number;
  amountAgorot: number;
  commissionPercent: number;
  commissionAgorot: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  brief: string;
  notifiedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/** שקלים בטופס ⟵ אגורות; ריק ⟵ null. */
function agorotOrNull(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? shekelsToAgorot(value) : null;
}

function shekelsValue(agorot: number | null): string {
  return agorot === null ? "" : String(agorot / 100);
}

export function MediaSection(): React.JSX.Element {
  const [outlets, setOutlets] = useState<AdminOutlet[] | null>(null);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminProduct | null>(null);

  const load = useCallback(() => {
    setLoadFailed(false);
    Promise.all([
      apiGet<{ outlets: AdminOutlet[] }>("/platform/media").then((res) =>
        setOutlets(apiList(res.outlets, "outlets")),
      ),
      apiGet<{ orders: AdminOrder[] }>("/platform/media/orders").then((res) =>
        setOrders(apiList(res.orders, "orders")),
      ),
    ]).catch(() => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      load();
    } catch (err: unknown) {
      setError(
        err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : "הפעולה נכשלה",
      );
    } finally {
      setBusy(false);
    }
  }

  function createOutlet(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    void run(async () => {
      await apiPost("/platform/media/outlets", {
        name: text(form, "name"),
        slug: text(form, "slug"),
        kind: text(form, "kind"),
        commissionPercent: Number(text(form, "commissionPercent") || "10"),
      });
      element.reset();
    }, "✓ המדיה נוספה — עכשיו אפשר למלא את הפרטים ולהוסיף מוצרים");
  }

  function saveOutlet(event: FormEvent<HTMLFormElement>, outlet: AdminOutlet): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        apiPatch(`/platform/media/outlets/${outlet.id}`, {
          name: text(form, "name"),
          slug: text(form, "slug"),
          kind: text(form, "kind"),
          tagline: text(form, "tagline"),
          reachText: text(form, "reachText"),
          frequency: text(form, "frequency"),
          description: text(form, "description"),
          audience: text(form, "audience"),
          highlights: text(form, "highlights")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
          contactName: text(form, "contactName"),
          contactEmail: text(form, "contactEmail"),
          contactPhone: text(form, "contactPhone"),
          commissionPercent: Number(text(form, "commissionPercent")),
          active: form.get("active") === "on",
          sortOrder: Number(text(form, "sortOrder") || "0"),
        }),
      `✓ ${outlet.name} נשמרה`,
    );
  }

  function createProduct(event: FormEvent<HTMLFormElement>, outlet: AdminOutlet): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    void run(async () => {
      await apiPost(`/platform/media/outlets/${outlet.id}/products`, {
        name: text(form, "name"),
        kind: text(form, "kind"),
        specs: text(form, "specs"),
        priceAgorot: agorotOrNull(form, "price"),
        leadFeeAgorot: agorotOrNull(form, "leadFee"),
      });
      element.reset();
    }, "✓ המוצר נוסף");
  }

  function saveProduct(event: FormEvent<HTMLFormElement>, product: AdminProduct): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        apiPatch(`/platform/media/products/${product.id}`, {
          name: text(form, "name"),
          kind: text(form, "kind"),
          specs: text(form, "specs"),
          description: text(form, "description"),
          priceAgorot: agorotOrNull(form, "price"),
          leadFeeAgorot: agorotOrNull(form, "leadFee"),
          active: form.get("active") === "on",
          sortOrder: Number(text(form, "sortOrder") || "0"),
        }),
      `✓ ${product.name} נשמר`,
    );
  }

  return (
    <>
      <section
        className="mb-6 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        aria-labelledby="media-admin-heading"
      >
        <h2 id="media-admin-heading" className="mb-1 text-lg font-semibold">
          <IconGlobe s={16} /> רכש מדיה — הארכיון
        </h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          המדיות שהמשרדים רואים ב„רכש מדיה”, המוצרים שבכל אחת, ומי מקבל את ההזמנות. הזמנה
          בתשלום נסלקת במערכת והפלטפורמה גובה ממנה את אחוז העמלה שמוגדר על המדיה; הפניה
          נשלחת לנציג בלי תשלום, והוא משלם על ההפניה לפי ההסכם. מחירים בשקלים, נטו.
        </p>

        {message ? <Notice tone="success">{message}</Notice> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {loadFailed ? (
          <LoadError message="לא הצלחנו לטעון את ארכיון המדיות" onRetry={load} />
        ) : outlets === null ? (
          <p aria-live="polite">טוען…</p>
        ) : (
          <>
            {outlets.length === 0 ? (
              <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
                עדיין אין מדיות. הוסיפו את הראשונה למטה.
              </p>
            ) : null}
            <ul className="m-0 list-none p-0">
              {outlets.map((outlet) => (
                <li
                  key={outlet.id}
                  className="mb-3 rounded-xl border p-3"
                  style={{ borderColor: "var(--color-row-border)" }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="mv-btn-plain"
                      aria-expanded={open === outlet.id}
                      onClick={() => setOpen(open === outlet.id ? null : outlet.id)}
                    >
                      {open === outlet.id ? "לסגור" : "לעריכה"}
                    </button>
                    <span className="font-bold">{outlet.name}</span>
                    <code dir="ltr" className="rounded px-2 py-0.5 text-sm" style={{ background: "var(--color-bg)" }}>
                      /media/{outlet.slug}
                    </code>
                    <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {MEDIA_OUTLET_KIND_LABEL[outlet.kind]} · {outlet.products.length} מוצרים · עמלה{" "}
                      {outlet.commissionPercent}%
                      {outlet.active ? "" : " · מוסתרת"}
                    </span>
                    {outlet.contactEmail === "" ? (
                      <span className="mv-pill mv-domain-amber">בלי איש קשר — ההזמנות מגיעות רק אליכם</span>
                    ) : (
                      <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                        הזמנות אל {outlet.contactName || outlet.contactEmail}
                      </span>
                    )}
                  </div>

                  {open === outlet.id ? (
                    <>
                      <form onSubmit={(e) => saveOutlet(e, outlet)} className="mt-4 grid gap-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label>
                            <span className="mb-1 block text-sm font-medium">שם</span>
                            <input name="name" defaultValue={outlet.name} maxLength={120} required className={inputClass} style={inputStyle} />
                          </label>
                          <label>
                            <span className="mb-1 block text-sm font-medium">כתובת (slug)</span>
                            <input name="slug" dir="ltr" defaultValue={outlet.slug} maxLength={60} required pattern="[a-z0-9]+(-[a-z0-9]+)*" className={inputClass} style={inputStyle} />
                          </label>
                          <label>
                            <span className="mb-1 block text-sm font-medium">סוג</span>
                            <select name="kind" defaultValue={outlet.kind} className={inputClass} style={inputStyle}>
                              {MEDIA_OUTLET_KINDS.map((kind) => (
                                <option key={kind} value={kind}>{MEDIA_OUTLET_KIND_LABEL[kind]}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label>
                          <span className="mb-1 block text-sm font-medium">שורת תיאור</span>
                          <input name="tagline" defaultValue={outlet.tagline} maxLength={200} className={inputClass} style={inputStyle} />
                        </label>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label>
                            <span className="mb-1 block text-sm font-medium">חשיפה במספר אחד</span>
                            <input name="reachText" defaultValue={outlet.reachText} maxLength={200} placeholder="כ-40,000 עותקים בשבוע" className={inputClass} style={inputStyle} />
                          </label>
                          <label>
                            <span className="mb-1 block text-sm font-medium">תדירות</span>
                            <input name="frequency" defaultValue={outlet.frequency} maxLength={120} placeholder="שבועי — יום חמישי" className={inputClass} style={inputStyle} />
                          </label>
                        </div>
                        <label>
                          <span className="mb-1 block text-sm font-medium">על המדיה — מה היא ומה כלול</span>
                          <textarea name="description" defaultValue={outlet.description} rows={4} maxLength={4000} className={inputClass} style={inputStyle} />
                        </label>
                        <label>
                          <span className="mb-1 block text-sm font-medium">החשיפה — קהל, אזורים, תפוצה</span>
                          <textarea name="audience" defaultValue={outlet.audience} rows={3} maxLength={2000} className={inputClass} style={inputStyle} />
                        </label>
                        <label>
                          <span className="mb-1 block text-sm font-medium">נקודות „מה כלול” — שורה לכל נקודה</span>
                          <textarea name="highlights" defaultValue={outlet.highlights.join("\n")} rows={3} className={inputClass} style={inputStyle} />
                        </label>
                        <fieldset className="m-0 rounded-lg border p-3" style={{ borderColor: "var(--color-row-border)" }}>
                          <legend className="px-1 text-sm font-bold">מי מקבל את ההזמנות</legend>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label>
                              <span className="mb-1 block text-sm font-medium">איש קשר</span>
                              <input name="contactName" defaultValue={outlet.contactName} maxLength={120} className={inputClass} style={inputStyle} />
                            </label>
                            <label>
                              <span className="mb-1 block text-sm font-medium">דוא&quot;ל להזמנות</span>
                              <input name="contactEmail" type="email" dir="ltr" defaultValue={outlet.contactEmail} maxLength={254} className={inputClass} style={inputStyle} />
                            </label>
                            <label>
                              <span className="mb-1 block text-sm font-medium">טלפון</span>
                              <input name="contactPhone" type="tel" dir="ltr" defaultValue={outlet.contactPhone} maxLength={25} className={inputClass} style={inputStyle} />
                            </label>
                          </div>
                        </fieldset>
                        <div className="flex flex-wrap items-end gap-3">
                          <label style={{ width: "140px" }}>
                            <span className="mb-1 block text-sm font-medium">עמלת תיווך %</span>
                            <input name="commissionPercent" type="number" min={0} max={MAX_MEDIA_COMMISSION_PERCENT} step={1} defaultValue={outlet.commissionPercent} required className={inputClass} style={inputStyle} />
                          </label>
                          <label style={{ width: "110px" }}>
                            <span className="mb-1 block text-sm font-medium">סדר</span>
                            <input name="sortOrder" type="number" min={0} max={1000} step={1} defaultValue={outlet.sortOrder} className={inputClass} style={inputStyle} />
                          </label>
                          <label className="flex items-center gap-2 pb-2">
                            <input name="active" type="checkbox" defaultChecked={outlet.active} />
                            <span className="text-sm font-medium">מוצגת למשרדים</span>
                          </label>
                          <Button type="submit" disabled={busy}>שמירת המדיה</Button>
                        </div>
                      </form>

                      <h3 className="mb-2 mt-5 text-[length:var(--type-body)] font-bold">מוצרים</h3>
                      {outlet.products.length === 0 ? (
                        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                          עדיין אין מוצרים — בלי מוצר אין מה להזמין.
                        </p>
                      ) : null}
                      <ul className="m-0 list-none p-0">
                        {outlet.products.map((product) => (
                          <li key={product.id} className="mb-2 rounded-lg border p-3" style={{ borderColor: "var(--color-row-border)" }}>
                            <form onSubmit={(e) => saveProduct(e, product)} className="grid gap-2">
                              <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                                <label>
                                  <span className="mb-1 block text-sm font-medium">שם</span>
                                  <input name="name" defaultValue={product.name} maxLength={120} required className={inputClass} style={inputStyle} />
                                </label>
                                <label>
                                  <span className="mb-1 block text-sm font-medium">סוג</span>
                                  <select name="kind" defaultValue={product.kind} className={inputClass} style={inputStyle}>
                                    {MEDIA_PRODUCT_KINDS.map((kind) => (
                                      <option key={kind} value={kind}>{MEDIA_PRODUCT_KIND_LABEL[kind]}</option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  <span className="mb-1 block text-sm font-medium">מחיר ₪ נטו</span>
                                  <input name="price" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" defaultValue={shekelsValue(product.priceAgorot)} className={inputClass} style={inputStyle} />
                                </label>
                                <label>
                                  <span className="mb-1 block text-sm font-medium">תמורה על הפניה ₪</span>
                                  <input name="leadFee" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" defaultValue={shekelsValue(product.leadFeeAgorot)} className={inputClass} style={inputStyle} />
                                </label>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label>
                                  <span className="mb-1 block text-sm font-medium">מפרט</span>
                                  <input name="specs" defaultValue={product.specs} maxLength={200} placeholder="רבע עמוד, צבע מלא" className={inputClass} style={inputStyle} />
                                </label>
                                <label>
                                  <span className="mb-1 block text-sm font-medium">תיאור</span>
                                  <input name="description" defaultValue={product.description} maxLength={1000} className={inputClass} style={inputStyle} />
                                </label>
                              </div>
                              <div className="flex flex-wrap items-end gap-3">
                                <label style={{ width: "90px" }}>
                                  <span className="mb-1 block text-sm font-medium">סדר</span>
                                  <input name="sortOrder" type="number" min={0} max={1000} step={1} defaultValue={product.sortOrder} className={inputClass} style={inputStyle} />
                                </label>
                                <label className="flex items-center gap-2 pb-2">
                                  <input name="active" type="checkbox" defaultChecked={product.active} />
                                  <span className="text-sm font-medium">מוצג</span>
                                </label>
                                <Button type="submit" variant="secondary" disabled={busy}>שמירה</Button>
                                <button
                                  type="button"
                                  className="mv-btn-plain mv-btn-plain--danger ms-auto"
                                  disabled={busy}
                                  onClick={() => setDeleting(product)}
                                >
                                  <IconTrash s={14} /> מחיקה
                                </button>
                              </div>
                            </form>
                          </li>
                        ))}
                      </ul>

                      <form onSubmit={(e) => createProduct(e, outlet)} className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3" style={{ borderColor: "var(--color-row-border)" }}>
                        <label className="grow" style={{ minWidth: "160px" }}>
                          <span className="mb-1 block text-sm font-medium">מוצר חדש</span>
                          <input name="name" maxLength={120} required placeholder="מודעה רבע עמוד" className={inputClass} style={inputStyle} />
                        </label>
                        <label>
                          <span className="mb-1 block text-sm font-medium">סוג</span>
                          <select name="kind" defaultValue="paid" className={inputClass} style={inputStyle}>
                            {MEDIA_PRODUCT_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{MEDIA_PRODUCT_KIND_LABEL[kind]}</option>
                            ))}
                          </select>
                        </label>
                        <label style={{ width: "130px" }}>
                          <span className="mb-1 block text-sm font-medium">מחיר ₪ נטו</span>
                          <input name="price" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" className={inputClass} style={inputStyle} />
                        </label>
                        <label style={{ width: "130px" }}>
                          <span className="mb-1 block text-sm font-medium">תמורה על הפניה ₪</span>
                          <input name="leadFee" type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" className={inputClass} style={inputStyle} />
                        </label>
                        <label className="grow" style={{ minWidth: "140px" }}>
                          <span className="mb-1 block text-sm font-medium">מפרט</span>
                          <input name="specs" maxLength={200} className={inputClass} style={inputStyle} />
                        </label>
                        <Button type="submit" variant="secondary" disabled={busy}>
                          <IconPlus s={14} /> הוספת מוצר
                        </Button>
                      </form>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>

            <form onSubmit={createOutlet} className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3" style={{ borderColor: "var(--color-row-border)" }}>
              <label className="grow" style={{ minWidth: "160px" }}>
                <span className="mb-1 block text-sm font-medium">מדיה חדשה</span>
                <input name="name" maxLength={120} required placeholder="מגזין טאבו" className={inputClass} style={inputStyle} />
              </label>
              <label style={{ width: "180px" }}>
                <span className="mb-1 block text-sm font-medium">כתובת (slug)</span>
                <input name="slug" dir="ltr" maxLength={60} required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="tabu-magazine" className={inputClass} style={inputStyle} />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium">סוג</span>
                <select name="kind" defaultValue="magazine" className={inputClass} style={inputStyle}>
                  {MEDIA_OUTLET_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{MEDIA_OUTLET_KIND_LABEL[kind]}</option>
                  ))}
                </select>
              </label>
              <label style={{ width: "110px" }}>
                <span className="mb-1 block text-sm font-medium">עמלה %</span>
                <input name="commissionPercent" type="number" min={0} max={MAX_MEDIA_COMMISSION_PERCENT} step={1} defaultValue={10} className={inputClass} style={inputStyle} />
              </label>
              <Button type="submit" disabled={busy}>
                <IconPlus s={14} /> הוספת מדיה
              </Button>
            </form>
          </>
        )}
      </section>

      <section
        className="mb-6 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        aria-labelledby="media-orders-heading"
      >
        <h2 id="media-orders-heading" className="mb-1 text-lg font-semibold">
          <IconList s={16} /> הזמנות מדיה — כל המשרדים
        </h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}
        >
          מה הוזמן, האם נשלח לנציג, ומה העמלה שנרשמה. הזמנה בתשלום שלא נשלחה — הנציג לא קיבל
          מייל (אין כתובת, או שהשליחה נכשלה) ויש להעביר ידנית.
        </p>
        {loadFailed ? null : orders === null ? (
          <p aria-live="polite">טוען…</p>
        ) : orders.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>עדיין אין הזמנות.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start">
                  <th className="p-2 text-start">מתי</th>
                  <th className="p-2 text-start">משרד</th>
                  <th className="p-2 text-start">מה</th>
                  <th className="p-2 text-start">מצב</th>
                  <th className="p-2 text-start">סכום</th>
                  <th className="p-2 text-start">עמלה</th>
                  <th className="p-2 text-start">איש קשר</th>
                  <th className="p-2 text-start">נשלח לנציג</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t align-top" style={{ borderColor: "var(--color-row-border)" }}>
                    <td className="p-2 whitespace-nowrap">{formatDateTime(order.createdAt)}</td>
                    <td className="p-2">
                      {order.officeName}
                      {order.customerNo === null ? "" : ` (${order.customerNo})`}
                    </td>
                    <td className="p-2">
                      {order.outletName} — {order.productName}
                      {order.quantity > 1 ? ` ×${order.quantity}` : ""}
                      {order.brief ? (
                        <span className="block whitespace-pre-line" style={{ color: "var(--color-text-muted)" }}>
                          {order.brief}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2 whitespace-nowrap">{order.statusLabel}</td>
                    <td className="p-2 whitespace-nowrap">
                      {order.kind === "paid" ? formatPrice(order.amountAgorot) : "הפניה"}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {order.kind === "paid"
                        ? `${formatPrice(order.commissionAgorot)} (${order.commissionPercent}%)`
                        : "—"}
                    </td>
                    <td className="p-2">
                      {order.contactName}
                      <span className="block" dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                        {order.contactPhone}
                      </span>
                      <span className="block" dir="ltr" style={{ color: "var(--color-text-muted)" }}>
                        {order.contactEmail}
                      </span>
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {order.notifiedAt
                        ? formatDateTime(order.notifiedAt)
                        : order.status === "pending_payment" || order.status === "failed" || order.status === "cancelled"
                          ? "—"
                          : "לא נשלח"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title={deleting ? `למחוק את „${deleting.name}”?` : ""}
        tone="danger"
        confirmLabel="מחיקה"
        busy={busy}
        busyLabel="מוחקים…"
        onConfirm={() => {
          if (deleting === null) return;
          const product = deleting;
          void run(() => apiDelete(`/platform/media/products/${product.id}`), "✓ המוצר נמחק").then(() =>
            setDeleting(null),
          );
        }}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
      >
        <p className="m-0">
          מוצר שכבר הוזמן אי אפשר למחוק — רק להשבית. מוצר שלא הוזמן מעולם נמחק לצמיתות.
        </p>
      </ConfirmDialog>
    </>
  );
}
