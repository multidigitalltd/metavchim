"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { Notice } from "../notice";

/**
 * תיבת המייל הפנימית — תשובות של לקוחות למיילים שהמערכת שלחה.
 *
 * התיבה משותפת לכל המשרד (כמו מספר הוואטסאפ המשרדי): שיחה אחת לכל
 * לקוח, החדשה למעלה, שלא-נקראו מודגשות. פתיחת שיחה מסמנת כנקראה,
 * והתשובה נשלחת מכתובת המשרד ונרשמת בציר הלקוח — התיעוד הוא
 * הסיבה לענות מכאן ולא מתיבת המייל הפרטית.
 */

interface ThreadRow {
  contactId: string;
  contactName: string;
  lastSubject: string;
  lastSnippet: string;
  lastDirection: string;
  lastAt: string;
  unread: number;
  buyerId?: string;
}

interface Attachment {
  id: string;
  name: string;
  kind: string;
  contentType: string;
  sizeBytes: number;
}

interface Message {
  id: string;
  direction: string;
  subject: string;
  body: string;
  fromEmail?: string;
  /** ‏pending | sent | failed — ביוצאות בלבד. */
  sendState?: string;
  createdAt: string;
  attachments: Attachment[];
}

/**
 * ‎**תשובה שלא יצאה חייבת להיראות אחרת.**
 *
 * השרת כותב את ההודעה לפני השליחה ומאשר אחריה, כדי שכשל לא ימחק כל
 * זכר להודעה שהלקוח כבר קיבל. אם המסך יציג את השורה כמו כל שורה
 * אחרת, כל התיקון הזה נעצר צעד לפני מי שצריך לדעת — הסוכן יראה
 * „נשלח” על משהו שלא נשלח.
 *
 * ‎`sent` וההודעות הנכנסות אינן מקבלות תווית: מצב תקין אינו הודעה.
 */
function sendStateNote(state: string | undefined): { text: string; token: string } | null {
  if (state === "failed") return { text: "לא נשלחה", token: "--color-danger" };
  if (state === "pending") return { text: "בשליחה…", token: "--color-text-muted" };
  return null;
}

/** ‏1.2MB ⟵ "1.2MB"; 850KB ⟵ "850KB" — לתווית ההורדה. */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** התצוגה לפי הסוג שהוכרע בקליטה: תמונה בפנים, וידאו בנגן, מסמך כהורדה. */
function AttachmentView({ attachment }: { attachment: Attachment }) {
  const src = `${API_BASE}/email-inbox/attachments/${attachment.id}/raw`;
  if (attachment.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer">
        <img
          src={src}
          alt={attachment.name}
          className="max-h-48 rounded-lg border"
          style={{ borderColor: "var(--color-border)", maxWidth: "100%" }}
        />
      </a>
    );
  }
  if (attachment.kind === "video") {
    return (
      // וידאו שלקוח צירף למייל — אין לו כתוביות; ההקשר מוסבר בטקסט ההודעה
      <video src={src} controls className="max-h-48 rounded-lg" style={{ maxWidth: "100%" }} />
    );
  }
  return (
    <a href={src} className="underline" download={attachment.name}>
      📎 {attachment.name} ({formatBytes(attachment.sizeBytes)})
    </a>
  );
}

export default function InboxPage() {
  const { loading: authLoading } = useRequireAuth();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContact, setOpenContact] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sendState, setSendState] = useState<"idle" | "sending" | "failed">("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<ThreadRow[]>("/email-inbox")
      .then(setThreads)
      .catch(() => setError("טעינת התיבה נכשלה"));
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  async function openThread(contactId: string) {
    setOpenContact(contactId);
    setMessages(null);
    setReply("");
    setFiles([]);
    setSendState("idle");
    setSendError(null);
    try {
      const thread = await apiGet<{ messages: Message[] }>(`/email-inbox/${contactId}`);
      setMessages(thread.messages);
      // הכניסה לשיחה היא הקריאה — התג יורד מהסרגל ומהרשימה
      await apiPost(`/email-inbox/${contactId}/read`, {});
      setThreads(
        (rows) => rows?.map((r) => (r.contactId === contactId ? { ...r, unread: 0 } : r)) ?? null,
      );
    } catch {
      setError("טעינת השיחה נכשלה");
    }
  }

  async function sendReply() {
    if (openContact === null || (reply.trim() === "" && files.length === 0)) return;
    setSendState("sending");
    setSendError(null);
    try {
      // multipart — בלי Content-Type ידני; הדפדפן קובע boundary
      const form = new FormData();
      form.append("body", reply.trim());
      for (const file of files) form.append("files", file);
      const res = await fetch(`${API_BASE}/email-inbox/${openContact}/reply`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(errBody?.message ?? "השליחה נכשלה");
      }
      setReply("");
      setFiles([]);
      setSendState("idle");
      await openThread(openContact);
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "השליחה נכשלה — נסו שוב.");
      setSendState("failed");
    }
  }

  return (
    <>
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <h1 className="m-0" style={{ fontSize: "var(--type-panel)", fontWeight: 800 }}>
          תיבת מייל
        </h1>
        <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
          תשובות של לקוחות למיילים שנשלחו מהמערכת. התשובה שלכם נשלחת
          מכתובת המשרד ונרשמת בציר הלקוח.
        </p>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {threads === null ? (
        <p aria-live="polite">טוען את התיבה…</p>
      ) : threads.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="mb-2 text-lg font-semibold">התיבה ריקה</p>
          <p style={{ color: "var(--color-text-muted)" }}>
            כשלקוח יענה למייל שנשלח מהמערכת — הצעה או הסכם — התשובה
            תופיע כאן ובציר הלקוח.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {threads.map((thread) => {
            const open = openContact === thread.contactId;
            return (
              <li
                key={thread.contactId}
                className="rounded-xl border"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-surface)",
                }}
              >
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 p-3 text-start"
                  aria-expanded={open}
                  onClick={() => (open ? setOpenContact(null) : void openThread(thread.contactId))}
                >
                  <span className="font-bold">{thread.contactName}</span>
                  {thread.unread > 0 ? (
                    <span className="mv-nav-badge">{thread.unread}</span>
                  ) : null}
                  <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {thread.lastSubject}
                  </span>
                  <span className="ms-auto text-sm" style={{ color: "var(--color-text-muted)" }}>
                    {formatDateTime(thread.lastAt)}
                  </span>
                </button>
                {open ? (
                  <div className="border-t p-3" style={{ borderColor: "var(--color-border)" }}>
                    {messages === null ? (
                      <p aria-live="polite">טוען שיחה…</p>
                    ) : (
                      <ul className="mb-3 flex flex-col gap-2">
                        {messages.map((message) => (
                          <li
                            key={message.id}
                            className="max-w-[85%] rounded-lg border p-2.5 text-sm whitespace-pre-wrap"
                            style={
                              message.direction === "in"
                                ? { borderColor: "var(--color-border)", background: "var(--color-bg)" }
                                : {
                                    borderColor: "var(--color-border)",
                                    background: "var(--color-surface)",
                                    marginInlineStart: "auto",
                                  }
                            }
                          >
                            <p className="mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
                              {message.direction === "in" ? "הלקוח" : "המשרד"} ·{" "}
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
                            {message.body !== "" ? message.body : null}
                            {message.attachments.length > 0 ? (
                              <span className="mt-2 flex flex-col gap-2">
                                {message.attachments.map((attachment) => (
                                  <AttachmentView key={attachment.id} attachment={attachment} />
                                ))}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {thread.buyerId !== undefined ? (
                      <p className="mb-2 text-sm">
                        <Link href={`/buyers/${thread.buyerId}`} className="underline">
                          לכרטיס הלקוח
                        </Link>
                      </p>
                    ) : null}
                    <label className="block">
                      <span className="mv-visually-hidden">תשובה ללקוח</span>
                      <textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        rows={3}
                        maxLength={5000}
                        placeholder="כתבו תשובה — היא תישלח במייל מכתובת המשרד"
                        className="mb-2 w-full rounded-lg border px-3 py-2.5"
                        style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
                      />
                    </label>
                    <label className="mb-2 block text-sm">
                      <span className="mv-visually-hidden">צירוף קבצים</span>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                        onChange={(e) => setFiles([...(e.target.files ?? [])])}
                      />
                    </label>
                    {files.length > 0 ? (
                      <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                        {files.length} קבצים מצורפים ·{" "}
                        {formatBytes(files.reduce((sum, f) => sum + f.size, 0))} (עד 7MB בהודעה)
                      </p>
                    ) : null}
                    {sendState === "failed" ? (
                      <Notice tone="danger">{sendError ?? "השליחה נכשלה — נסו שוב."}</Notice>
                    ) : null}
                    <Button
                      onClick={() => void sendReply()}
                      disabled={sendState === "sending" || (reply.trim() === "" && files.length === 0)}
                    >
                      {sendState === "sending" ? "שולח…" : "שליחת תשובה במייל"}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
