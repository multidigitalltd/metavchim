"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
import { IconCard } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * תשלומים וזיכויים.
 *
 * עד כה הנתונים היו והמסך לא: תשלום שנגבה בטעות, או מנוי שבוטל
 * באמצע חודש, דרשו כניסה לממשק של קארדקום ואז רישום ידני כאן —
 * שני מקומות שהתחילו להיפרד זה מזה ברגע שמישהו שכח את השני.
 *
 * הזיכוי מוצג עם סכום ברירת מחדל מלא, ואפשר להקטין אותו: החזר יחסי
 * על חודש שלא נוצל הוא המקרה הנפוץ יותר מזיכוי מלא.
 */

interface PaymentRow {
  id: string;
  tenantId: string;
  tenantName: string;
  planCode: string;
  billingCycle: string;
  amountAgorot: number;
  status: string;
  transactionId: string | null;
  failureReason: string | null;
  paidAt: string | null;
  refundedAgorot: number | null;
  refundedAt: string | null;
  refundReason: string | null;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין",
  paid: "שולם",
  failed: "נכשל",
};

/*
 * סכומי התשלומים הם מה **שנגבה בפועל** — כולל מע"מ, בניגוד למחירון
 * שנקוב נטו. בלי הציון, מי שמשווה תשלום למחיר המסלול רואה פער של
 * 18% וחושב שמישהו חויב ביתר.
 */
function shekels(agorot: number): string {
  return `${formatNumber(Math.round(agorot / 100))} ₪ כולל מע"מ`;
}

export function PaymentsSection(): React.JSX.Element {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * „עדיין אין תשלומים” הוא משפט על הכסף של הפלטפורמה. אסור שתקלת
   * רשת תאמר אותו.
   */
  const [loadFailed, setLoadFailed] = useState(false);

  function load(): void {
    setLoadFailed(false);
    apiGet<PaymentRow[]>("/platform/payments")
      .then(setRows)
      .catch(() => setLoadFailed(true));
  }

  useEffect(load, []);

  function startRefund(row: PaymentRow): void {
    setOpen(row.id);
    // ברירת מחדל בשקלים שלמים — זה מה שמקלידים, והשרת מקבל אגורות
    setAmount(String(Math.round(row.amountAgorot / 100)));
    setReason("");
    setError(null);
    setMessage(null);
  }

  async function refund(row: PaymentRow): Promise<void> {
    const shekelAmount = Number(amount);
    if (!Number.isFinite(shekelAmount) || shekelAmount <= 0) {
      setError("סכום הזיכוי אינו תקין");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const agorot = Math.round(shekelAmount * 100);
      await apiPost(`/platform/payments/${row.id}/refund`, {
        // סכום מלא נשלח בלי amountAgorot — כך השרת יודע שזה זיכוי מלא
        ...(agorot < row.amountAgorot ? { amountAgorot: agorot } : {}),
        ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
      });
      setMessage(`✓ זוכה ${shekels(Math.round(shekelAmount * 100))} ל${row.tenantName}`);
      setOpen(null);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הזיכוי נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="payments-heading"
    >
      <h2 id="payments-heading" className="mb-1 text-lg font-semibold">
        <IconCard s={16} /> תשלומים וזיכויים
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        מאה התשלומים האחרונים. הזיכוי יוצא לקארדקום ונרשם על אותה שורה — לא כתשלום נוסף.
      </p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}
      {message ? (
        <Notice tone="success">{message}</Notice>
      ) : null}

      {loadFailed ? (
        <LoadError message="לא הצלחנו לטעון את התשלומים" onRetry={load} />
      ) : rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>עדיין אין תשלומים.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mv-table w-full">
            <thead>
              <tr>
                <th scope="col">משרד</th>
                <th scope="col">סכום</th>
                <th scope="col">מצב</th>
                <th scope="col">תאריך</th>
                <th scope="col">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.tenantName}
                    <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                      {row.planCode} · {row.billingCycle === "yearly" ? "שנתי" : "חודשי"}
                    </span>
                  </td>
                  <td>
                    {shekels(row.amountAgorot)}
                    {row.refundedAgorot !== null ? (
                      <span className="block text-sm" style={{ color: "var(--color-warning)" }}>
                        זוכה {shekels(row.refundedAgorot)}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {STATUS_LABELS[row.status] ?? row.status}
                    {row.failureReason ? (
                      <span className="block text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {row.failureReason}
                      </span>
                    ) : null}
                  </td>
                  <td>{formatDate(row.paidAt ?? row.createdAt)}</td>
                  <td>
                    {row.refundedAt !== null ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        זוכה ב-{formatDate(row.refundedAt)}
                      </span>
                    ) : row.status === "paid" && row.transactionId ? (
                      open === row.id ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            {/* זיכוי הוא של מה שנגבה, ולכן כולל מע"מ */}
                            <label htmlFor={`amt-${row.id}`} className="block text-sm">
                              סכום (₪, כולל מע&quot;מ)
                            </label>
                            <input
                              id={`amt-${row.id}`}
                              value={amount}
                              onChange={(event) => setAmount(event.target.value)}
                              inputMode="numeric"
                              className="w-24 rounded-lg border px-2 py-1"
                              style={{
                                borderColor: "var(--color-input-border)",
                                background: "var(--color-bg)",
                              }}
                            />
                          </div>
                          <div>
                            <label htmlFor={`why-${row.id}`} className="block text-sm">
                              סיבה
                            </label>
                            <input
                              id={`why-${row.id}`}
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              className="w-40 rounded-lg border px-2 py-1"
                              style={{
                                borderColor: "var(--color-input-border)",
                                background: "var(--color-bg)",
                              }}
                            />
                          </div>
                          <Button type="button" disabled={busy} onClick={() => void refund(row)}>
                            {busy ? "מזכה…" : "אשר זיכוי"}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setOpen(null)}>
                            ביטול
                          </Button>
                        </div>
                      ) : (
                        <Button type="button" variant="secondary" onClick={() => startRefund(row)}>
                          זיכוי
                        </Button>
                      )
                    ) : (
                      <span style={{ color: "var(--color-text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
