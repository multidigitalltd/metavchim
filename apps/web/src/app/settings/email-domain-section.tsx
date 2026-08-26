"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@metavchim/ui";
import {
  emailDomainRejectionReason,
  normalizeEmailDomain,
  senderAddressRejectionReason,
  senderNameRejectionReason,
} from "@metavchim/shared";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useCopy } from "@/lib/clipboard";
import { formatDateTime } from "@/lib/format";
import { IconMail } from "../icons";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * שליחת אימייל מהדומיין של המשרד.
 *
 * שלושה צעדים שהמנהל עובר: מקלידים דומיין וכתובת שולח → מעתיקים
 * שתי רשומות DNS אל ספק הדומיין (הרשם שבו נקנה הדומיין) → לוחצים
 * "בדקו אימות". מרגע ששתי הרשומות מאומתות, מיילים ללקוחות המשרד
 * (הסכם לחתימה) יוצאים מהכתובת של המשרד ולא מכתובת הפלטפורמה.
 *
 * הרשומות הן הדבר החשוב במסך אחרי החיבור — טבלה עם כפתור העתקה
 * לכל ערך, כמו כתובת ה-Webhook במסך המרכזייה: מה שמעתיקים חייב
 * להיות בולט, לא הערת שוליים.
 */

interface DnsRecord {
  purpose: "dkim" | "return_path";
  type: "TXT" | "CNAME";
  host: string;
  value: string;
  verified: boolean;
}

interface Status {
  available: boolean;
  connected: boolean;
  domain?: string;
  status?: "verified" | "pending";
  records?: DnsRecord[];
  fromEmail?: string;
  fromName?: string;
  verifiedAt?: string | null;
  lastCheckedAt?: string | null;
}

const RECORD_LABELS: Record<DnsRecord["purpose"], string> = {
  dkim: "חתימת DKIM",
  return_path: "כתובת חזרה (Return-Path)",
};

export function EmailDomainSection(): React.JSX.Element {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSender, setEditingSender] = useState(false);
  const clipboard = useCopy();

  const load = useCallback(() => {
    apiGet<Status>("/settings/email-domain")
      .then((s) => {
        setStatus(s);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(load, [load]);

  async function connect(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const f = new FormData(event.currentTarget);
    const domain = normalizeEmailDomain(String(f.get("domain")));
    const fromEmail = String(f.get("fromEmail")).trim().toLowerCase();
    const fromName = String(f.get("fromName")).trim();
    /* אותה בדיקה שהשרת מריץ — הודעה מיידית בלי סיבוב רשת */
    const reason =
      emailDomainRejectionReason(domain) ??
      senderAddressRejectionReason(fromEmail, domain) ??
      senderNameRejectionReason(fromName);
    if (reason !== null) {
      setError(reason);
      return;
    }
    setBusy(true);
    try {
      const next = await apiPost<Status>("/settings/email-domain", {
        domain,
        fromEmail,
        fromName,
      });
      setStatus(next);
      setMessage("✓ הדומיין נרשם — הוסיפו את שתי הרשומות אצל ספק הדומיין ולחצו \"בדקו אימות\"");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החיבור נכשל — נסו שוב");
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await apiPost<Status>("/settings/email-domain/verify", {});
      setStatus(next);
      setMessage(
        next.status === "verified"
          ? "✓ הדומיין אומת — מיילים ללקוחות יוצאים מהכתובת של המשרד"
          : "רשומה אחת או יותר עדיין לא נמצאה. עדכון DNS יכול לקחת עד 48 שעות — נסו שוב מאוחר יותר",
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הבדיקה נכשלה — נסו שוב");
    } finally {
      setBusy(false);
    }
  }

  async function saveSender(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const f = new FormData(event.currentTarget);
    const fromEmail = String(f.get("fromEmail")).trim().toLowerCase();
    const fromName = String(f.get("fromName")).trim();
    const reason =
      senderAddressRejectionReason(fromEmail, status?.domain ?? "") ??
      senderNameRejectionReason(fromName);
    if (reason !== null) {
      setError(reason);
      return;
    }
    setBusy(true);
    try {
      const next = await apiPatch<Status>("/settings/email-domain", { fromEmail, fromName });
      setStatus(next);
      setEditingSender(false);
      setMessage("✓ כתובת השולח עודכנה");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const to = String(new FormData(event.currentTarget).get("to")).trim();
    setBusy(true);
    try {
      const res = await apiPost<{ sentTo: string }>("/settings/email-domain/test", { to });
      setMessage(`✓ מייל בדיקה נשלח אל ${res.sentTo} — בדקו את שורת "מאת"`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm("לנתק את הדומיין? מיילים ללקוחות יחזרו להישלח מכתובת המערכת.")) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiDelete("/settings/email-domain");
      setMessage("הדומיין נותק");
      setEditingSender(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (status === null && !loadFailed) return <p aria-live="polite">טוען…</p>;

  return (
    <section
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="email-domain-heading"
    >
      <h2 id="email-domain-heading" className="mb-1 text-lg font-semibold">
        <IconMail s={16} /> שליחת אימייל מהדומיין של המשרד
      </h2>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        חברו את הדומיין של המשרד כדי שמיילים ללקוחות — כמו הסכם לחתימה — יישלחו
        מהכתובת שלכם (למשל info@המשרד־שלכם) במקום מכתובת המערכת. החיבור דורש
        הוספת שתי רשומות DNS אצל ספק הדומיין, פעם אחת בלבד.
      </p>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loadFailed ? (
        <LoadError onRetry={load} />
      ) : !status?.available ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          חיבור דומיין טרם הופעל בפלטפורמה — פנו לתמיכה.
        </p>
      ) : !status.connected ? (
        <form onSubmit={(e) => void connect(e)} className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="email-domain-input" className="mb-1 block font-medium">
              הדומיין של המשרד
            </label>
            <input
              id="email-domain-input"
              name="domain"
              type="text"
              dir="ltr"
              required
              placeholder="office.co.il"
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)" }}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "200px" }}>
            <label htmlFor="email-domain-from" className="mb-1 block font-medium">
              כתובת השולח
            </label>
            <input
              id="email-domain-from"
              name="fromEmail"
              type="email"
              dir="ltr"
              required
              placeholder="info@office.co.il"
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)" }}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "180px" }}>
            <label htmlFor="email-domain-name" className="mb-1 block font-medium">
              שם השולח (מה שהלקוח רואה)
            </label>
            <input
              id="email-domain-name"
              name="fromName"
              type="text"
              required
              maxLength={80}
              placeholder="שם המשרד"
              className="w-full rounded-lg border px-3 py-2.5"
              style={{ borderColor: "var(--color-border)" }}
            />
          </div>
          <Button type="submit" disabled={busy}>
            חברו דומיין
          </Button>
        </form>
      ) : (
        <>
          <p className="m-0 mb-2 text-sm">
            דומיין מחובר: <b dir="ltr">{status.domain}</b>{" "}
            {status.status === "verified" ? (
              <b style={{ color: "var(--color-success)" }}>✓ מאומת</b>
            ) : (
              <b style={{ color: "var(--color-text-muted)" }}>ממתין לאימות</b>
            )}
          </p>
          <p className="m-0 mb-3 text-sm">
            כתובת השולח:{" "}
            <b dir="ltr">
              {status.fromName} &lt;{status.fromEmail}&gt;
            </b>{" "}
            <button
              type="button"
              className="mv-btn-plain"
              onClick={() => setEditingSender((v) => !v)}
            >
              {editingSender ? "ביטול" : "עריכה"}
            </button>
          </p>

          {editingSender ? (
            <form
              onSubmit={(e) => void saveSender(e)}
              className="mb-4 flex flex-wrap items-end gap-3"
            >
              <div className="flex-1" style={{ minWidth: "200px" }}>
                <label htmlFor="email-domain-edit-from" className="mb-1 block font-medium">
                  כתובת השולח
                </label>
                <input
                  id="email-domain-edit-from"
                  name="fromEmail"
                  type="email"
                  dir="ltr"
                  required
                  defaultValue={status.fromEmail}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--color-border)" }}
                />
              </div>
              <div className="flex-1" style={{ minWidth: "180px" }}>
                <label htmlFor="email-domain-edit-name" className="mb-1 block font-medium">
                  שם השולח
                </label>
                <input
                  id="email-domain-edit-name"
                  name="fromName"
                  type="text"
                  required
                  maxLength={80}
                  defaultValue={status.fromName}
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--color-border)" }}
                />
              </div>
              <Button type="submit" disabled={busy}>
                שמרו
              </Button>
            </form>
          ) : null}

          {status.status !== "verified" ? (
            <p className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              הוסיפו את שתי הרשומות האלה אצל ספק הדומיין שלכם (הרשם שבו נקנה
              הדומיין), ואז לחצו &quot;בדקו אימות&quot;. עדכון DNS נקלט לרוב תוך
              דקות, ולעיתים עד 48 שעות.
            </p>
          ) : null}

          <div className="mb-3 overflow-x-auto">
            <table className="mv-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">רשומה</th>
                  <th className="text-start">סוג</th>
                  <th className="text-start">שם (Host)</th>
                  <th className="text-start">ערך (Value)</th>
                  <th className="text-start">מצב</th>
                </tr>
              </thead>
              <tbody>
                {(status.records ?? []).map((record) => (
                  <tr key={record.purpose}>
                    <td>{RECORD_LABELS[record.purpose]}</td>
                    <td dir="ltr">{record.type}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <code dir="ltr" style={{ overflowWrap: "anywhere" }}>
                          {record.host}
                        </code>
                        <button
                          type="button"
                          className="mv-btn-plain shrink-0"
                          onClick={() => void clipboard.copy(record.host, `${record.purpose}-host`)}
                        >
                          {clipboard.state === "copied" && clipboard.key === `${record.purpose}-host`
                            ? "✓ הועתק"
                            : "העתקה"}
                        </button>
                      </div>
                    </td>
                    <td style={{ maxWidth: "260px" }}>
                      <div className="flex items-center gap-2">
                        <code
                          dir="ltr"
                          className="block truncate"
                          style={{ maxWidth: "200px" }}
                          title={record.value}
                        >
                          {record.value}
                        </code>
                        <button
                          type="button"
                          className="mv-btn-plain shrink-0"
                          onClick={() => void clipboard.copy(record.value, `${record.purpose}-value`)}
                        >
                          {clipboard.state === "copied" && clipboard.key === `${record.purpose}-value`
                            ? "✓ הועתק"
                            : "העתקה"}
                        </button>
                      </div>
                    </td>
                    <td>
                      {record.verified ? (
                        <b style={{ color: "var(--color-success)" }}>✓ אומתה</b>
                      ) : (
                        <span style={{ color: "var(--color-text-muted)" }}>ממתינה</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {clipboard.state === "failed" ? (
            <p role="status" className="m-0 mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              ההעתקה נחסמה בדפדפן — סמנו את הטקסט והעתיקו ידנית.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={busy} onClick={() => void verify()}>
              בדקו אימות
            </Button>
            {status.lastCheckedAt ? (
              <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                נבדק לאחרונה: {formatDateTime(status.lastCheckedAt)}
              </span>
            ) : null}
            <Button type="button" variant="danger" disabled={busy} onClick={() => void disconnect()}>
              נתקו דומיין
            </Button>
          </div>

          {status.status === "verified" ? (
            <form
              onSubmit={(e) => void sendTest(e)}
              className="mt-4 flex flex-wrap items-end gap-3"
            >
              <div style={{ minWidth: "220px" }}>
                <label htmlFor="email-domain-test-to" className="mb-1 block font-medium">
                  מייל בדיקה אל
                </label>
                <input
                  id="email-domain-test-to"
                  name="to"
                  type="email"
                  dir="ltr"
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-lg border px-3 py-2.5"
                  style={{ borderColor: "var(--color-border)" }}
                />
              </div>
              <Button type="submit" variant="secondary" disabled={busy}>
                שלחו מייל בדיקה
              </Button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
