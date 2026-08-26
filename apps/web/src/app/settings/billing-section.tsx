"use client";

import { useEffect, useState } from "react";
import {
  describeCycle,
  CUSTOM_PRICE_LABEL,
  describeCyclePrice,
  describeSubscription,
  featureLabel,
  FREE_PRICE_LABEL,
  PRICE_TERMS_NOTE,
  yearlySavingPercent,
  type BillingCycle,
  type PlanDefinition,
  type SubscriptionStatus,
} from "@metavchim/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { can, useRequireAuth } from "@/lib/use-auth";
import { formatDate, formatNumber } from "@/lib/format";
import { Notice } from "../notice";

/**
 * המנוי — רכיב משותף למסך /settings/billing וללשונית "מנוי ותשלום"
 * בניהול המשרד. עותק שני היה נפרד ברגע שמשנים מחיר או ניסוח.
 *
 * מסך המנוי — מה יש למשרד עכשיו, ומה צריך כדי לעבור מסלול.
 *
 * המסך הזה קיים כי עד כה שדרוג מסלול היה שיחת טלפון. מתווך שנתקל
 * בחסימה בשבע בערב לא מתקשר — הוא מוותר, וזו בדיוק המכירה שאבדה.
 *
 * **פרטי הכרטיס אינם עוברים כאן.** הכפתור מפנה לדף של קארדקום,
 * והמערכת שלנו לא רואה מספר כרטיס בשום שלב.
 */

interface Subscription {
  planCode: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  cardLast4: string | null;
  cardExpiry: string | null;
  cancelledAt: string | null;
}

interface Overview {
  subscription: Subscription;
  plans: PlanDefinition[];
  checkoutAvailable: boolean;
}

interface PaymentRow {
  id: string;
  planCode: string;
  billingCycle: string;
  amountAgorot: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
}

const PAYMENT_STATUS: Record<string, string> = {
  pending: "ממתין",
  paid: "שולם",
  failed: "נכשל",
};

export function BillingSection({ expired = false }: { expired?: boolean }): React.JSX.Element | null {
  const { user, loading } = useRequireAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [cycle, setCycle] = useState<BillingCycle>("yearly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const mayManage = can(user, "billing.manage");

  useEffect(() => {
    if (loading) return;
    apiGet<Overview>("/billing")
      .then((res) => {
        setData(res);
        setCycle(res.subscription.billingCycle);
      })
      .catch(() => setLoadFailed(true));
  }, [loading]);

  useEffect(() => {
    if (loading || !mayManage) return;
    apiGet<PaymentRow[]>("/billing/payments")
      .then(setPayments)
      .catch(() => undefined);
  }, [loading, mayManage]);

  if (loading) return null;

  async function buy(planCode: string): Promise<void> {
    setBusy(planCode);
    setError(null);
    try {
      const res = await apiPost<{ url: string }>("/billing/checkout", { plan: planCode, cycle });
      // יציאה לדף של קארדקום. assign ולא replace: "אחורה" מדף התשלום
      // צריך להחזיר לכאן, לא לקפוץ מעל המסך הזה למה שהיה לפניו
      window.location.assign(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "פתיחת התשלום נכשלה");
      setBusy(null);
    }
  }

  /**
   * מעבר למסלול חינמי — בלי דף תשלום ובלי נציג (בקשת המשתמש: מסלול
   * השת"פ היה כתוב "פנו אלינו" בלי סיבה). השרת מאמת שהמסלול באמת
   * חינמי; מסלול בתשלום שנשלח לכאן נדחה שם.
   */
  async function switchFree(planCode: string): Promise<void> {
    setBusy(planCode);
    setError(null);
    try {
      await apiPost<{ ok: true }>("/billing/switch-free", { plan: planCode });
      const fresh = await apiGet<Overview>("/billing");
      setData(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "המעבר נכשל");
    } finally {
      setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    if (!window.confirm("לבטל את החידוש? השירות יישאר זמין עד סוף התקופה ששולמה.")) return;
    setBusy("cancel");
    setError(null);
    try {
      await apiPost<{ ok: true }>("/billing/cancel", {});
      const fresh = await apiGet<Overview>("/billing");
      setData(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "הביטול נכשל");
    } finally {
      setBusy(null);
    }
  }

  if (loadFailed) {
    return (
      <div>
        <h2 className="m-0 mb-3 text-lg font-bold">מנוי ותשלומים</h2>
        <Notice tone="danger">טעינת פרטי המנוי נכשלה. רעננו את העמוד או פנו אלינו.</Notice>
      </div>
    );
  }

  const sub = data?.subscription;
  const current = data?.plans.find((p) => p.code === sub?.planCode);

  return (
    <div>
      <h2 className="m-0 mb-1 text-lg font-bold">מנוי ותשלומים</h2>
      <p className="mb-5 text-sm" style={{ color: "var(--color-text-muted)" }}>
        פרטי האשראי מוקלדים בדף המאובטח של חברת הסליקה ואינם נשמרים במערכת.
      </p>

      {/*
        המשרד הופנה לכאן כי התקופה שלו נגמרה. ההסבר חייב להיות כאן
        ולא רק בשגיאה שנעלמה בדרך — אחרת הוא רואה מסך מנוי בלי לדעת
        למה נזרק אליו.
      */}
      {expired ? (
        <Notice tone="danger">התקופה הסתיימה. שאר המסכים ייפתחו מיד עם חידוש המנוי.</Notice>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {sub === undefined ? (
        <p aria-live="polite">טוען…</p>
      ) : (
        <>
          <section
            aria-labelledby="current-heading"
            className="mb-6 rounded-xl border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 id="current-heading" className="mb-2 text-lg font-semibold">
              המצב שלכם
            </h2>
            <p className="m-0 text-sm">
              <strong>{current?.name ?? sub.planCode}</strong> — {describeSubscription(sub.status, sub.daysLeft)}
            </p>
            {sub.currentPeriodEnd ? (
              <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                בתוקף עד {formatDate(sub.currentPeriodEnd)} · חיוב {describeCycle(sub.billingCycle)}
              </p>
            ) : null}
            {sub.cardLast4 ? (
              <p className="m-0 mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                כרטיס שמור לחידוש: •••• {sub.cardLast4}
                {sub.cardExpiry ? ` (${sub.cardExpiry})` : ""}
              </p>
            ) : null}

            {mayManage && sub.status === "active" ? (
              <button
                type="button"
                className="mv-btn-ghost mt-3"
                onClick={() => void cancel()}
                disabled={busy !== null}
              >
                {busy === "cancel" ? "מבטל…" : "ביטול חידוש"}
              </button>
            ) : null}
          </section>

          {!mayManage ? (
            <p className="mb-6 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}>
              רכישה ושינוי מסלול נעשים על ידי בעל/ת המשרד.
            </p>
          ) : data?.checkoutAvailable === false ? (
            <Notice tone="danger">התשלום המקוון טרם הופעל במערכת. פנו אלינו כדי להסדיר את המנוי.</Notice>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2" role="group" aria-label="מחזור חיוב">
                {(["monthly", "yearly"] as BillingCycle[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={cycle === option}
                    onClick={() => setCycle(option)}
                    className="rounded-lg border px-3 py-1.5 text-sm"
                    style={
                      cycle === option
                        ? { borderColor: "var(--color-primary)", background: "var(--color-primary-soft)", color: "var(--color-primary)" }
                        : { borderColor: "var(--color-input-border)" }
                    }
                  >
                    חיוב {describeCycle(option)}
                  </button>
                ))}
              </div>

              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                {(data?.plans ?? []).map((plan) => {
                  const price = describeCyclePrice(plan, cycle);
                  /*
                   * שלושה מצבים שנראו פעם כמצב אחד — „אין מחיר במחזור
                   * הזה” — והוצגו כולם כ„לפי הצעה”:
                   *
                   * 1. מסלול שנסגר בשיחה. „לפי הצעה” נכון לו.
                   * 2. מסלול **חינמי**. „לפי הצעה” הזמין את הלקוח לשיחה
                   *    על מחיר שאינו קיים.
                   * 3. מסלול שנמכר במחזור השני בלבד.
                   *
                   * `describeCyclePrice` מחזיר `null` בשלושתם — וזה נכון
                   * מצדו, כי אין מה לגבות. ההבחנה היא של המסך.
                   */
                  const free =
                    !plan.priceOnRequest &&
                    plan.monthlyPriceAgorot === 0 &&
                    (plan.yearlyPriceAgorot ?? 0) === 0;
                  const saving = cycle === "yearly" ? yearlySavingPercent(plan) : null;
                  const isCurrent = plan.code === sub.planCode && sub.status === "active";
                  return (
                    <section
                      key={plan.code}
                      aria-labelledby={`plan-${plan.code}`}
                      className="rounded-xl border p-4"
                      style={{
                        borderColor: isCurrent ? "var(--color-primary)" : "var(--color-border)",
                        background: "var(--color-surface)",
                      }}
                    >
                      <h3 id={`plan-${plan.code}`} className="m-0 text-base font-bold">
                        {plan.name}
                      </h3>
                      <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {plan.description}
                      </p>
                      <p className="m-0 mb-1 text-lg font-bold">
                        {price ?? (free ? FREE_PRICE_LABEL : CUSTOM_PRICE_LABEL)}
                      </p>
                      {saving !== null ? (
                        <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-primary)" }}>
                          חיסכון של {saving}% מול חיוב חודשי
                        </p>
                      ) : null}
                      <ul className="m-0 mb-3 list-none p-0 text-sm">
                        {plan.features.map((code) => (
                          <li key={code}>✓ {featureLabel(code)}</li>
                        ))}
                      </ul>
                      {/*
                        מסלול בלי מחיר במחזור הנבחר לא מקבל כפתור: לחיצה
                        עליו הייתה מוחזרת מהשרת בשגיאה ממילא. מה שכן
                        משתנה הוא ההסבר — „נמכר בחיוב שנתי בלבד” על
                        מסלול חינמי או על מסלול שנסגר בשיחה הוא הסבר
                        שגוי, ולא רק חסר.
                      */}
                      {/* מסלול חינמי נבחר בלחיצה — בלי דף תשלום ובלי נציג */}
                      {free ? (
                        isCurrent ? (
                          <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                            זה המסלול הנוכחי שלכם
                          </p>
                        ) : (
                          <button
                            type="button"
                            className="mv-btn-primary w-full"
                            onClick={() => void switchFree(plan.code)}
                            disabled={busy !== null}
                          >
                            {busy === plan.code ? "עובר…" : "מעבר למסלול זה — חינם"}
                          </button>
                        )
                      ) : price === null ? (
                        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                          {plan.priceOnRequest
                            ? "המחיר נסגר בשיחה — פנו אלינו"
                            : `נמכר בחיוב ${describeCycle(cycle === "yearly" ? "monthly" : "yearly")} בלבד`}
                        </p>
                      ) : (
                        <button
                          type="button"
                          className="mv-btn-primary w-full"
                          onClick={() => void buy(plan.code)}
                          disabled={busy !== null}
                        >
                          {busy === plan.code
                            ? "פותח תשלום…"
                            : isCurrent
                              ? "חידוש המסלול"
                              : "מעבר למסלול זה"}
                        </button>
                      )}
                    </section>
                  );
                })}
              </div>
              {/*
                הסייג מתחת לכרטיסי המסלולים ולא בתוך כל אחד מהם: הוא
                חל על כולם, וחזרה שלו בכל כרטיס הייתה רעש שמפסיקים
                לקרוא בדיוק בגלל שהוא חוזר.
              */}
              <p className="mt-3 mb-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {PRICE_TERMS_NOTE}
              </p>
            </>
          )}

          {mayManage && payments.length > 0 ? (
            <section aria-labelledby="payments-heading" className="mt-8">
              <h2 id="payments-heading" className="mb-2 text-lg font-semibold">
                היסטוריית תשלומים
              </h2>
              <table className="mv-table w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col">תאריך</th>
                    <th scope="col">מסלול</th>
                    <th scope="col">סכום</th>
                    <th scope="col">מצב</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.paidAt ?? row.createdAt)}</td>
                      <td>
                        {row.planCode} · {describeCycle(row.billingCycle === "yearly" ? "yearly" : "monthly")}
                      </td>
                      <td>{formatNumber(row.amountAgorot / 100)} ₪</td>
                      <td>{PAYMENT_STATUS[row.status] ?? row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

