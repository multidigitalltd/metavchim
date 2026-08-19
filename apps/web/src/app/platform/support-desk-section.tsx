"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SUPPORT_KIND_LABEL,
  SUPPORT_SEVERITY_LABEL,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABEL,
  type SupportContext,
  type SupportKind,
  type SupportSeverity,
  type SupportStatus,
} from "@metavchim/shared";
import { API_BASE, ApiError, apiGet, apiPatch } from "@/lib/api";

/**
 * שולחן התמיכה — תור אחד לכל המשרדים.
 *
 * מה שמוצג בכל שורה נבחר כדי שאפשר יהיה **להתחיל לטפל בלי לשאול**:
 * המשרד, מי כתב, המסך שממנו נשלחה, מה נכשל בו, וצילום. הפניות
 * החוסמות מסומנות באדום — הן אלה שבהן מישהו עומד עכשיו מול מסך
 * שאינו עובד.
 */

interface AdminTicket {
  id: string;
  kind: SupportKind;
  message: string;
  status: SupportStatus;
  area: string;
  severity: SupportSeverity;
  hasScreenshot: boolean;
  reply?: string;
  createdAt: string;
  userName: string;
  userEmail: string;
  tenantId: string;
  tenantName: string;
  context: SupportContext;
}

export function SupportDeskSection(): React.JSX.Element {
  const [filter, setFilter] = useState<SupportStatus | "all">("open");
  const [tickets, setTickets] = useState<AdminTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<AdminTicket[]>(
      `/platform/support/tickets${filter === "all" ? "" : `?status=${filter}`}`,
    )
      .then(setTickets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "טעינת הפניות נכשלה"),
      );
  }, [filter]);

  useEffect(load, [load]);

  async function update(id: string, patch: { status?: SupportStatus; reply?: string }) {
    setBusy(id);
    setError(null);
    try {
      await apiPatch(`/platform/support/tickets/${id}`, patch);
      setDraft((d) => ({ ...d, [id]: "" }));
      load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby="support-desk"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="support-desk" className="mb-1 text-lg font-semibold">
        פניות לתמיכה
      </h2>
      <p className="mb-3 text-[14.5px]" style={{ color: "var(--color-text-muted)" }}>
        כל פנייה נושאת איתה את המסך שממנו נשלחה ואת השגיאות שהיו בו. תשובה
        שנשמרת כאן מוצגת למשרד בתוך המערכת ונשלחת גם במייל לפונה.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["open", "in_progress", "resolved", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className="mv-chip"
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "הכול" : SUPPORT_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error !== null ? (
        <p role="alert" className="mb-2 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {tickets === null ? (
        <p aria-live="polite">טוען…</p>
      ) : tickets.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>אין פניות בסינון הזה.</p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {tickets.map((t) => (
            <li key={t.id} className="rounded-xl border p-3" style={{ borderColor: "var(--color-border)" }}>
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[14.5px]">
                <b>{t.tenantName}</b>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {t.userName} · {t.userEmail}
                </span>
                <span>· {SUPPORT_KIND_LABEL[t.kind]}</span>
                <span>· {t.area}</span>
                {t.severity === "blocking" ? (
                  <b style={{ color: "var(--color-danger)" }}>· {SUPPORT_SEVERITY_LABEL.blocking}</b>
                ) : null}
                <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
                  {new Date(t.createdAt).toLocaleString("he-IL")}
                </span>
              </div>

              <p className="m-0 whitespace-pre-wrap text-[15px]">{t.message}</p>

              {/*
                ההקשר בפתיח מתקפל: הוא מה שמקצר את הטיפול, אבל אם הוא
                פתוח תמיד הוא קובר את מה שהמשתמש כתב.
              */}
              <details className="mt-2 text-[14px]">
                <summary style={{ cursor: "pointer", color: "var(--color-text-muted)" }}>
                  הקשר טכני
                </summary>
                <dl className="m-0 mt-1 grid gap-0.5">
                  <div>מסך: {t.context.path ?? "—"}</div>
                  <div>חלון: {t.context.viewport ?? "—"}</div>
                  <div dir="ltr">{t.context.userAgent ?? "—"}</div>
                  {(t.context.failedRequests ?? []).length > 0 ? (
                    <div dir="ltr">בקשות שנכשלו: {(t.context.failedRequests ?? []).join(" | ")}</div>
                  ) : null}
                  {(t.context.errors ?? []).length > 0 ? (
                    <div dir="ltr">שגיאות: {(t.context.errors ?? []).join(" | ")}</div>
                  ) : null}
                  {(t.context.breadcrumbs ?? []).length > 0 ? (
                    <div dir="ltr">מסלול: {(t.context.breadcrumbs ?? []).join(" ← ")}</div>
                  ) : null}
                </dl>
              </details>

              {t.hasScreenshot ? (
                <p className="m-0 mt-1 text-[14px]">
                  <a
                    href={`${API_BASE}/platform/support/tickets/${t.id}/screenshot`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    צילום המסך
                  </a>
                </p>
              ) : null}

              {t.reply !== undefined ? (
                <p className="m-0 mt-2 text-[14.5px]">
                  <b>נענה:</b> {t.reply}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder="תשובה למשרד"
                  aria-label="תשובה לפנייה"
                  className="mv-field grow"
                  value={draft[t.id] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="mv-btn-action"
                  disabled={busy === t.id || (draft[t.id] ?? "").trim() === ""}
                  onClick={() => void update(t.id, { reply: (draft[t.id] ?? "").trim() })}
                >
                  שליחת תשובה
                </button>
                {SUPPORT_STATUSES.filter((s) => s !== t.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="mv-btn-plain"
                    disabled={busy === t.id}
                    onClick={() => void update(t.id, { status: s })}
                  >
                    סמן: {SUPPORT_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
