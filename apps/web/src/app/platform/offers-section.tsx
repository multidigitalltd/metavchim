"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  MAX_OFFER_LINE_ITEMS,
  PLAN_FEATURES,
  effectiveCyclePriceAgorot,
  describeCycle,
  jerusalemWallIsoToUtc,
  type BillingCycle,
  type PlanDefinition,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDate, formatNumber } from "@/lib/format";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * הצעות מנוי בלינק — הסגירה של שיחת מכירה.
 *
 * שני סוגים, טופס אחד: **הצעה אישית** למשרד מסוים (מסלול + תוספות
 * כמו מספרי טלפון + מחיר סופי + תכונות מעבר למסלול, לינק חד-פעמי),
 * ו**לינק מכירה** לחבילה קיימת שכל משרד מחובר יכול לממש — מה שסוכן
 * שולח אחרי שיחה, והלקוח משלם ומפעיל מיד.
 *
 * הלינק מוצג פעם אחת בגדול אחרי היצירה, ותמיד זמין להעתקה מהרשימה.
 * מונה המימושים בשורה — זה המספר שבודקים אחרי ששולחים.
 */

interface OfferLineItemInput {
  label: string;
  /** בשקלים, כטקסט — מומר לאגורות רק בשליחה. */
  amount: string;
}

interface OfferRow {
  id: string;
  url: string;
  kind: string;
  tenantId: string | null;
  tenantName: string | null;
  planCode: string;
  planName: string;
  billingCycle: string;
  priceAgorot: number | null;
  amountAgorot: number | null;
  lineItems: { label: string; amountAgorot: number }[];
  featureGrants: string[];
  note: string;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const inputStyle = { borderColor: "var(--color-input-border)", background: "var(--color-field)" } as const;

/**
 * המשרדים שאפשר לתפור להם הצעה — **כולל המחיר המוסכם.**
 *
 * בלעדיו המסך מציע את מחיר המחירון בזמן שהשרת יגבה את המוסכם:
 * המפעיל רואה „ריק = מחיר המסלול” ויוצר הצעה שגובה אחרת, ולחיצה על
 * ההצעה כותבת את מחיר המחירון כמחיר סופי — כלומר דורסת בשקט את
 * המחיר שסוכם (ביקורת Codex).
 */
export interface OfferAgency {
  id: string;
  name: string;
  priceOverrideMonthlyAgorot: number | null;
  priceOverrideYearlyAgorot: number | null;
}

export function OffersSection({
  agencies,
}: {
  agencies: OfferAgency[];
}): React.JSX.Element {
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<OfferRow | null>(null);
  const { state: copyState, key: copyKey, copy } = useCopy();

  // "" = לינק מכירה פתוח; מזהה משרד = הצעה אישית
  const [tenantId, setTenantId] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [price, setPrice] = useState("");
  const [items, setItems] = useState<OfferLineItemInput[]>([]);
  const [grants, setGrants] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  function load(): void {
    setLoadFailed(false);
    apiGet<{ offers: OfferRow[] }>("/platform/offers")
      .then((res) => setOffers(res.offers))
      .catch(() => setLoadFailed(true));
  }

  useEffect(() => {
    load();
    apiGet<{ plans: PlanDefinition[] }>("/platform/plans")
      .then((res) => {
        setPlans(res.plans);
        setPlanCode((current) => current || (res.plans[0]?.code ?? ""));
      })
      .catch(() => undefined);
  }, []);

  const plan = plans.find((p) => p.code === planCode);
  /*
   * אותו חישוב שהשרת מריץ: המחיר המוסכם של משרד היעד קודם למחירון.
   * לינק מכירה אינו נעול למשרד ולכן אין לו מחיר מוסכם להחיל.
   */
  const targetAgency = agencies.find((a) => a.id === tenantId);
  const basePriceAgorot = plan
    ? effectiveCyclePriceAgorot(
        plan,
        cycle,
        targetAgency === undefined
          ? undefined
          : {
              monthlyAgorot: targetAgency.priceOverrideMonthlyAgorot,
              yearlyAgorot: targetAgency.priceOverrideYearlyAgorot,
            },
      )
    : null;

  /*
   * המחיר המוצע — בסיס + תוספות. הצעה בלבד: המחיר הסופי הוא שדה
   * שעורכים ("לשנות מחיר סופי"), והכפתור רק ממלא נקודת פתיחה.
   */
  const suggestedAgorot = useMemo(() => {
    const itemsTotal = items.reduce((sum, item) => {
      const shekels = Number(item.amount.trim() || "0");
      return Number.isFinite(shekels) && shekels > 0 ? sum + Math.round(shekels * 100) : sum;
    }, 0);
    return basePriceAgorot !== null && basePriceAgorot > 0 ? basePriceAgorot + itemsTotal : null;
  }, [basePriceAgorot, items]);

  function toggleGrant(code: string): void {
    setGrants((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const priceShekels = Number(price.trim());
      const lineItems = items
        .filter((item) => item.label.trim() !== "")
        .map((item) => {
          const shekels = Number(item.amount.trim() || "0");
          return {
            label: item.label.trim(),
            amountAgorot:
              Number.isFinite(shekels) && shekels > 0 ? Math.round(shekels * 100) : 0,
          };
        });
      const max = maxRedemptions.trim();
      const res = await apiPost<{ offer: OfferRow }>("/platform/offers", {
        ...(tenantId !== "" ? { tenantId } : {}),
        planCode,
        billingCycle: cycle,
        ...(price.trim() !== "" && Number.isFinite(priceShekels) && priceShekels > 0
          ? { priceAgorot: Math.round(priceShekels * 100) }
          : {}),
        lineItems,
        featureGrants: grants,
        note: note.trim(),
        ...(max !== "" ? { maxRedemptions: Number(max) } : {}),
        // סוף היום בישראל, כמו בתוקף קופון — "עד ה-31" כולל את ה-31
        ...(expiresAt !== ""
          ? { expiresAt: jerusalemWallIsoToUtc(`${expiresAt}T23:59:59.000`).toISOString() }
          : {}),
      });
      setCreated(res.offer);
      setItems([]);
      setPrice("");
      setNote("");
      setGrants([]);
      setMaxRedemptions("");
      setExpiresAt("");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת ההצעה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(offer: OfferRow): Promise<void> {
    if (!window.confirm(`לבטל את הלינק ל"${offer.planName}"? מי שיפתח אותו יראה שההצעה בוטלה.`)) {
      return;
    }
    try {
      await apiDelete(`/platform/offers/${offer.id}`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    }
  }

  function statusOf(offer: OfferRow): { label: string; muted: boolean } {
    if (offer.revokedAt !== null) return { label: "בוטל", muted: true };
    if (offer.expiresAt !== null && new Date(offer.expiresAt).getTime() <= Date.now()) {
      return { label: "פג תוקף", muted: true };
    }
    if (offer.maxRedemptions !== null && offer.redemptions >= offer.maxRedemptions) {
      return { label: "מומש", muted: true };
    }
    return { label: "פעיל", muted: false };
  }

  return (
    <section className="mv-list-card px-5 py-[17px]" aria-labelledby="offers-heading">
      <h2 id="offers-heading" className="m-0 mb-1" style={{ fontSize: "calc(16.5 / 16 * 1rem)", fontWeight: 800 }}>
        הצעות מנוי בלינק
      </h2>
      <p className="m-0 mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        לינק ייחודי שסוגר עסקה: הצעה אישית למשרד — מסלול, תוספות (מספרי טלפון וכד'), תכונות
        ומחיר סופי שיהפוך למחיר המנוי המתחדש; או לינק לחבילה קיימת שכל משרד מחובר יכול
        להפעיל בתשלום, מיד אחרי שיחת מכירה.
      </p>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {created ? (
        <div role="alert" className="mb-4 rounded-xl border p-4" style={{ borderColor: "var(--color-success)" }}>
          <p className="mb-1 font-semibold">✓ ההצעה נוצרה — שלחו ללקוח את הלינק:</p>
          <p className="mb-2 break-all">
            <a href={created.url} target="_blank" rel="noreferrer" dir="ltr" className="font-mono underline">
              {created.url}
            </a>
          </p>
          <button type="button" className="mv-btn-action" onClick={() => void copy(created.url, "created")}>
            העתקת הלינק
          </button>
          {copyKey === "created" && copyState === "copied" ? <span className="ms-2">✓ הועתק</span> : null}
          {copyKey === "created" && copyState === "failed" ? (
            <span className="ms-2">ההעתקה נכשלה — סמנו והעתיקו ידנית</span>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={(e) => void save(e)} className="mb-4">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="of-tenant" className="mb-1 block text-sm font-semibold">
              למי ההצעה
            </label>
            <select
              id="of-tenant"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="">כל משרד מחובר (לינק מכירה)</option>
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="of-plan" className="mb-1 block text-sm font-semibold">
              מסלול בסיס
            </label>
            <select
              id="of-plan"
              value={planCode}
              onChange={(e) => setPlanCode(e.target.value)}
              className="rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="of-cycle" className="mb-1 block text-sm font-semibold">
              מחזור חיוב
            </label>
            <select
              id="of-cycle"
              value={cycle}
              onChange={(e) => setCycle(e.target.value as BillingCycle)}
              className="rounded-lg border px-3 py-2.5"
              style={inputStyle}
            >
              <option value="monthly">חודשי</option>
              <option value="yearly">שנתי</option>
            </select>
          </div>
          <div>
            <label htmlFor="of-price" className="mb-1 block text-sm font-semibold">
              מחיר סופי (₪ ל{cycle === "yearly" ? "שנה" : "חודש"}, לפני מע&quot;מ)
            </label>
            <input
              id="of-price"
              type="number"
              min={0.01}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={basePriceAgorot !== null && basePriceAgorot > 0 ? `ריק = ${formatNumber(basePriceAgorot / 100)}` : "חובה למסלול זה"}
              className="w-40 rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {suggestedAgorot !== null ? (
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => setPrice(String(suggestedAgorot / 100))}
            >
              מלא מוצע: {formatNumber(suggestedAgorot / 100)} ₪ לפני מע&quot;מ (מסלול +
              תוספות)
            </button>
          ) : null}
        </div>

        {/* תוספות בשורות — "2 מספרי טלפון", "הטמעה" — מוצגות ללקוח בדף ההצעה */}
        <fieldset className="m-0 mb-2 border-0 p-0">
          <legend className="mb-1 block p-0 text-sm font-semibold">
            חיובים נוספים בהצעה (מוצגים ללקוח)
          </legend>
          {items.map((item, index) => (
            <div key={index} className="mb-1.5 flex flex-wrap items-center gap-2">
              <label className="mv-visually-hidden" htmlFor={`of-item-label-${index}`}>
                תיאור תוספת {index + 1}
              </label>
              <input
                id={`of-item-label-${index}`}
                value={item.label}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((it, i) => (i === index ? { ...it, label: e.target.value } : it)),
                  )
                }
                placeholder="למשל: 2 מספרי טלפון וירטואליים"
                maxLength={80}
                className="w-64 rounded-lg border px-3 py-2"
                style={inputStyle}
              />
              <label className="mv-visually-hidden" htmlFor={`of-item-amount-${index}`}>
                מחיר תוספת {index + 1} בשקלים, לפני מע&quot;מ
              </label>
              <input
                id={`of-item-amount-${index}`}
                type="number"
                min={0}
                step="0.01"
                value={item.amount}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((it, i) => (i === index ? { ...it, amount: e.target.value } : it)),
                  )
                }
                placeholder="₪ (0 = כלול)"
                className="w-32 rounded-lg border px-3 py-2"
                style={inputStyle}
              />
              <button
                type="button"
                className="mv-btn-plain"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
              >
                הסר
              </button>
            </div>
          ))}
          {items.length < MAX_OFFER_LINE_ITEMS ? (
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => setItems((prev) => [...prev, { label: "", amount: "" }])}
            >
              + הוספת תוספת
            </button>
          ) : null}
        </fieldset>

        {/* תכונות שנפתחות עם התשלום — מעבר למה שהמסלול כולל */}
        <fieldset className="m-0 mb-2 border-0 p-0">
          <legend className="mb-1 block p-0 text-sm font-semibold">
            תכונות שנפתחות עם התשלום
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {PLAN_FEATURES.map((feature) => {
              const inPlan = (plan?.features as readonly string[] | undefined)?.includes(feature.code) ?? false;
              return (
                <label key={feature.code} className="flex items-center gap-1.5 text-[length:var(--type-caption)]">
                  <input
                    type="checkbox"
                    checked={inPlan || grants.includes(feature.code)}
                    disabled={inPlan}
                    onChange={() => toggleGrant(feature.code)}
                  />
                  <span>
                    {feature.label}
                    {inPlan ? (
                      <span style={{ color: "var(--color-text-muted)" }}> (במסלול)</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1" style={{ minWidth: "220px" }}>
            <label htmlFor="of-note" className="mb-1 block text-sm font-semibold">
              הערה ללקוח (מוצגת בדף ההצעה)
            </label>
            <input
              id="of-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="למשל: כפי שסוכם בשיחה — כולל הקמה וליווי"
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="of-max" className="mb-1 block text-sm font-semibold">
              מגבלת מימושים
            </label>
            <input
              id="of-max"
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder={tenantId !== "" ? "1 (חד־פעמי)" : "ללא"}
              className="w-28 rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="of-exp" className="mb-1 block text-sm font-semibold">
              בתוקף עד
            </label>
            <input
              id="of-exp"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <button type="submit" className="mv-btn-action" disabled={busy || planCode === ""}>
            {busy ? "יוצר…" : "צור לינק"}
          </button>
        </div>
      </form>

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את ההצעות" onRetry={load} />
      ) : offers === null ? (
        <p aria-live="polite">טוען…</p>
      ) : offers.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>עדיין אין הצעות.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {offers.map((offer) => {
            const status = statusOf(offer);
            return (
              <li
                key={offer.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border p-2.5 text-[length:var(--type-caption-lg)]"
                style={{ borderColor: "var(--color-border)", opacity: status.muted ? 0.55 : 1 }}
              >
                <b>{offer.kind === "custom" ? (offer.tenantName ?? "הצעה אישית") : "לינק מכירה"}</b>
                <span>
                  {offer.planName} · {describeCycle(offer.billingCycle === "yearly" ? "yearly" : "monthly")}
                </span>
                {offer.amountAgorot !== null ? (
                  <span>{formatNumber(offer.amountAgorot / 100)} ₪ לפני מע&quot;מ</span>
                ) : null}
                {offer.lineItems.length > 0 ? (
                  <span style={{ color: "var(--color-text-muted)" }}>
                    {offer.lineItems.map((item) => item.label).join(" · ")}
                  </span>
                ) : null}
                <span style={{ color: "var(--color-text-muted)" }}>
                  מומש {offer.redemptions}
                  {offer.maxRedemptions !== null ? ` מתוך ${offer.maxRedemptions}` : ""}
                </span>
                {offer.expiresAt ? (
                  <span style={{ color: "var(--color-text-muted)" }}>עד {formatDate(offer.expiresAt)}</span>
                ) : null}
                <span>{status.label}</span>
                <span className="ms-auto flex items-center gap-2">
                  <button type="button" className="mv-btn-plain" onClick={() => void copy(offer.url, offer.id)}>
                    העתקת לינק
                  </button>
                  {copyKey === offer.id && copyState === "copied" ? <span>✓</span> : null}
                  {copyKey === offer.id && copyState === "failed" ? <span>נכשל</span> : null}
                  {offer.revokedAt === null ? (
                    <button type="button" className="mv-btn-plain" onClick={() => void revoke(offer)}>
                      בטל
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
