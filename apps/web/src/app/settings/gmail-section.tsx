"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconMail, IconWarning } from "../icons";

/**
 * חיבור Gmail — אימיילים נכנסים הופכים ללידים.
 *
 * שולח מוכר מצטרף לכרטיס הקיים שלו; שולח חדש עם טלפון בהודעה (כמו
 * פניות מפורטלים) נקלט כליד; אימייל בלי שום זיהוי מדולג ונספר —
 * המונה מוצג כאן, כדי שהמנהל יידע כמה נשאר מחוץ למערכת.
 */

interface Status {
  available: boolean;
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  lastError?: string;
  skippedCount?: number;
}

export function GmailSection(): React.JSX.Element | null {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Status>("/gmail/status")
      .then(setStatus)
      .catch(() => setStatus({ available: false, connected: false }));
  }, []);

  useEffect(load, [load]);

  /* חזרה מ-Google — פרמטר בכתובת, נמחק מיד כמו בחיבור היומן */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("gmail");
    if (!result) return;
    setMessage(result === "connected" ? "✓ תיבת ה-Gmail חוברה" : null);
    setError(result === "failed" ? "החיבור לא הושלם — נסו שוב" : null);
    params.delete("gmail");
    const query = params.toString();
    window.history.replaceState({}, "", query ? `?${query}` : window.location.pathname);
  }, []);

  async function disconnect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete("/gmail/connection");
      setMessage("התיבה נותקה");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הניתוק נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiPost<{ imported: number; skipped: number }>("/gmail/sync", {});
      setMessage(`✓ נמשך: ${res.imported} נקלטו כלידים, ${res.skipped} דולגו`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "המשיכה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return <p aria-live="polite">טוען…</p>;

  return (
    <section
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="gmail-heading"
    >
      <h2 id="gmail-heading" className="mb-1 text-lg font-semibold">
        <IconMail s={16} /> לידים מ-Gmail
      </h2>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        אימיילים שנכנסים לתיבה הופכים ללידים אוטומטית: שולח מוכר מצטרף לכרטיס
        הקיים שלו, ופנייה חדשה עם מספר טלפון (כמו מיד2 ומהפורטלים) נפתחת כליד.
        חברו את התיבה שאליה מגיעות הפניות של המשרד. אימייל הופך לליד כשהשולח מוכר
        למערכת או כשיש בהודעה מספר טלפון; מה שאין בו אף אחד מהשניים מדולג במכוון.
      </p>

      {message ? (
        <p role="status" className="m-0 mb-3 text-sm" style={{ color: "var(--color-primary)" }}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="m-0 mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {!status.available ? (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          חיבור Google טרם הוגדר במערכת — פנו לתמיכה.
        </p>
      ) : !status.connected ? (
        <a href={`${API_BASE}/gmail/start`} className="mv-btn-action inline-block" style={{ textDecoration: "none" }}>
          חבר תיבת Gmail
        </a>
      ) : (
        <>
          <p className="m-0 mb-1 text-sm">
            מחובר לתיבה: <b dir="ltr">{status.email}</b>
          </p>
          {/*
            הרשאת השליחה נוספה אחרי שחיבורים כבר היו קיימים, ואסימון
            ישן אינו נושא אותה — שליחה דרכו תיכשל. הכיתוב חוסך את
            הניסיון והכישלון.
          */}
          <p className="m-0 mb-2 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            כדי לשלוח מיילים ללקוחות מתוך הכרטיס נדרשת גם הרשאת שליחה. אם חיברתם את
            התיבה לפני העדכון — נתקו וחברו מחדש, ואשרו את ההרשאה החדשה.
          </p>
          <p className="m-0 mb-3 text-[12.5px]" style={{ color: "var(--color-text-muted)" }}>
            {status.lastSyncAt
              ? `משיכה אחרונה: ${formatDateTime(status.lastSyncAt)} · נבדק אוטומטית כל רבע שעה`
              : "טרם נמשכו הודעות — המשיכה הראשונה תרוץ בדקות הקרובות"}
            {status.skippedCount ? ` · ${status.skippedCount} אימיילים דולגו` : ""}
          </p>

          {/*
            הסבר מלא ולא רק המונה.
            "1 אימיילים דולגו" בלי הסבר נקרא כתקלה, והמשתמש מחפש מה
            שבור — בעוד שהדילוג הוא התנהגות מכוונת. ההסבר מופיע רק
            כשבאמת דולג משהו, כדי שלא יהיה רעש קבוע במסך.
          */}
          {status.skippedCount ? (
            <details className="mb-3">
              <summary className="cursor-pointer text-[12.5px]" style={{ color: "var(--color-primary)" }}>
                למה אימיילים מדולגים?
              </summary>
              <div
                className="mt-2 rounded-lg border p-3 text-[12.5px]"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              >
                <p className="m-0 mb-2">אימייל נקלט בשתי דרכים:</p>
                <ol className="m-0 mb-2 ps-4">
                  <li>
                    <b>השולח מוכר</b> — כתובת האימייל שלו רשומה על כרטיס קיים, והפנייה
                    נכנסת לכרטיס הזה.
                  </li>
                  <li>
                    <b>יש טלפון בהודעה</b> — פורטלים כמו יד2 שולחים את הטלפון של הפונה,
                    והמערכת פותחת ליד חדש.
                  </li>
                </ol>
                <p className="m-0 mb-2">
                  אימייל שאין בו אף אחד מהשניים מדולג — <b>בכוונה</b>. הטלפון הוא המפתח
                  שכל המערכת בנויה עליו: זיהוי כפילויות, וואטסאפ וחיוג. כרטיס בלי טלפון
                  היה רשומה יתומה שאי אפשר לעשות איתה דבר, ולכן עדיף לדלג מאשר ליצור
                  אותה.
                </p>
                <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
                  ניוזלטרים, פרסומות והודעות מערכת נופלים לכאן — וזה בדיוק מה שאמור
                  לקרות. נסרקים רק אימיילים בתיבה הראשית (Inbox); מה שמסונן ל&quot;קידומי
                  מכירות&quot; או לתווית אחרת לא ייקלט.
                </p>
              </div>
            </details>
          ) : null}
          {status.lastError ? (
            <p role="alert" className="m-0 mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
              <IconWarning s={15} /> {status.lastError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void syncNow()} disabled={busy}>
              {busy ? "מושך…" : "משוך עכשיו"}
            </Button>
            <Button variant="ghost" onClick={() => void disconnect()} disabled={busy}>
              נתק
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
