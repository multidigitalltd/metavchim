"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiDelete, apiGet, apiPost, ApiError } from "@/lib/api";
import { IconCalendar, IconWarning } from "../icons";
import { Notice } from "../notice";

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


/** תוצאת הסנכרון כפי שהשרת מדווח אותה. */
interface SyncResult {
  pulled: number;
  pushed: number;
  alreadySynced: number;
  notMine: number;
}

/**
 * הודעה שמסבירה את עצמה.
 *
 * "✓ סונכרן: 0 נמשכו, 0 נדחפו" הוא דיווח נכון שנקרא כתקלה: מתווך
 * שרואה פגישה ביומן שלו מסיק שהסנכרון שבור, בעוד שברוב המקרים היא
 * כבר מסונכרנת. המונים המאבחנים הופכים את השורה לתשובה.
 */
function describeSync(res: SyncResult): string {
  const moved: string[] = [];
  if (res.pulled > 0) moved.push(`${res.pulled} נמשכו מ-Google`);
  if (res.pushed > 0) moved.push(`${res.pushed} נדחפו ל-Google`);
  if (moved.length > 0) return `✓ סונכרן: ${moved.join(", ")}`;

  if (res.alreadySynced > 0) {
    return `✓ הכול מעודכן — ${res.alreadySynced} פגישות שלכם כבר ביומן Google, ואין שינויים חדשים`;
  }
  if (res.notMine > 0) {
    return `✓ אין מה לסנכרן. ${res.notMine} פגישות בחלון שייכות לסוכנים אחרים — כל סוכן מסנכרן ליומן שלו`;
  }
  return "✓ אין מה לסנכרן — אין פגישות חדשות בשני הצדדים";
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

  /** איפוס סימוני הסנכרון ודחיפה מחדש — מסלול התיקון. */
  async function resyncAll(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiPost<SyncResult & { reset: number }>("/calendar/google/resync", {});
      setMessage(
        res.pushed > 0
          ? `✓ ${res.pushed} פגישות ומשימות נדחפו מחדש ל-Google`
          : `✓ אופסו ${res.reset} רשומות — אין מה לדחוף בחלון של היממה האחרונה ואילך`,
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הדחיפה מחדש נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiPost<SyncResult>("/calendar/google/sync", {});
      setMessage(describeSync(res));
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
        <Notice tone="danger">{error}</Notice>
      ) : null}
      {message ? (
        <Notice tone="success">{message}</Notice>
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
            {/*
              מסלול תיקון: פגישה שנמחקה בטעות ב-Google מסומנת אצלנו
              כמסונכרנת ולכן לא הייתה חוזרת לעולם. הכפתור מאפס את
              הסימון ודוחף הכול מחדש.
            */}
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void resyncAll()}>
              {busy ? "דוחף…" : "דחוף הכול מחדש"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void disconnect()}>
              נתק יומן
            </Button>
          </div>
          <p className="m-0 mt-2 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
            נדחפות הפגישות והמשימות <b>שלכם</b> בלבד — לכל סוכן יומן משלו. משימה עם
            מועד יעד מופיעה ב-Google כאירוע של חצי שעה עם הקידומת „משימה".
          </p>
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
