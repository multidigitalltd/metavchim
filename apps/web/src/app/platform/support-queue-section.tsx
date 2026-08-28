"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  formatSupportReference,
  openSupportCount,
  SUPPORT_KIND_LABEL,
  SUPPORT_SEVERITY_LABEL,
  SUPPORT_SOURCE_LABEL,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABEL,
  type SupportContext,
  type SupportKind,
  type SupportQueueRow,
  type SupportSeverity,
  type SupportStatus,
} from "@metavchim/shared";
import { API_BASE, ApiError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconMail } from "../icons";
import { Notice } from "../notice";

/**
 * שולחן התמיכה — **תור אחד**, ולא אחד לכל ערוץ.
 *
 * ## מה היה כאן קודם
 *
 * שני מסכים זה מתחת לזה: „פניות לתמיכה” (מהכפתור שבמערכת)
 * ו„תיבת התמיכה” (מה שהגיע במייל). כל אחד עם רשימה משלו, סינון
 * משלו, ומונה משלו. מבחינת מי שמטפל זו אותה עבודה בדיוק — מישהו
 * מחכה לתשובה — ולכן „מה מחכה לי הבוקר” הייתה שתי שאלות, ושתי
 * פניות של אותו אדם על אותו דבר יכלו לשבת בשני מסכים בלי שאיש
 * ישים לב.
 *
 * ## מה מאחד ומה נשאר שונה
 *
 * מאוחדים: הרשימה, הסינון, **מספר הפנייה** (רצף אחד לשני המקורות)
 * וסגירה. המקור נשאר מסומן על כל שורה כי הוא קובע **איך עונים** —
 * פנייה במייל חוזרת בשרשור, ופנייה מהכפתור נענית בכרטיס ובמייל —
 * ולכן גם הפרטים שנפתחים בלחיצה שונים. זה ההבדל היחיד שנשאר, והוא
 * אמיתי.
 *
 * ## למה הפרטים נפתחים בלחיצה
 *
 * פנייה ממוצעת היא כמה שורות; שרשור מלא, או פנייה עם הקשר טכני
 * וצילום מסך, הם עשרות. רשימה שמציגה הכול הופכת את „מה מחכה”
 * לגלילה — בדיוק השאלה שהמסך אמור לענות עליה במבט.
 */

/**
 * ‎**„ממתינות” היא ברירת המחדל, ולא „נפתחה”.**
 *
 * המונה שליד הכותרת סופר כל מה שאינו סגור — כולל „בטיפול”, כי שם
 * הפונה עדיין מחכה. סינון שברירת המחדל שלו היא `open` בלבד היה
 * מציג רשימה קצרה מהמונה שמעליה, וזו סתירה שרואים מיד: „כתוב 2,
 * מוצגת אחת”.
 */
type Filter = SupportStatus | "waiting" | "all";

const FILTER_LABEL: Record<Filter, string> = {
  waiting: "ממתינות",
  open: "נפתחה",
  in_progress: "בטיפול",
  closed: "נסגרה",
  all: "הכול",
};

const FILTERS: readonly Filter[] = ["waiting", "in_progress", "closed", "all"];

interface ThreadView {
  id: string;
  reference: number;
  subject: string;
  contactName: string;
  contactEmail: string | null;
  tenantName: string | null;
  status: string;
  messages: {
    id: string;
    direction: string;
    body: string;
    createdAt: string;
    /** ‏pending | sent | failed | unknown — ביוצאות בלבד. */
    sendState?: string;
    attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
  }[];
}

interface AdminTicket {
  id: string;
  reference: number;
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

/**
 * ‎**תשובה שלא יצאה חייבת להיראות אחרת — ו„לא ידוע” אינו „לא”.**
 *
 * ההודעה הצפה אחרי השליחה נעלמת בטעינה מחדש, ואז השורה עצמה היא מה
 * שנשאר. בלי תווית עליה, תשובה שהסתיימה בתוצאה עמומה נראית ככל
 * תשובה שנשלחה — והמנהל שולח שוב לנמען שאולי כבר קיבל (ביקורת
 * Codex).
 */
function sendStateNote(state: string | undefined): { text: string; token: string } | null {
  if (state === "failed") return { text: "לא נשלחה", token: "--color-danger" };
  if (state === "unknown" || state === "pending") {
    return { text: "לא ידוע אם נשלחה — בדקו לפני שליחה חוזרת", token: "--color-danger" };
  }
  return null;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export function SupportQueueSection() {
  const [rows, setRows] = useState<SupportQueueRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [selected, setSelected] = useState<SupportQueueRow | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<SupportQueueRow[]>("/platform/support/queue")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  async function setStatus(row: SupportQueueRow, status: SupportStatus): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      /*
       * נתיב אחד לשני המקורות. מסך שמכיר את שתי הטבלאות הוא מסך
       * שמחזיק את הפיצול שהתור הזה בא לבטל.
       */
      await apiPost(`/platform/support/queue/${row.source}/${row.id}/status`, { status });
      load();
      setSelected((current) =>
        current !== null && current.id === row.id ? { ...current, status } : current,
      );
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "העדכון נכשל" });
    } finally {
      setBusy(false);
    }
  }

  if (rows === null) {
    return (
      <section className="mb-8" aria-labelledby="support-queue-heading">
        <h2 id="support-queue-heading" className="mb-1 text-lg font-semibold">
          <IconMail s={16} /> תור התמיכה
        </h2>
        <p aria-live="polite">טוען…</p>
      </section>
    );
  }

  const shown = rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "waiting") return row.status !== "closed";
    return row.status === filter;
  });
  const waiting = openSupportCount(rows);

  return (
    <section
      aria-labelledby="support-queue-heading"
      id="support-queue"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="support-queue-heading" className="mb-1 text-lg font-semibold">
        <IconMail s={16} /> תור התמיכה
        {waiting > 0 ? (
          <span className="mv-tag ms-2" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
            {waiting} ממתינות
          </span>
        ) : null}
      </h2>
      <p className="mb-3 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
        כל הפניות במקום אחד — מהכפתור שבמערכת ומכל כתובת בדומיין. לכל פנייה
        מספר, והוא נדבק לנושא של המייל כדי שתשובה תחזור לאותה פנייה.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="mv-chip"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {FILTER_LABEL[value]}
          </button>
        ))}
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {shown.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>אין פניות בסינון הזה.</p>
      ) : (
        <ul className="mb-4 flex list-none flex-col gap-2 p-0">
          {shown.map((row) => {
            const isOpen = selected !== null && selected.id === row.id;
            return (
              <li key={`${row.source}-${row.id}`}>
                <button
                  type="button"
                  className="w-full rounded-lg border p-3 text-start text-sm"
                  style={{
                    // גבול של פקד ולא של כרטיס: השורה כאן נלחצת
                    borderColor: row.unread
                      ? "var(--color-primary)"
                      : "var(--color-input-border)",
                    background: isOpen ? "var(--color-hover-soft)" : "var(--color-bg)",
                  }}
                  aria-expanded={isOpen}
                  onClick={() => setSelected(isOpen ? null : row)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <b dir="ltr">{formatSupportReference(row.reference)}</b>
                    <span className="mv-tag">{SUPPORT_SOURCE_LABEL[row.source]}</span>
                    <b>{row.who}</b>
                    {row.tenantName !== null ? (
                      <span className="mv-tag">{row.tenantName}</span>
                    ) : (
                      <span className="mv-tag" style={{ color: "var(--color-text-muted)" }}>
                        לא לקוח
                      </span>
                    )}
                    {row.unread ? (
                      <span
                        className="mv-tag"
                        style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
                      >
                        חדש
                      </span>
                    ) : null}
                    {row.status !== "open" ? (
                      <span className="mv-tag" style={{ color: "var(--color-text-muted)" }}>
                        {SUPPORT_STATUS_LABEL[row.status]}
                      </span>
                    ) : null}
                    <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
                      {formatDateTime(row.lastActivityAt)}
                    </span>
                  </span>
                  <span className="mt-1 block truncate">{row.title}</span>
                </button>

                {isOpen ? (
                  <div
                    className="mt-2 rounded-xl border p-3"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {SUPPORT_STATUSES.filter((status) => status !== row.status).map((status) => (
                        <Button
                          key={status}
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void setStatus(row, status)}
                        >
                          סמן: {SUPPORT_STATUS_LABEL[status]}
                        </Button>
                      ))}
                    </div>
                    {row.source === "email" ? (
                      /*
                        ‎`key` מפורש: מעבר לשרשור אחר **מפרק** את
                        הרכיב ובונה חדש, ולכן שליחה שרצה ברקע אינה
                        יכולה לכתוב הודעה על השרשור שנבחר בינתיים.
                        זה מה שהחליף את שומרי ה-`openRef` הידניים.
                      */
                      <ThreadDetail key={row.id} threadId={row.id} onChanged={load} />
                    ) : (
                      <TicketDetail key={row.id} ticketId={row.id} onChanged={load} />
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * שרשור מייל — ההודעות והמענה.
 *
 * הועבר כמות שהוא מ„תיבת התמיכה”, כולל שומרי המרוץ: פתיחה שהוחלפה
 * בינתיים אינה דורסת את מה שנבחר, ותשובה שהסתיימה בתוצאה עמומה
 * מסומנת ככזו במקום כ„נשלחה”.
 */
function ThreadDetail({ threadId, onChanged }: { threadId: string; onChanged: () => void }) {
  const [view, setView] = useState<ThreadView | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /*
   * ‎**מונה פתיחות.** תשובה של פתיחה **ישנה** שחוזרת אחרונה הייתה
   * דורסת את השרשור שנבחר בינתיים (ביקורת Codex). המונה מזהה איזו
   * פתיחה היא הנוכחית, ולכן תשובה של פתיחה שכבר הוחלפה נזרקת.
   */
  const openSeq = useRef(0);

  const open = useCallback(async (): Promise<void> => {
    const mine = ++openSeq.current;
    try {
      const next = await apiGet<ThreadView>(`/platform/support/inbox/${threadId}`);
      if (openSeq.current !== mine) return;
      setView(next);
    } catch (err: unknown) {
      if (openSeq.current !== mine) return;
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "הפתיחה נכשלה" });
    }
  }, [threadId]);

  useEffect(() => {
    void open();
  }, [open]);

  async function send(): Promise<void> {
    if (view === null) return;
    const files = fileInput.current?.files;
    if (reply.trim() === "" && (files === null || files === undefined || files.length === 0)) return;
    setBusy(true);
    setNotice(null);
    try {
      /*
       * multipart ולא JSON: התשובה יכולה לשאת קבצים, ושליחה בשני
       * מסלולים לפי „יש קובץ או אין” היא בדיוק המקום שבו אחד מהם
       * נשבר בשקט.
       */
      const form = new FormData();
      form.append("body", reply);
      for (const file of files ?? []) form.append("files", file);
      const res = await fetch(`${API_BASE}/platform/support/inbox/${view.id}/reply`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, problem?.message ?? "השליחה נכשלה", []);
      }
      /*
       * ‎**„לא ידוע” אינו „נכשל”.** פסק זמן או 5xx אצל הספק יכולים
       * לקרות אחרי שההודעה כבר יצאה. מסך שאומר „נכשל” מזמין שליחה
       * חוזרת, והפונה מקבל את אותה תשובה פעמיים.
       */
      const sent = (await res.json().catch(() => null)) as { state?: string } | null;
      setReply("");
      if (fileInput.current) fileInput.current.value = "";
      await open();
      onChanged();
      setNotice(
        sent?.state === "unknown"
          ? {
              tone: "danger",
              text: "לא התקבל אישור מספק הדואר — ייתכן שהתשובה יצאה. בדקו לפני שליחה חוזרת.",
            }
          : { tone: "success", text: "התשובה נשלחה" },
      );
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "השליחה נכשלה" });
    } finally {
      setBusy(false);
    }
  }

  if (view === null) {
    return (
      <>
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        <p aria-live="polite">טוען…</p>
      </>
    );
  }

  return (
    <>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
      <p className="m-0 mb-2 flex flex-wrap items-center gap-2">
        <b>{view.subject}</b>
        <span dir="ltr" style={{ color: "var(--color-text-muted)" }}>
          {view.contactEmail ?? "בלי כתובת"}
        </span>
      </p>

      <ol className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
        {view.messages.map((message) => (
          <li
            key={message.id}
            className="rounded-lg border p-2 text-sm"
            style={{
              borderColor: "var(--color-border)",
              background:
                message.direction === "out" ? "var(--color-primary-soft)" : "var(--color-surface)",
            }}
          >
            <p className="m-0 whitespace-pre-wrap" dir="auto">
              {message.body}
            </p>
            {message.attachments.length > 0 ? (
              <ul className="m-0 mt-2 flex list-none flex-wrap gap-2 p-0">
                {message.attachments.map((attachment) => (
                  <li key={attachment.id}>
                    <a
                      href={`${API_BASE}/platform/support/inbox/attachments/${attachment.id}/raw`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      {attachment.name} ({formatBytes(attachment.sizeBytes)})
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <p
              className="m-0 mt-1 text-[length:var(--type-caption-lg)]"
              style={{ color: "var(--color-text-muted)" }}
            >
              {message.direction === "out" ? "תשובת התמיכה" : view.contactName} ·{" "}
              {formatDateTime(message.createdAt)}
              {(() => {
                const note = sendStateNote(message.sendState);
                return note === null ? null : (
                  <>
                    {" · "}
                    <span style={{ color: `var(${note.token})` }}>{note.text}</span>
                  </>
                );
              })()}
            </p>
          </li>
        ))}
      </ol>

      {view.contactEmail !== null ? (
        <>
          <label htmlFor={`support-reply-${view.id}`} className="mb-1 block text-sm font-medium">
            תשובה
          </label>
          <textarea
            id={`support-reply-${view.id}`}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={4}
            className="mb-2 w-full rounded-lg border px-3 py-2"
            style={{
              borderColor: "var(--color-input-border)",
              background: "var(--color-field)",
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              className="text-sm"
            />
            <Button disabled={busy} onClick={() => void send()}>
              {busy ? "שולח…" : "שלח תשובה"}
            </Button>
            <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              עד 7MB קבצים בהודעה
            </span>
          </div>
        </>
      ) : (
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          לפנייה הזו אין כתובת שולח תקינה — אי אפשר להשיב אליה במייל.
        </p>
      )}
    </>
  );
}

/**
 * פנייה מהכפתור — ההודעה, ההקשר הטכני, והמענה.
 *
 * מה שמוצג נבחר כדי שאפשר יהיה **להתחיל לטפל בלי לשאול**: המסך
 * שממנו נשלחה, מה נכשל בו, וצילום. פנייה חוסמת מסומנת באדום — שם
 * מישהו עומד עכשיו מול מסך שאינו עובד.
 */
function TicketDetail({ ticketId, onChanged }: { ticketId: string; onChanged: () => void }) {
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<AdminTicket>(`/platform/support/tickets/${ticketId}`)
      .then(setTicket)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "הפתיחה נכשלה"),
      );
  }, [ticketId]);

  useEffect(load, [load]);

  async function sendReply(): Promise<void> {
    if (draft.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/platform/support/tickets/${ticketId}`, { reply: draft.trim() });
      setDraft("");
      load();
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  }

  if (error !== null) return <Notice tone="danger">{error}</Notice>;
  if (ticket === null) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[length:var(--type-caption-lg)]">
        <span style={{ color: "var(--color-text-muted)" }}>
          {ticket.userName} · {ticket.userEmail}
        </span>
        <span>· {SUPPORT_KIND_LABEL[ticket.kind]}</span>
        <span>· {ticket.area}</span>
        {ticket.severity === "blocking" ? (
          <b style={{ color: "var(--color-danger)" }}>· {SUPPORT_SEVERITY_LABEL.blocking}</b>
        ) : null}
        <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
          {formatDateTime(ticket.createdAt)}
        </span>
      </div>

      <p className="m-0 whitespace-pre-wrap text-[length:var(--type-body-sm)]">{ticket.message}</p>

      {/*
        ההקשר בפתיח מתקפל: הוא מה שמקצר את הטיפול, אבל אם הוא פתוח
        תמיד הוא קובר את מה שהמשתמש כתב.
      */}
      <details className="mt-2 text-[length:var(--type-caption)]">
        <summary style={{ cursor: "pointer", color: "var(--color-text-muted)" }}>הקשר טכני</summary>
        <dl className="m-0 mt-1 grid gap-0.5">
          <div>מסך: {ticket.context.path ?? "—"}</div>
          <div>חלון: {ticket.context.viewport ?? "—"}</div>
          <div dir="ltr">{ticket.context.userAgent ?? "—"}</div>
          {(ticket.context.failedRequests ?? []).length > 0 ? (
            <div dir="ltr">בקשות שנכשלו: {(ticket.context.failedRequests ?? []).join(" | ")}</div>
          ) : null}
          {(ticket.context.errors ?? []).length > 0 ? (
            <div dir="ltr">שגיאות: {(ticket.context.errors ?? []).join(" | ")}</div>
          ) : null}
          {(ticket.context.breadcrumbs ?? []).length > 0 ? (
            <div dir="ltr">מסלול: {(ticket.context.breadcrumbs ?? []).join(" ← ")}</div>
          ) : null}
        </dl>
      </details>

      {ticket.hasScreenshot ? (
        <p className="m-0 mt-1 text-[length:var(--type-caption)]">
          <a
            href={`${API_BASE}/platform/support/tickets/${ticket.id}/screenshot`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            צילום המסך
          </a>
        </p>
      ) : null}

      {ticket.reply !== undefined ? (
        <p className="m-0 mt-2 text-[length:var(--type-caption-lg)]">
          <b>נענה:</b> {ticket.reply}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <textarea
          rows={2}
          maxLength={2000}
          placeholder="תשובה למשרד"
          aria-label="תשובה לפנייה"
          className="mv-field grow"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className="mv-btn-action"
          disabled={busy || draft.trim() === ""}
          onClick={() => void sendReply()}
        >
          שליחת תשובה
        </button>
      </div>
    </>
  );
}
