"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { IconCalendar, IconWarning } from "../icons";

/**
 * חיבור יומן Google.
 *
 * המחיר של יומן שאינו מסונכרן הוא פגישה כפולה: המתווך קובע סיור
 * במערכת, וביומן הפרטי שלו כבר יושבת פגישה אחרת באותה שעה. אף צד
 * לא יודע על השני עד שהלקוח מחכה בכניסה לבניין.
 *
 * החיבור הוא **אישי** ולא של המשרד, וזה נאמר במפורש במסך: מנהל
 * שיחבר כאן את היומן שלו לא יחבר בטעות את כל הסוכנים.
 */

interface Status {
  available: boolean;
  connected: boolean;
  email?: string;
  lastSyncAt?: string;
  lastError?: string;
}

export function GoogleCalendarSection(): React.JSX.Element | null {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Status>("/calendar/google/status")
      .then(setStatus)
      .catch(() => setStatus({ available: false, connected: false }));
  }, []);

  useEffect(load, [load]);

  /*
   * חזרה מ-Google מגיעה כפרמטר בכתובת. הוא נמחק מיד אחרי הקריאה,
   * כדי שרענון של הדף לא יציג שוב "חובר בהצלחה" על כלום.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("calendar");
    if (!result) return;
    setMessage(result === "connected" ? "✓ היומן חובר" : null);
    setError(result === "failed" ? "החיבור ליומן לא הושלם — נסו שוב" : null);
    params.delete("calendar");
    const query = params.toString();
    window.history.replaceState({}, "", query ? `?${query}` : window.location.pathname);
  }, []);

  async function disconnect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiDelete("/calendar/google/connection");
      setMessage("היומן נותק");
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
      const res = await apiPost<{ pulled: number; pushed: number }>("/calendar/google/sync", {});
      setMessage(`✓ סונכרן: ${res.pulled} נמשכו מהיומן, ${res.pushed} נדחפו אליו`);
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הסנכרון נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return <p aria-live="polite">טוען…</p>;

  return (
    <section
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="gcal-heading"
    >
      <h2 id="gcal-heading" className="mb-1 text-lg font-semibold">
        <IconCalendar s={16} /> יומן Google
      </h2>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        סנכרון דו-כיווני: פגישה שנקבעת כאן מופיעה ביומן שלכם, ואירוע שנקבע ביומן מופיע
        כאן — כדי שלא ייקבעו שתי פגישות באותה שעה. החיבור אישי לכל משתמש, לא למשרד.
      </p>

      {error ? (
        <p role="alert" className="mb-2" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p aria-live="polite" className="mb-2" style={{ color: "var(--color-success)" }}>
          {message}
        </p>
      ) : null}

      {!status.available ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          החיבור טרם הופעל במערכת. בעל הפלטפורמה משלים את אישורי Google במסך הניהול.
        </p>
      ) : status.connected ? (
        <div>
          <p className="mb-1">
            מחובר לחשבון <strong dir="ltr">{status.email}</strong>
          </p>
          <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {status.lastSyncAt
              ? `סונכרן לאחרונה ב-${new Date(status.lastSyncAt).toLocaleString("he-IL")}`
              : "טרם סונכרן — הסבב הראשון ירוץ בקרוב"}
          </p>
          {/*
            שגיאת הסבב האחרון מוצגת ולא נבלעת: חיבור שנשבר בשקט הוא
            הגרוע מכולם — ממשיכים לסמוך עליו, ופגישות מפסיקות להופיע.
          */}
          {status.lastError ? (
            <p className="mb-3 text-sm" style={{ color: "var(--color-danger)" }}>
              <IconWarning s={15} /> הסנכרון האחרון נכשל: {status.lastError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void syncNow()}>
              {busy ? "מסנכרן…" : "סנכרן עכשיו"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
              נתק יומן
            </Button>
          </div>
        </div>
      ) : (
        /*
          קישור רגיל ולא fetch: זו התחלה של מסע OAuth שמסתיים בניווט
          חזרה מ-Google, והדפדפן חייב לנווט בעצמו כדי שהעוגייה של
          ה-state תיווצר ותחזור.
        */
        <a href={`${API_BASE}/calendar/google/start`} className="mv-btn-action inline-block">
          חבר את יומן Google
        </a>
      )}
    </section>
  );
}
