"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, ApiError, apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { IconMail } from "../icons";
import { Notice } from "../notice";

/**
 * תיבת התמיכה — הפניות שנכנסו במייל, והמענה עליהן.
 *
 * ## למה זה מסך ולא תיבת דואר
 *
 * פנייה לתמיכה היא **עבודה שממתינה**, לא הודעה שנקראת. לכן הרשימה
 * מסודרת לפי מי מחכה (פתוחים קודם, ואז לפי ההודעה האחרונה), כל
 * שרשור מציג את המשרד שזוהה — כדי שלא צריך לשאול "מי אתה" — וסגירה
 * היא פעולה מפורשת ולא "נקרא".
 *
 * ## למה השרשור נפתח בלחיצה ולא ברשימה
 *
 * פנייה ממוצעת היא כמה שורות, אבל שרשור מלא הוא עשרות. רשימה
 * שמציגה הכול הופכת את "מה מחכה" לגלילה, וזו בדיוק השאלה שהמסך
 * הזה נועד לענות עליה במבט.
 */

interface ThreadRow {
  id: string;
  subject: string;
  contactName: string;
  contactEmail: string | null;
  tenantId: string | null;
  tenantName: string | null;
  status: string;
  unread: boolean;
  lastMessageAt: string;
}

interface ThreadView {
  id: string;
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

/**
 * ‎**תשובה שלא יצאה חייבת להיראות אחרת — ו„לא ידוע” אינו „לא”.**
 *
 * ההודעה הצפה אחרי השליחה נעלמת בטעינה מחדש או ברענון הדף, ואז
 * השורה עצמה היא מה שנשאר. בלי תווית עליה, תשובה שהסתיימה בתוצאה
 * עמומה נראית ככל תשובה שנשלחה — והמנהל שולח שוב לנמען שאולי כבר
 * קיבל (ביקורת Codex). אותה תווית ואותן מילים כמו בתיבת הלקוחות:
 * הפעולה הנדרשת זהה, ולכן גם הניסוח.
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

export function SupportInboxSection() {
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [open, setOpen] = useState<ThreadView | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /*
   * השרשור הפתוח, לקריאה אחרי `await`: המשך שרץ בסגור של רינדור
   * קודם קורא ערך ישן מ-state מעצם הגדרתו.
   */
  const openRef = useRef<string | null>(null);

  const load = useCallback(() => {
    apiGet<ThreadRow[]>("/platform/support/inbox")
      .then(setThreads)
      .catch(() => setThreads([]));
  }, []);

  useEffect(load, [load]);

  async function openThread(id: string): Promise<void> {
    openRef.current = id;
    setNotice(null);
    try {
      setOpen(await apiGet<ThreadView>(`/platform/support/inbox/${id}`));
      load();
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "הפתיחה נכשלה" });
    }
  }

  async function send(): Promise<void> {
    if (open === null) return;
    const files = fileInput.current?.files;
    if (reply.trim() === "" && (files === null || files === undefined || files.length === 0)) return;
    setBusy(true);
    setNotice(null);
    try {
      /*
       * multipart ולא JSON: התשובה יכולה לשאת קבצים, ושליחה בשני
       * מסלולים שונים לפי "יש קובץ או אין" היא בדיוק המקום שבו אחד
       * מהם נשבר בשקט.
       */
      const form = new FormData();
      form.append("body", reply);
      for (const file of files ?? []) form.append("files", file);
      const res = await fetch(`${API_BASE}/platform/support/inbox/${open.id}/reply`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, problem?.message ?? "השליחה נכשלה", []);
      }
      /*
       * **"לא ידוע" אינו "נכשל".**
       *
       * פסק זמן או 5xx אצל הספק יכולים לקרות אחרי שההודעה כבר
       * נקלטה אצלו ויצאה. מסך שאומר "נכשל" מזמין שליחה חוזרת,
       * והפונה מקבל את אותה תשובה פעמיים.
       */
      const sent = (await res.json().catch(() => null)) as { state?: string } | null;
      setReply("");
      if (fileInput.current) fileInput.current.value = "";
      /*
       * ‎**ההודעה נקבעת אחרי הטעינה מחדש, לא לפניה.** `openThread`
       * פותח ב-`setNotice(null)`, ולכן אזהרה שנכתבה לפניו נמחקה
       * לפני שהספיקה להיראות — והתשובה נראתה ככל תשובה שנשלחה,
       * בהזמנה לשלוח שוב לנמען שאולי כבר קיבל (ביקורת Codex).
       * אותו תיקון בדיוק כמו בתיבת הלקוחות.
       */
      const threadId = open.id;
      await openThread(threadId);
      // עבר בינתיים לשרשור אחר — האזהרה שייכת לזה שממנו נשלח
      if (openRef.current === threadId) {
        setNotice(
          sent?.state === "unknown"
            ? {
                tone: "danger",
                text: "לא התקבל אישור מספק הדואר — ייתכן שהתשובה יצאה. בדקו לפני שליחה חוזרת.",
              }
            : { tone: "success", text: "התשובה נשלחה" },
        );
      }
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "השליחה נכשלה" });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "open" | "closed"): Promise<void> {
    if (open === null) return;
    setBusy(true);
    try {
      await apiPost(`/platform/support/inbox/${open.id}/status`, { status });
      await openThread(open.id);
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "העדכון נכשל" });
    } finally {
      setBusy(false);
    }
  }

  if (threads === null || threads.length === 0) return null;

  return (
    <section
      aria-labelledby="support-inbox-heading"
      id="support-inbox"
      className="mb-8 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h2 id="support-inbox-heading" className="mb-1 text-lg font-semibold">
        <IconMail s={16} /> תיבת התמיכה
      </h2>
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        פניות שהגיעו במייל לכתובת התמיכה. התשובה יוצאת מכתובת המערכת, ותשובת
        הפונה חוזרת לאותו שרשור.
      </p>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <ul className="mb-4 flex flex-col gap-2">
        {threads.map((thread) => (
          <li key={thread.id}>
            <button
              type="button"
              className="w-full rounded-lg border p-3 text-start text-sm"
              style={{
                // גבול של פקד ולא של כרטיס: השורה כאן היא כפתור
                borderColor: thread.unread ? "var(--color-primary)" : "var(--color-input-border)",
                background: "var(--color-bg)",
              }}
              onClick={() => void openThread(thread.id)}
            >
              <span className="flex flex-wrap items-center gap-2">
                <b>{thread.contactName}</b>
                {thread.tenantName !== null ? (
                  <span className="mv-tag">{thread.tenantName}</span>
                ) : (
                  <span className="mv-tag" style={{ color: "var(--color-text-muted)" }}>
                    לא לקוח
                  </span>
                )}
                {thread.unread ? (
                  <span className="mv-tag" style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}>
                    חדש
                  </span>
                ) : null}
                {thread.status === "closed" ? (
                  <span className="mv-tag" style={{ color: "var(--color-text-muted)" }}>
                    סגור
                  </span>
                ) : null}
                <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
                  {formatDateTime(thread.lastMessageAt)}
                </span>
              </span>
              <span className="mt-1 block truncate">{thread.subject}</span>
            </button>
          </li>
        ))}
      </ul>

      {open !== null ? (
        <div
          className="rounded-xl border p-3"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <b>{open.subject}</b>
            <span dir="ltr" style={{ color: "var(--color-text-muted)" }}>
              {open.contactEmail ?? "בלי כתובת"}
            </span>
            <Button
              variant="ghost"
              className="ms-auto"
              disabled={busy}
              onClick={() => void setStatus(open.status === "closed" ? "open" : "closed")}
            >
              {open.status === "closed" ? "פתח מחדש" : "סגור פנייה"}
            </Button>
          </div>

          <ol className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
            {open.messages.map((message) => (
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
                <p className="m-0 mt-1 text-[length:var(--type-caption-lg)]" style={{ color: "var(--color-text-muted)" }}>
                  {message.direction === "out" ? "תשובת התמיכה" : open.contactName} ·{" "}
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

          {open.contactEmail !== null ? (
            <>
              <label htmlFor="support-reply" className="mb-1 block text-sm font-medium">
                תשובה
              </label>
              <textarea
                id="support-reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
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
        </div>
      ) : null}
    </section>
  );
}
