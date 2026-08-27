"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconDoc } from "../icons";
import { Notice } from "../notice";

/**
 * חשבוניות שדורשות עין.
 *
 * ## למה המסך הזה קיים
 *
 * המסמכים מופקים מעצמם, וזו בדיוק הסיבה שצריך מקום אחד שאומר מתי
 * זה **לא** קרה. שני מצבים שונים לגמרי מוצגים כאן, ולכל אחד פעולה
 * אחרת:
 *
 * - **חשבונית שנכשלה** — ביקשנו מלינט והיא סירבה. השגיאה שלה מוצגת
 *   כפי שהיא, כי היא זו שאומרת מה לתקן (קוד מסמך שגוי, לקוח בלי
 *   אימייל, מפתח שפג).
 * - **תשלום בלי חשבונית כלל** — התקלה השקטה יותר: לא הספק סירב,
 *   אלא הרישום עצמו לא נוצר. בלי המסך הזה אין שום דרך לראות אותה,
 *   והיא מתגלה בסוף השנה אצל רואה החשבון.
 *
 * המסך אינו מוצג כשאין מה להציג — רשימה ריקה קבועה היא רעש שמלמד
 * להתעלם ממנה.
 */

interface InvoiceRow {
  id: string;
  tenantId: string;
  tenantName: string;
  status: string;
  grossAgorot: number;
  description: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

interface OrphanPayment {
  id: string;
  tenantId: string;
  amountAgorot: number;
  paidAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתינה להפקה",
  issuing: "בהפקה",
  failed: "נכשלה",
};

export function InvoicesSection() {
  const [data, setData] = useState<{
    pending: InvoiceRow[];
    paymentsWithoutInvoice: OrphanPayment[];
  } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = useCallback(() => {
    apiGet<{ pending: InvoiceRow[]; paymentsWithoutInvoice: OrphanPayment[] }>("/platform/invoices")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  useEffect(load, [load]);

  async function retry(id: string): Promise<void> {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string }>(
        `/platform/invoices/${id}/retry`,
        {},
      );
      setNotice(
        res.ok
          ? { tone: "success", text: "החשבונית הופקה" }
          : { tone: "danger", text: res.error ?? "ההפקה נכשלה" },
      );
      load();
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "ההפקה נכשלה" });
    } finally {
      setBusyId(null);
    }
  }

  async function createFor(paymentId: string): Promise<void> {
    setBusyId(paymentId);
    setNotice(null);
    try {
      await apiPost(`/platform/payments/${paymentId}/invoice`, {});
      setNotice({ tone: "success", text: "נרשמה חשבונית — תופק בסבב הקרוב" });
      load();
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "הרישום נכשל" });
    } finally {
      setBusyId(null);
    }
  }

  if (data === null) return null;
  if (data.pending.length === 0 && data.paymentsWithoutInvoice.length === 0) return null;

  return (
    <section
      aria-labelledby="invoices-heading"
      id="invoices"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}
    >
      <h2 id="invoices-heading" className="mb-1 text-lg font-semibold">
        <IconDoc s={16} /> חשבוניות שממתינות לטיפול
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        כסף שנכנס ואין עליו מסמך. השורות כאן נוסו אוטומטית ולא הצליחו, או
        שלא נרשמו כלל.
      </p>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {data.pending.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {data.pending.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border p-3 text-sm"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <b>{row.tenantName}</b>
                <span>{(row.grossAgorot / 100).toLocaleString("he-IL")} ₪</span>
                <span style={{ color: "var(--color-text-muted)" }}>{row.description}</span>
                <span className="ms-auto">{STATUS_LABEL[row.status] ?? row.status}</span>
              </div>
              <p className="m-0 mt-1" style={{ color: "var(--color-text-muted)" }}>
                {formatDateTime(row.createdAt)} · {row.attempts} ניסיונות
              </p>
              {row.lastError ? (
                <p className="m-0 mt-1" style={{ color: "var(--color-danger)" }} dir="auto">
                  {row.lastError}
                </p>
              ) : null}
              <Button
                variant="ghost"
                className="mt-2"
                disabled={busyId === row.id}
                onClick={() => void retry(row.id)}
              >
                {busyId === row.id ? "מפיק…" : "הפק שוב"}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {data.paymentsWithoutInvoice.length > 0 ? (
        <>
          <h3 className="mb-2 text-sm font-bold">תשלומים בלי שורת חשבונית</h3>
          <ul className="flex flex-col gap-2">
            {data.paymentsWithoutInvoice.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              >
                <span dir="ltr" className="font-mono">
                  {row.id}
                </span>
                <span>{(row.amountAgorot / 100).toLocaleString("he-IL")} ₪</span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {row.paidAt ? formatDateTime(row.paidAt) : ""}
                </span>
                <Button
                  variant="ghost"
                  className="ms-auto"
                  disabled={busyId === row.id}
                  onClick={() => void createFor(row.id)}
                >
                  {busyId === row.id ? "רושם…" : "רשום חשבונית"}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
