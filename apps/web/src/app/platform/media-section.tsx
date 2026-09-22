"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import {
  MAX_MEDIA_COMMISSION_PERCENT,
  MEDIA_OUTLET_KINDS,
  MEDIA_OUTLET_KIND_LABEL,
  MEDIA_IMAGES_MAX,
  MEDIA_IMAGE_KINDS,
  MEDIA_PRODUCT_KINDS,
  MEDIA_PRODUCT_KIND_LABEL,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  type MediaImageKind,
  type MediaOrderStatus,
  type MediaOutletKind,
  type MediaProductKind,
} from "@metavchim/shared";
import { API_BASE, apiDelete, apiGet, apiList, apiPatch, apiPost, ApiError, mediaSrc } from "@/lib/api";
import { formatDateTime, formatPrice, shekelsToAgorot } from "@/lib/format";
import { ConfirmDialog } from "../confirm-dialog";
import { IconBanknote, IconGlobe, IconList, IconPlus, IconTrash } from "../icons";
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

interface AdminImage {
  id: string;
  kind: MediaImageKind;
  caption: string;
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
  closingText: string;
  nextClosingAt: string | null;
  active: boolean;
  sortOrder: number;
  products: AdminProduct[];
  images: AdminImage[];
  owedAgorot: number;
  owedOrders: number;
}

interface AdminTotals {
  paidOrders: number;
  paidAgorot: number;
  commissionAgorot: number;
  owedAgorot: number;
  referrals: number;
  referralFeesAgorot: number;
}

interface AdminSettlement {
  id: string;
  outletId: string;
  outletName: string;
  amountAgorot: number;
  orderCount: number;
  reference: string;
  note: string;
  createdAt: string;
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
  leadFeeAgorot: number | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  brief: string;
  notifiedAt: string | null;
  paidAt: string | null;
  settlementId: string | null;
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

const IMAGE_KIND_LABEL: Record<MediaImageKind, string> = { cover: "שער / לוגו", sample: "דוגמת מודעה" };

/**
 * ‏שעת קיר ישראלית משני שדות ⟵ ISO ב-UTC; ריק ⟵ null (אין מועד).
 * ‏אותה המרה כמו בתאריכי הניסיון של המשרדים — המסך מציג ועורך
 * ‏בשעון ירושלים, השרת שומר UTC.
 */
function closingIso(form: FormData): string | null {
  const date = text(form, "closingDate");
  if (date === "") return null;
  const time = text(form, "closingTime") || "12:00";
  return jerusalemWallIsoToUtc(`${date}T${time}:00.000`).toISOString();
}

export function MediaSection(): React.JSX.Element {
  const [outlets, setOutlets] = useState<AdminOutlet[] | null>(null);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [totals, setTotals] = useState<AdminTotals | null>(null);
  const [settlements, setSettlements] = useState<AdminSettlement[] | null>(null);
  const [settling, setSettling] = useState<AdminOutlet | null>(null);
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
      apiGet<{ orders: AdminOrder[]; totals: AdminTotals }>("/platform/media/orders").then((res) => {
        setOrders(apiList(res.orders, "orders"));
        setTotals(res.totals);
      }),
      apiGet<{ settlements: AdminSettlement[] }>("/platform/media/settlements").then((res) =>
        setSettlements(apiList(res.settlements, "settlements")),
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
          closingText: text(form, "closingText"),
          nextClosingAt: closingIso(form),
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

  function uploadImage(event: FormEvent<HTMLFormElement>, outlet: AdminOutlet): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("בחרו קובץ תמונה");
      return;
    }
    void run(async () => {
      const body = new FormData();
      body.append("file", file);
      body.append("kind", text(form, "kind") || "sample");
      const caption = text(form, "caption");
      if (caption !== "") body.append("caption", caption);
      // multipart — בלי Content-Type ידני; הדפדפן קובע את ה-boundary
      const res = await fetch(`${API_BASE}/platform/media/outlets/${outlet.id}/images`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, payload?.message ?? "ההעלאה נכשלה");
      }
      element.reset();
    }, "✓ התמונה הועלתה");
  }

  function saveImage(event: FormEvent<HTMLFormElement>, image: AdminImage): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        apiPatch(`/platform/media/images/${image.id}`, {
          caption: text(form, "caption"),
          sortOrder: Number(text(form, "sortOrder") || "0"),
        }),
      "✓ הכיתוב נשמר",
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
                    {outlet.owedOrders > 0 ? (
                      <button type="button" className="mv-btn-soft" onClick={() => setSettling(outlet)}>
                        לתשלום למדיה: {formatPrice(outlet.owedAgorot)} ({outlet.owedOrders} הזמנות)
                      </button>
                    ) : null}
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
                        <fieldset className="m-0 rounded-lg border p-3" style={{ borderColor: "var(--color-row-border)" }}>
                          <legend className="px-1 text-sm font-bold">סגירת גיליון</legend>
                          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                            <label>
                              <span className="mb-1 block text-sm font-medium">הכלל במילים</span>
                              <input name="closingText" defaultValue={outlet.closingText} maxLength={200} placeholder="יום שני 12:00 לגיליון של אותו שבוע" className={inputClass} style={inputStyle} />
                            </label>
                            <label>
                              <span className="mb-1 block text-sm font-medium">המועד הקרוב — תאריך</span>
                              <input name="closingDate" type="date" dir="ltr" defaultValue={outlet.nextClosingAt ? jerusalemWallParts(new Date(outlet.nextClosingAt)).date : ""} className={inputClass} style={inputStyle} />
                            </label>
                            <label>
                              <span className="mb-1 block text-sm font-medium">שעה (ישראל)</span>
                              <input name="closingTime" type="time" dir="ltr" defaultValue={outlet.nextClosingAt ? jerusalemWallParts(new Date(outlet.nextClosingAt)).time : "12:00"} className={inputClass} style={inputStyle} />
                            </label>
                          </div>
                          <p className="m-0 mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                            יממה לפני המועד נשלחת תזכורת למשרדים שיש להם הזמנה שממתינה לתשלום. אחרי
                            הסגירה מעדכנים כאן את הגיליון הבא; תאריך ריק = בלי מועד ובלי תזכורת.
                          </p>
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

                      <h3 className="mb-2 mt-5 text-[length:var(--type-body)] font-bold">תמונות</h3>
                      <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        שער אחד (מוצג בכרטיס ובראש העמוד) ועד {MEDIA_IMAGES_MAX} דוגמאות מודעה. JPEG, PNG או WebP עד
                        10MB; התמונה מכווצת ונשמרת בלי נתוני EXIF. העלאת שער חדש מחליפה את הקודם.
                      </p>
                      {outlet.images.length > 0 ? (
                        <ul className="m-0 mb-3 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
                          {outlet.images.map((image) => (
                            <li key={image.id} className="m-0 rounded-lg border p-2" style={{ borderColor: "var(--color-row-border)" }}>
                              <img
                                src={mediaSrc(`media/${outlet.slug}/images/${image.id}`)}
                                alt={image.caption || IMAGE_KIND_LABEL[image.kind]}
                                className="mb-2 aspect-[4/3] w-full rounded object-cover"
                                loading="lazy"
                              />
                              <span className={`mv-pill ${image.kind === "cover" ? "mv-domain-blue" : "mv-domain-neutral"}`}>
                                {IMAGE_KIND_LABEL[image.kind]}
                              </span>
                              <form onSubmit={(e) => saveImage(e, image)} className="mt-2 grid gap-2">
                                <input name="caption" defaultValue={image.caption} maxLength={200} placeholder="כיתוב" aria-label="כיתוב" className={inputClass} style={inputStyle} />
                                <div className="flex items-end gap-2">
                                  <label style={{ width: "80px" }}>
                                    <span className="mb-1 block text-sm font-medium">סדר</span>
                                    <input name="sortOrder" type="number" min={0} max={1000} step={1} defaultValue={image.sortOrder} className={inputClass} style={inputStyle} />
                                  </label>
                                  <Button type="submit" variant="secondary" disabled={busy}>שמירה</Button>
                                  <button
                                    type="button"
                                    className="mv-btn-plain mv-btn-plain--danger ms-auto"
                                    disabled={busy}
                                    aria-label="מחיקת התמונה"
                                    title="מחיקת התמונה"
                                    onClick={() => void run(() => apiDelete(`/platform/media/images/${image.id}`), "✓ התמונה נמחקה")}
                                  >
                                    <IconTrash s={14} />
                                  </button>
                                </div>
                              </form>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <form onSubmit={(e) => uploadImage(e, outlet)} className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3" style={{ borderColor: "var(--color-row-border)" }}>
                        <label className="grow" style={{ minWidth: "200px" }}>
                          <span className="mb-1 block text-sm font-medium">תמונה חדשה</span>
                          <input name="file" type="file" accept="image/jpeg,image/png,image/webp" required className={inputClass} style={inputStyle} />
                        </label>
                        <label>
                          <span className="mb-1 block text-sm font-medium">סוג</span>
                          <select name="kind" defaultValue="sample" className={inputClass} style={inputStyle}>
                            {MEDIA_IMAGE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{IMAGE_KIND_LABEL[kind]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="grow" style={{ minWidth: "160px" }}>
                          <span className="mb-1 block text-sm font-medium">כיתוב</span>
                          <input name="caption" maxLength={200} className={inputClass} style={inputStyle} />
                        </label>
                        <Button type="submit" variant="secondary" disabled={busy}>
                          <IconPlus s={14} /> העלאה
                        </Button>
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
        {totals !== null && (totals.paidOrders > 0 || totals.referrals > 0) ? (
          <dl className="m-0 mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["שולם במערכת", `${formatPrice(totals.paidAgorot)} · ${totals.paidOrders} הזמנות`],
              ["עמלות הפלטפורמה", formatPrice(totals.commissionAgorot)],
              ["טרם הועבר למדיות", formatPrice(totals.owedAgorot)],
              ["הפניות", `${totals.referrals} · תמורה ${formatPrice(totals.referralFeesAgorot)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl px-4 py-3" style={{ background: "var(--color-bg)" }}>
                <dt className="m-0 text-sm font-bold" style={{ color: "var(--color-text-muted)" }}>{label}</dt>
                <dd className="m-0 mt-1 font-extrabold">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
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
                  <th className="p-2 text-start">עמלה / תמורה על הפניה</th>
                  <th className="p-2 text-start">איש קשר</th>
                  <th className="p-2 text-start">נשלח לנציג</th>
                  <th className="p-2 text-start">הועבר למדיה</th>
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
                        : order.leadFeeAgorot === null
                          ? "—"
                          : `הפניה: ${formatPrice(order.leadFeeAgorot)}`}
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
                      {order.status === "paid" || order.status === "referred" ? (
                        <button
                          type="button"
                          className="mv-btn-plain ms-2"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => apiPost(`/platform/media/orders/${order.id}/notify`, {}),
                              order.notifiedAt ? "✓ נשלח שוב למי שטרם קיבל" : "✓ נשלח לנציג",
                            )
                          }
                        >
                          {order.notifiedAt ? "שליחה חוזרת" : "שליחה לנציג"}
                        </button>
                      ) : null}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      {order.kind !== "paid" || order.status !== "paid" ? "—" : order.settlementId ? "הועבר" : "ממתין"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        className="mb-6 rounded-xl border p-4"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        aria-labelledby="media-settlements-heading"
      >
        <h2 id="media-settlements-heading" className="mb-1 text-lg font-semibold">
          <IconBanknote s={16} /> העברות למדיה
        </h2>
        <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          רישום של מה שהועבר למדיה — לא העברה בנקאית. כל מדיה עם הזמנות ששולמו וטרם הועברו
          מציגה למעלה כפתור „לתשלום למדיה” עם היתרה (הסכום פחות העמלה); לוחצים, מקלידים אסמכתה,
          וההזמנות מסומנות כהועברו.
        </p>
        {loadFailed ? null : settlements === null ? (
          <p aria-live="polite">טוען…</p>
        ) : settlements.length === 0 ? (
          <p style={{ color: "var(--color-text-muted)" }}>עדיין לא נרשמו העברות.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {settlements.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t py-2 text-sm" style={{ borderColor: "var(--color-row-border)" }}>
                <span className="whitespace-nowrap">{formatDateTime(s.createdAt)}</span>
                <span className="font-bold">{s.outletName}</span>
                <span>{formatPrice(s.amountAgorot)} · {s.orderCount} הזמנות</span>
                {s.reference ? <span dir="ltr">{s.reference}</span> : null}
                {s.note ? <span style={{ color: "var(--color-text-muted)" }}>{s.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={settling !== null}
        title={settling ? `רישום העברה — ${settling.name}` : ""}
        confirmLabel="רישום ההעברה"
        busy={busy}
        busyLabel="רושמים…"
        onConfirm={() => {
          if (settling === null) return;
          const outlet = settling;
          const reference = (document.getElementById("settle-reference") as HTMLInputElement | null)?.value ?? "";
          const note = (document.getElementById("settle-note") as HTMLTextAreaElement | null)?.value ?? "";
          void run(
            () => apiPost(`/platform/media/outlets/${outlet.id}/settlements`, { reference: reference.trim(), note: note.trim() }),
            `✓ נרשמה העברה ל${outlet.name}`,
          ).then(() => setSettling(null));
        }}
        onClose={() => {
          if (!busy) setSettling(null);
        }}
      >
        {settling ? (
          <>
            <p className="m-0 mb-3">
              כל ההזמנות ששולמו וטרם הועברו — {settling.owedOrders} הזמנות, {formatPrice(settling.owedAgorot)} (אחרי
              העמלה) — יסומנו כהועברו. הסכום מחושב בשרת מההזמנות עצמן.
            </p>
            <div className="grid gap-3">
              <label>
                <span className="mb-1 block text-sm font-bold">אסמכתה</span>
                <input id="settle-reference" className="mv-field" dir="ltr" maxLength={120} placeholder="מספר העברה / תאריך" />
              </label>
              <label>
                <span className="mb-1 block text-sm font-bold">הערה</span>
                <textarea id="settle-note" className="mv-field" rows={2} maxLength={500} />
              </label>
            </div>
          </>
        ) : null}
      </ConfirmDialog>

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
