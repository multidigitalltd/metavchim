"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost } from "@/lib/api";
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

interface Message {
  id: string;
  direction: string;
  subject: string;
  body: string;
  fromEmail?: string;
  createdAt: string;
}

export default function InboxPage() {
  const { loading: authLoading } = useRequireAuth();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContact, setOpenContact] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "failed">("idle");

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
    setSendState("idle");
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
    if (openContact === null || reply.trim() === "") return;
    setSendState("sending");
    try {
      await apiPost(`/email-inbox/${openContact}/reply`, { body: reply.trim() });
      setReply("");
      setSendState("idle");
      await openThread(openContact);
      load();
    } catch {
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
                            </p>
                            {message.body}
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
                    {sendState === "failed" ? (
                      <Notice tone="danger">השליחה נכשלה — נסו שוב.</Notice>
                    ) : null}
                    <Button
                      onClick={() => void sendReply()}
                      disabled={sendState === "sending" || reply.trim() === ""}
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
