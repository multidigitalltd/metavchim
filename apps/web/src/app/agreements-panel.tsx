"use client";

import { useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";

/**
 * שליחת הסכם לחתימה ומעקב אחריו — מוצג בכרטיס הקונה (הזמנה בכתב)
 * ובכרטיס הנכס (בלעדיות מול בעל הנכס).
 *
 * המתווך משלים כאן את הפרטים שהמערכת לא יכולה לדעת — דמי התיווך,
 * מועד התשלום, ובבלעדיות גם התקופה. אלה פרטי חובה בהזמנה בכתב, ולכן
 * הם נשאלים לפני השליחה ולא נשארים ריקים במסמך.
 */

interface AgreementRow {
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  signedAt?: string;
  url: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "נשלח — ממתין לחתימה",
  viewed: "הלקוח פתח — טרם חתם",
  signed: "✓ נחתם",
  declined: "הלקוח דחה",
};

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

export function AgreementsPanel({
  contactId,
  kind,
  propertyId,
  title,
}: {
  contactId: string;
  kind: "brokerage" | "exclusivity";
  propertyId?: string;
  title: string;
}) {
  const [rows, setRows] = useState<AgreementRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [unfilled, setUnfilled] = useState<string[]>([]);
  const [fee, setFee] = useState("2% ממחיר העסקה");
  const [payment, setPayment] = useState("במועד חתימת חוזה מחייב");
  const [period, setPeriod] = useState("6 חודשים");

  function load(): void {
    apiGet<AgreementRow[]>(`/agreements/contact/${contactId}`)
      .then((all) => setRows(all.filter((row) => row.kind === kind)))
      .catch(() => setRows([]));
  }

  useEffect(load, [contactId, kind]);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const res = await apiPost<{ url: string; unfilled: string[]; reused: boolean }>(
        "/agreements",
        {
          kind,
          contactId,
          ...(propertyId !== undefined ? { propertyId } : {}),
          values: {
            דמי_תיווך: fee,
            מועד_תשלום: payment,
            ...(kind === "exclusivity" ? { תקופת_בלעדיות: period } : {}),
          },
        },
      );
      setLink(res.url);
      setUnfilled(res.unfilled);
      setOpen(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת ההסכם נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const signed = rows?.some((row) => row.status === "signed") ?? false;

  return (
    <section
      className="mb-6 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {signed ? (
          <span
            className="rounded-full px-3 py-1 text-sm font-medium"
            style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}
          >
            ✓ נחתם
          </span>
        ) : null}
      </div>

      {rows === null ? (
        <p aria-live="polite">טוען…</p>
      ) : rows.length === 0 ? (
        <p className="mb-3" style={{ color: "var(--color-text-muted)" }}>
          עדיין לא נשלח הסכם.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <span>{STATUS_LABELS[row.status] ?? row.status}</span>
              {row.status !== "signed" && row.status !== "declined" ? (
                <a href={row.url} target="_blank" rel="noopener noreferrer" className="underline">
                  קישור לחתימה
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {link ? (
        <div
          className="mb-3 rounded-lg border p-3"
          style={{ borderColor: "var(--color-success)" }}
        >
          <p className="mb-1 font-medium">ההסכם מוכן — שלחו ללקוח את הקישור:</p>
          <a href={link} target="_blank" rel="noopener noreferrer" className="underline" dir="ltr">
            {link}
          </a>
          {unfilled.length > 0 ? (
            <p className="mt-2 text-sm" style={{ color: "var(--color-danger)" }}>
              ⚠ פרטים שלא הושלמו במסמך: {unfilled.map((f) => f.replace(/_/gu, " ")).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor={`fee-${kind}`} className="mb-1 block font-medium">
              דמי תיווך
            </label>
            <input
              id={`fee-${kind}`}
              value={fee}
              onChange={(event) => setFee(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`pay-${kind}`} className="mb-1 block font-medium">
              מועד תשלום
            </label>
            <input
              id={`pay-${kind}`}
              value={payment}
              onChange={(event) => setPayment(event.target.value)}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          {kind === "exclusivity" ? (
            <div>
              <label htmlFor="period" className="mb-1 block font-medium">
                תקופת הבלעדיות
              </label>
              <input
                id="period"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                className="w-full rounded-lg border px-3 py-2.5"
                style={inputStyle}
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void send()}>
              {busy ? "מכין…" : "צור קישור לחתימה"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          ✍️ שלח הסכם לחתימה
        </Button>
      )}
    </section>
  );
}
