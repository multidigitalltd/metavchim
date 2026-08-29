"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet, apiList, apiPost } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { Notice } from "../notice";
import { OfficeDomainNudge } from "../office-domain-nudge";

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
 * ‎**תשובה שלא יצאה חייבת להיראות אחרת — ו„לא ידוע” אינו „לא”.**
 *
 * השרת כותב את ההודעה לפני השליחה ומאשר אחריה, כדי שכשל לא ימחק כל
 * זכר להודעה שהלקוח כבר קיבל. אם המסך יציג את השורה כמו כל שורה
 * אחרת, כל התיקון נעצר צעד לפני מי שצריך לדעת.
 *
 * ‎**שלושה מצבים ולא שניים.** „נכשלה” נאמר רק כשהספק **ענה ודחה**,
 * כלומר ידוע שההודעה לא יצאה ושליחה חוזרת בטוחה. פסק זמן או ‎5xx הם
 * „איננו יודעים”: ייתכן שהיא כן יצאה, ו„לא נשלחה” שם היה שולח את
 * הסוכן לשלוח שוב וללקוח להגיע אותה הודעה פעמיים.
 *
 * ‎`sent` וההודעות הנכנסות אינן מקבלות תווית: מצב תקין אינו הודעה.
 *
 * ‎**ו„בשליחה…” שאינו נגמר הוא שקר שקט.** השליחה היא בתוך בקשה אחת
 * ואורכת שניות. אם השרת נפל בין כתיבת השורה לקריאה לספק, או שסימון
 * המצב אחרי שליחה מוצלחת נכשל, הרשומה נשארת `pending` — ואין תהליך
 * רקע שסוגר אותה (ביקורת Codex). שורה כזו אינה „בדרך”: היא תקועה,
 * ו**זמן** הוא מה שמבדיל בין השתיים.
 *
 * מעבר לסף היא נקראת כמו `unknown`, ובאותן מילים — כי הפעולה
 * הנדרשת מהסוכן זהה: לבדוק לפני שליחה חוזרת. „כנראה לא יצאה” אינו
 * „לא יצאה”, וזו אותה טעות שכבר תוקנה כאן פעמיים.
 */
const STALE_PENDING_MS = 5 * 60 * 1000;
const UNKNOWN_NOTE = {
  text: "לא ידוע אם נשלחה — בדקו לפני שליחה חוזרת",
  token: "--color-danger",
} as const;

/**
 * הרגע שבו שורה ממתינה מפסיקה להיות „בדרך”. `NaN` אם החותמת אינה
 * נקראת.
 *
 * ‎**כמה זמן עבר — לא באיזו שעה.** שתי נקודות בזמן מוחלט והפרש
 * ביניהן. `createdAt` הוא ISO-8601 עם היסט, ולכן הפרסור אינו תלוי
 * באזור הזמן של המכשיר; רק **השעון** שלו נקרא, ושעון נכון הוא נכון
 * בכל אזור. אין כאן שעת קיר, אין „היום”, ואין גבול יום ישראלי —
 * הפיכת ההפרש לשעון ישראל לא הייתה משנה בו דבר.
 *
 * במקום אחד, כי שני קוראים צריכים בדיוק את אותו מספר: התווית
 * שמחליטה מה להציג, והתזמון שמעיר את המסך ברגע החצייה.
 */
function stalePendingDeadline(createdAt: string): number {
  return Date.parse(createdAt) + STALE_PENDING_MS; /* שעון-המכשיר-במכוון: זמן מוחלט */
}

function sendStateNote(
  state: string | undefined,
  createdAt: string,
  now: number,
): { text: string; token: string } | null {
  if (state === "failed") return { text: "לא נשלחה", token: "--color-danger" };
  if (state === "unknown") return { ...UNKNOWN_NOTE };
  if (state === "pending") {
    const deadline = stalePendingDeadline(createdAt);
    // חותמת שאינה נקראת אינה סיבה להסתיר אזהרה
    if (Number.isNaN(deadline) || deadline <= now) return { ...UNKNOWN_NOTE };
    return { text: "בשליחה…", token: "--color-text-muted" };
  }
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
  const { user, loading: authLoading } = useRequireAuth();
  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openContact, setOpenContact] = useState<string | null>(null);
  /*
   * ‎**השיחה הפתוחה, לקריאה אחרי `await`.** אותה סיבה כמו ב-`ref`
   * של שולחן החיבורים: המשך שרץ בסגור של רינדור קודם קורא ערך ישן
   * מ-`state` מעצם הגדרתו, ואזהרה שנכתבת אחרי טעינה מחדש חייבת
   * לדעת אם הסוכן כבר עבר לשיחה אחרת.
   */
  const openRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sendState, setSendState] = useState<"idle" | "sending" | "failed" | "unknown">("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  /*
   * ‎**השעה שלפיה נקראת ההמתנה — כ-state, לא כקריאה ברינדור.**
   *
   * ‎`Date.now()` בתוך הרינדור נקרא **פעם אחת**, ברינדור עצמו; זמן
   * שעובר אינו מרנדר רכיב מחדש. שורה `pending` שנטענה בגיל עשר
   * שניות הייתה נשארת „בשליחה…” כל עוד השיחה פתוחה, גם שעה אחרי
   * שחצתה את הסף (ביקורת Codex) — כלומר הסף שהוספתי בקומיט הקודם
   * לא היה מתקיים כלל במסך שנשאר פתוח.
   */
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    apiGet<ThreadRow[]>("/email-inbox")
      .then(setThreads)
      .catch(() => setError("טעינת התיבה נכשלה"));
  }, []);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  /*
   * ‎**רינדור אחד לכל מועד חצייה, ולא טיקטוק מתמיד.**
   *
   * המועד ידוע מראש — `createdAt` ועוד הסף — ולכן אין צורך בשעון
   * שרץ: מספיק להעיר את המסך בדיוק ברגע שבו „בשליחה…” מפסיק להיות
   * נכון. אחרי ההערה `now` מתקדם, האפקט רץ שוב, וסופר את המועדים
   * שטרם נחצו; כשלא נשאר אף אחד — אין תזמון, והמסך שוקט.
   *
   * ‎`now` מרוענן גם ב-`openThread` ברגע שרשימה חדשה נכנסת, אחרת
   * מסך שנשאר פתוח שעה היה מחשב את התזמון מול שעה ישנה.
   */
  useEffect(() => {
    const deadlines = (messages ?? [])
      .filter((message) => message.sendState === "pending")
      .map((message) => stalePendingDeadline(message.createdAt))
      .filter((deadline) => !Number.isNaN(deadline) && deadline > now);
    if (deadlines.length === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...deadlines) - now + 500);
    return () => clearTimeout(timer);
  }, [messages, now]);

  async function openThread(contactId: string) {
    openRef.current = contactId;
    setOpenContact(contactId);
    setMessages(null);
    setReply("");
    setFiles([]);
    setSendState("idle");
    setSendError(null);
    try {
      const thread = await apiGet<{ messages: Message[] }>(`/email-inbox/${contactId}`);
      setMessages(apiList(thread.messages, "messages"));
      // רשימה חדשה — גם השעה שלפיה נמדדת ההמתנה, אחרת התזמון נבנה מול ערך ישן
      setNow(Date.now());
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
      /*
       * ‎**תוצאה עמומה אינה שגיאה, וגם אינה „נשלח”.**
       *
       * כשהספק לא ענה ייתכן שההודעה כן יצאה. השרת שומר אותה במצב
       * „לא ידוע” — ולכן הטיוטה **נמחקת** והשיחה נטענת מחדש, בדיוק
       * כמו בשליחה מוצלחת: כך הסוכן רואה את השורה ואת האזהרה שעליה,
       * במקום כפתור „נסו שוב” שיביא ללקוח את אותה הודעה פעמיים.
       *
       * ‎**והמצב נקבע אחרי הטעינה מחדש, לא לפניה.** `openThread`
       * מאפס את מצב השליחה כחלק מפתיחת שיחה, ולכן „לא ידוע” שנכתב
       * לפניו נמחק לפני שהספיק להיראות. בדרך התקינה השורה שנטענה
       * נושאת את האזהרה בעצמה — אבל אם **הטעינה** נכשלה, הטיוטה
       * כבר נמחקה והסוכן לא רואה לא שורה ולא אזהרה, ושולח שוב
       * (ביקורת Codex). זו הפעם השלישית שהתיקון של המצב הזה נעצר
       * צעד לפני מי שצריך לדעת, ולכן הוא נכתב עכשיו **אחרון**.
       */
      const okBody = (await res.json().catch(() => null)) as { state?: string } | null;
      setReply("");
      setFiles([]);
      await openThread(openContact);
      // הסוכן עבר בינתיים לשיחה אחרת — האזהרה שייכת לשיחה שנשלחה
      if (openRef.current === openContact) {
        setSendState(okBody?.state === "unknown" ? "unknown" : "idle");
      }
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

      <OfficeDomainNudge user={user} />

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
                  onClick={() => {
                    if (!open) return void openThread(thread.contactId);
                    openRef.current = null;
                    setOpenContact(null);
                  }}
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
                                const note = sendStateNote(
                                  message.sendState,
                                  message.createdAt,
                                  now,
                                );
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
                    {sendState === "unknown" ? (
                      <Notice tone="danger">
                        ספק הדואר לא אישר את השליחה, וייתכן שההודעה בכל זאת הגיעה
                        ללקוח. היא מסומנת „לא ידוע אם נשלחה” בשיחה — בדקו מולו
                        לפני שליחה חוזרת.
                      </Notice>
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
