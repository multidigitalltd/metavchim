"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import type {
  MatchRefreshLevel,
  MatchRefreshState,
  MatchRefreshSummary,
} from "@metavchim/shared";
import { MATCH_REFRESH_REASON_LABELS } from "@metavchim/shared";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { Notice } from "../notice";

/**
 * מצב חישוב ההתאמות מחדש.
 *
 * הכרטיס יושב מתחת למשקלים ולא במסך נפרד, כי הוא התשובה לשאלה
 * שנשאלת בדיוק שם: **שיניתי משקל — מה קרה עכשיו?** עד היום התשובה
 * הייתה "כלום, עד שתערוך כל נכס בנפרד", וזה נכתב באותיות קטנות
 * מתחת לכפתור השמירה.
 */

interface RefreshStatus {
  state: MatchRefreshState | null;
  summary: MatchRefreshSummary;
  engineVersion: string;
  running: boolean;
}

/** כל כמה זמן לשאול בזמן שסבב רץ. */
const POLL_MS = 3000;
/** תקרת המתנה — סבב ארוך מזה כנראה נתקע, ועדיף להפסיק לשאול. */
const POLL_LIMIT = 60;

/**
 * משך הסבב. סבב של 96ms הוצג כ-"0 שניות" — מספר שנקרא כמו תקלה,
 * בעוד שהוא בדיוק ההפך.
 */
function duration(ms: number): string {
  if (ms < 1000) return `${ms} מ״ש`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} שניות` : `${Math.round(seconds / 60)} דקות`;
}

const LEVEL_COLOR: Record<MatchRefreshLevel, string> = {
  ok: "var(--color-primary)",
  warn: "var(--color-warning)",
  danger: "var(--color-danger)",
};

export function MatchRefreshCard({ reloadKey }: { reloadKey: number }) {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);

  const load = useCallback(async (): Promise<RefreshStatus | null> => {
    try {
      const next = await apiGet<RefreshStatus>("/matches/refresh");
      setStatus(next);
      return next;
    } catch {
      setError("טעינת מצב החישוב נכשלה");
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  /*
   * דגימה בזמן שסבב רץ, ולא ספינר שמסתובב לנצח.
   *
   * הסבב מופעל גם מהשרת (שמירת משקלים) ולא רק מהכפתור כאן, ולכן
   * המסך חייב לגלות בעצמו שהוא רץ — אחרת מנהל ששמר משקלים היה רואה
   * את המספרים הישנים ומסיק שוב שלא קרה כלום.
   */
  useEffect(() => {
    if (status?.running !== true) {
      polls.current = 0;
      return;
    }
    if (polls.current >= POLL_LIMIT) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [status, load]);

  async function refreshNow(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setStatus(await apiPost<RefreshStatus>("/matches/refresh", {}));
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החישוב נכשל");
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running === true;

  return (
    <section
      id="match-refresh"
      className="mb-6 rounded-xl border p-4"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface)",
      }}
      aria-labelledby="match-refresh-heading"
    >
      <h3 id="match-refresh-heading" className="mb-1 font-semibold">
        חישוב ההתאמות מחדש
      </h3>
      <p
        className="m-0 mb-3 text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        התאמות מחושבות מחדש בכל פעם שנכס או קונה נשמרים. סבב מלא נחוץ למה שאינו
        רשומה בודדת: שינוי המשקלים כאן, שדרוג של מנוע ההתאמות, ומעבר הזמן — מועד
        הכניסה נמדד מול היום, ולכן נכס שמתפנה בעוד חודשיים נכנס בשלב מסוים לטווח
        של קונה שביקש כניסה מיידית.
      </p>

      <div
        className="mb-3 rounded-lg border p-3"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg)",
        }}
        aria-live="polite"
      >
        {status === null ? (
          <p className="m-0 text-sm">טוען…</p>
        ) : running ? (
          <p className="m-0 text-sm font-medium">
            מחשב מחדש את כל ההתאמות במשרד…
          </p>
        ) : (
          <>
            <p
              className="m-0 text-sm font-medium"
              style={{ color: LEVEL_COLOR[status.summary.level] }}
            >
              {status.summary.headline}
            </p>
            {status.state ? (
              <p
                className="m-0 mt-1 text-[length:var(--type-caption)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                {MATCH_REFRESH_REASON_LABELS[status.state.reason]} ·{" "}
                {status.state.matches} התאמות במאגר · {duration(status.state.durationMs)}
              </p>
            ) : null}
          </>
        )}
      </div>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        disabled={busy || running}
        onClick={() => void refreshNow()}
      >
        {busy || running ? "מחשב…" : "חשב הכול מחדש עכשיו"}
      </Button>
    </section>
  );
}
