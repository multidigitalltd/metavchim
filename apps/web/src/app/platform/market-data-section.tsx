"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIsraeliNumber, type MarketPlatformStatusDto } from "@metavchim/shared";
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { LoadError } from "../load-error";
import { Notice } from "../notice";

/**
 * ‎**נתוני שוק — סנכרון עסקאות רשות המסים** (docs/14). בעל הפלטפורמה בלבד.
 *
 * שלוש שאלות: האם זה רץ, כמה כבר במאגר מתוך מה שהמקור מפרסם, ומה
 * נכשל. ההפעלה והקצב נשמרים דרך `PATCH /platform/settings` — אותו
 * נתיב של כל הגדרה אחרת — וכאן רק מוצגים ונערכים.
 *
 * ‎**הקצב הוא הכלי הראשון כשהמקור מתלונן.** זה שירות ציבורי שמתנדבים
 * מפעילים, עם תקציב נתונים לכל כתובת; „המקור ביקש להאט” ביומן אומר
 * להגדיל את המרווח, לא לנסות שוב מהר יותר.
 */

const STATUS_LABEL: Record<string, string> = {
  running: "רץ",
  ok: "הושלם",
  partial: "חלקי — ימשיך בסבב הבא",
  error: "נכשל",
};

const bytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)}GB` : `${Math.round(n / 1024 ** 2)}MB`;

export function MarketDataSection() {
  const [data, setData] = useState<MarketPlatformStatusDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [interval, setIntervalValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    apiGet<MarketPlatformStatusDto>("/platform/market")
      .then((status) => {
        setData(status);
        setIntervalValue(String(status.intervalMs));
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  // מתרענן לבד בזמן שסבב רץ — אחרת המספרים במסך „קפואים”
  useEffect(() => {
    if (!data?.running) return;
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [data?.running, load]);

  const save = async (patch: { marketSyncEnabled?: boolean; marketRequestIntervalMs?: number }) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiPatch("/platform/settings", patch);
      setNotice("נשמר");
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<{ started: boolean; reason?: string }>("/platform/market/run", {});
      setNotice(
        result.started
          ? "הסבב התחיל ברקע"
          : result.reason === "disabled"
            ? "הסנכרון כבוי — הפעילו אותו קודם"
            : "סבב כבר רץ",
      );
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "ההפעלה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <LoadError message="לא הצלחנו לטעון את מצב נתוני השוק" onRetry={load} />;
  if (!data) return null;

  const s = data.settlements;
  return (
    <section aria-labelledby="platform-market-heading" className="mb-8">
      <h2 id="platform-market-heading" className="mb-1 text-lg font-semibold">
        נתוני שוק
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        עסקאות מיסוי מקרקעין של כל הארץ, מ-{data.source}. סבב כל חצי שעה, יישוב אחר יישוב, בקצב קבוע.
        הנתונים אינם נכנסים לגיבוי היומי ונבנים מחדש מהמקור.
      </p>

      <dl className="mv-stat-grid m-0 mb-4">
        <div className="mv-stat-tile">
          <dt>מצב</dt>
          <dd className="m-0 font-bold">
            {data.enabled ? (data.running ? "פועל — סבב רץ עכשיו" : "פועל") : "כבוי"}
            {data.enabledSource === "default" ? " (ברירת מחדל)" : ""}
          </dd>
        </div>
        <div className="mv-stat-tile">
          <dt>עסקאות במאגר</dt>
          <dd className="m-0 font-bold">{formatIsraeliNumber(data.deals.local)}</dd>
          <p className="m-0">
            מתוך {formatIsraeliNumber(data.deals.source)}
            {data.deals.coveragePct !== null ? ` (${data.deals.coveragePct}%)` : ""}
          </p>
        </div>
        <div className="mv-stat-tile">
          <dt>יישובים</dt>
          <dd className="m-0 font-bold">
            {s.ok} / {s.total}
          </dd>
          <p className="m-0">
            בקליטה {s.backfill} · ממתינים {s.pending}
            {s.error > 0 ? ` · שגיאה ${s.error}` : ""}
          </p>
        </div>
        <div className="mv-stat-tile">
          <dt>חלקות ממוקמות</dt>
          <dd className="m-0 font-bold">{formatIsraeliNumber(data.parcels.located)}</dd>
          <p className="m-0">מתוך {formatIsraeliNumber(data.parcels.total)} שנבדקו</p>
        </div>
        <div className="mv-stat-tile">
          <dt>נכסי משרדים מקושרים</dt>
          <dd className="m-0 font-bold">{formatIsraeliNumber(data.properties.linked)}</dd>
          <p className="m-0">ממתינים לקישור {formatIsraeliNumber(data.properties.pending)}</p>
        </div>
        <div className="mv-stat-tile">
          <dt>נפח במסד</dt>
          <dd className="m-0 font-bold">{bytes(data.storageBytes)}</dd>
          <p className="m-0">{data.deals.lastDeal ? `עסקה אחרונה ${formatDate(data.deals.lastDeal)}` : "עוד אין עסקאות"}</p>
        </div>
      </dl>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <button
          type="button"
          className={data.enabled ? "mv-btn-ghost" : "mv-btn-primary"}
          disabled={busy}
          onClick={() => void save({ marketSyncEnabled: !data.enabled })}
        >
          {data.enabled ? "כיבוי הסנכרון" : "הפעלת הסנכרון"}
        </button>
        <button type="button" className="mv-btn-ghost" disabled={busy || !data.enabled || data.running} onClick={() => void runNow()}>
          סנכרן עכשיו
        </button>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const n = Number(interval);
            if (!Number.isInteger(n) || n < 500 || n > 60_000) {
              setError("מרווח בין 500 ל-60,000 מילישניות");
              return;
            }
            void save({ marketRequestIntervalMs: n });
          }}
        >
          <label className="flex flex-col gap-1" htmlFor="market-interval">
            <span className="text-sm font-semibold">מרווח בין בקשות (מ&quot;ש)</span>
            <input
              id="market-interval"
              className="mv-input"
              inputMode="numeric"
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              style={{ width: 140 }}
            />
          </label>
          <button type="submit" className="mv-btn-plain" disabled={busy}>
            שמירה
          </button>
        </form>
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {data.errors.length > 0 ? (
        <details className="mb-4">
          <summary className="cursor-pointer font-semibold">יישובים עם שגיאה ({data.errors.length})</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-sm">
            {data.errors.map((row) => (
              <li key={row.name}>
                <b>{row.name}</b>: {row.error ?? "—"}
                {row.syncedAt ? ` (${formatDateTime(row.syncedAt)})` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {data.runs.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-sm">
            <caption className="mv-visually-hidden">סבבי הסנכרון האחרונים</caption>
            <thead style={{ background: "var(--color-table-head)" }}>
              <tr>
                <th scope="col" className="p-2 text-start">התחיל</th>
                <th scope="col" className="p-2 text-start">מצב</th>
                <th scope="col" className="p-2 text-start">בקשות</th>
                <th scope="col" className="p-2 text-start">עסקאות חדשות</th>
                <th scope="col" className="p-2 text-start">סיכום</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id} className="border-t" style={{ borderColor: "var(--color-row-border)" }}>
                  <td className="whitespace-nowrap p-2">{formatDateTime(run.startedAt)}</td>
                  <td className="p-2" style={run.status === "error" ? { color: "var(--color-danger)" } : undefined}>
                    {STATUS_LABEL[run.status] ?? run.status}
                    {run.kind === "manual" ? " · ידני" : ""}
                  </td>
                  <td className="p-2">{formatIsraeliNumber(run.requests)}</td>
                  <td className="p-2">{formatIsraeliNumber(run.rows)}</td>
                  <td className="p-2">{run.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
