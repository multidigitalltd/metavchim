"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import {
  formatSupportReference,
  matchesSupportFilter,
  openSupportCount,
  searchSupportQueue,
  SUPPORT_KIND_LABEL,
  SUPPORT_QUEUE_FILTER_LABEL,
  SUPPORT_QUEUE_FILTERS,
  supportQueueCounts,
  SUPPORT_SEVERITY_LABEL,
  SUPPORT_SOURCE_LABEL,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABEL,
  type SupportContext,
  type SupportKind,
  type SupportQueueFilter,
  type SupportQueueRow,
  type SupportSeverity,
  type SupportStatus,
} from "@metavchim/shared";
import { API_BASE, ApiError, apiGet, apiPost } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { IconMail } from "../icons";
import { SearchField } from "../list-controls";
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

/*
 * ‎**„ממתינות” היא ברירת המחדל, ולא „נפתחה”** — והכלל עצמו ירד
 * ל-`packages/shared` (‏`matchesSupportFilter`). הוא נשאר כאן כל עוד
 * היה לו קורא אחד; ברגע שנולד לו שני — המספר שעל כל לשונית — שני
 * מימושים היו נפרדים בדיוק בלידת המצב הבא, והלשונית הייתה מבטיחה
 * שבע ופותחת חמש.
 *
 * ‎**וכמה זמן מרענן.** השולחן פתוח כשמישהו יושב מולו, ופנייה שנכנסה
 * בינתיים לא הופיעה עד רענון ידני. הסקר מותנה בכך שהלשונית גלויה:
 * טאב ברקע אינו מקום שצריך לעדכן.
 */
const REFRESH_MS = 45_000;

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

/** הודעה בשיחה — אותה צורה לשני המקורות, ולכן רכיב אחד מציג אותן. */
interface ConversationMessage {
  id: string;
  direction: string;
  body: string;
  createdAt: string;
  /** ‏pending | sent | failed | unknown — ביוצאות בלבד. */
  sendState?: string | null;
  attachments: { id: string; name: string; kind: string; sizeBytes: number }[];
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
  /** ריק כשלא היה טלפון בפרופיל. */
  userPhone: string | null;
  tenantId: string;
  tenantName: string;
  context: SupportContext;
  messages: ConversationMessage[];
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

/**
 * ‎**השיחה — רכיב אחד לשני מקורות הפניות.**
 *
 * עד עכשיו שרשור מייל הוצג כשיחה מלאה, ופנייה מהכפתור כשורת „נענה:”
 * עם מה שנכתב לאחרונה. זה לא היה הבדל בתצוגה אלא במבנה: לפנייה
 * מהכפתור באמת הייתה תשובה **אחת**, שתשובה שנייה דרסה. מרגע
 * שלשתיהן יש הודעות, אין סיבה לשני רכיבים — ורכיב אחד הוא גם מה
 * שמונע מהם להיפרד שוב.
 */
function Conversation({
  messages,
  incomingLabel,
  attachmentBase,
}: {
  messages: readonly ConversationMessage[];
  /** מי כתב את הנכנסות — שם הפונה. */
  incomingLabel: string;
  /** הנתיב שממנו נמשכים הצירופים; שונה בין המקורות. */
  attachmentBase: string;
}) {
  if (messages.length === 0) return null;
  return (
    <ol className="m-0 mb-3 flex list-none flex-col gap-2 p-0">
      {messages.map((message) => (
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
                    href={`${attachmentBase}/${attachment.id}/raw`}
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
            {message.direction === "out" ? "תשובת התמיכה" : incomingLabel} ·{" "}
            {formatDateTime(message.createdAt)}
            {(() => {
              /*
               * ‎**יוצאת בלי מצב היא „לא ידוע”, ולא „נשלחה”.**
               *
               * המיגרציה שמרה `NULL` על תשובות היסטוריות בכוונה —
               * איננו יודעים אם הן יצאו. תרגום של `NULL` ל„בלי
               * תווית” הציג אותן בדיוק כמו שליחה מאושרת, כלומר
               * הנציח את ההנחה שהמיגרציה סירבה לעשות (ביקורת
               * Codex). נכנסת נשארת בלי תווית: אין בה מה לשלוח.
               */
              const note = sendStateNote(
                message.direction === "out" ? (message.sendState ?? "unknown") : undefined,
              );
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
  );
}

/** סוגי הקבצים שהתמיכה יכולה לצרף — זהה בשני המסלולים. */
const ATTACH_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm," +
  "application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv";

/**
 * תיבת המענה.
 *
 * ‎`rows={4}` ולא 2: תשובת תמיכה אמיתית היא פסקה, ותיבה בגובה שתי
 * שורות אומרת „כתוב משפט” — וזה מה שנכתב בה.
 */
function Composer({
  id,
  value,
  onChange,
  fileInput,
  busy,
  onSend,
  children,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  fileInput: React.RefObject<HTMLInputElement | null>;
  busy: boolean;
  onSend: () => void;
  /** פעולות נוספות לצד הכפתור — למשל קביעת סטטוס. */
  children?: React.ReactNode;
}) {
  return (
    <>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        תשובה
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        /*
         * ‎**Ctrl/⌘+Enter שולח.** תשובה קצרה היא הרוב, והמסלול
         * ‎„כתוב, קח את העכבר, מצא את הכפתור” חוזר על עצמו עשרות
         * פעמים ביום. `Enter` לבדו נשאר שורה חדשה: תשובת תמיכה היא
         * פסקה, ושליחה בטעות באמצע משפט גרועה מלחיצה נוספת.
         */
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !busy) {
            event.preventDefault();
            onSend();
          }
        }}
        rows={4}
        className="mb-2 w-full rounded-lg border px-3 py-2"
        style={{ borderColor: "var(--color-input-border)", background: "var(--color-field)" }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple accept={ATTACH_ACCEPT} className="text-sm" />
        <Button disabled={busy} onClick={onSend}>
          {busy ? "שולח…" : "שלח תשובה"}
        </Button>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          עד 7MB קבצים בהודעה · ‎Ctrl+Enter שולח
        </span>
        {children}
      </div>
    </>
  );
}

export function SupportQueueSection() {
  const [rows, setRows] = useState<SupportQueueRow[] | null>(null);
  const [filter, setFilter] = useState<SupportQueueFilter>("waiting");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SupportQueueRow | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<SupportQueueRow[]>("/platform/support/queue")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  /*
   * ‎**רענון שקט — כדי שפנייה שנכנסה תופיע בלי לרענן דף.**
   *
   * זה המסך שיושבים מולו, ועד עכשיו הוא הציג את מה שהיה בו ברגע
   * הטעינה. הפנייה הגיעה, ההתראה במייל יצאה — והמסך הפתוח המשיך
   * לומר „אין פניות בסינון הזה”.
   *
   * ‎`document.hidden` בתנאי: טאב ברקע אינו מקום שצריך לעדכן, וסקר
   * שרץ בכל הטאבים הפתוחים הוא עומס בלי קורא. הרשימה מתחלפת מתחת
   * לכרטיס הפתוח בלי להרוס אותו — הוא מזוהה ב-`key` לפי מזהה
   * הפנייה, ולכן הטיוטה שבתוכו שורדת.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

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
      /*
       * ‎**פנייה שנסגרה מתקפלת.** היא כבר אינה מה שמטפלים בו, וכרטיס
       * פתוח שנשאר פתוח דוחף את הפנייה הבאה מתחת לקפל — כלומר כל
       * סגירה עולה לחיצה נוספת רק כדי לחזור לרשימה.
       */
      setSelected((current) =>
        current === null || current.id !== row.id
          ? current
          : status === "closed"
            ? null
            : { ...current, status },
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

  /*
   * הסינון קודם לחיפוש: „ממתינות” היא ההקשר, והחיפוש מצמצם בתוכו.
   * הסדר ההפוך היה מציג תוצאה מלשונית אחרת מזו שסומנה.
   */
  const shown = searchSupportQueue(
    rows.filter((row) => matchesSupportFilter(row, filter)),
    query,
  );
  const waiting = openSupportCount(rows);
  /* המספרים נספרים על התור המלא — לשונית שסופרת את עצמה אינה מידע */
  const counts = supportQueueCounts(rows);

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

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SUPPORT_QUEUE_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            className="mv-chip"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {/*
              ‎**המספר על הלשונית עצמה.** בלעדיו „בטיפול” היא ניחוש:
              צריך ללחוץ כדי לגלות שהיא ריקה, ואז ללחוץ חזרה. שלוש
              לשוניות פירושן שלוש לחיצות רק כדי לדעת מה יש.
            */}
            {SUPPORT_QUEUE_FILTER_LABEL[value]} ({counts[value]})
          </button>
        ))}
        {/*
          ‎**חיפוש — הרגע השכיח ביותר מול השולחן.**

          ‏„הלקוח מתקשר ושואל מה עם הפנייה שלו”. עד עכשיו הדרך היחידה
          למצוא אותה הייתה גלילה, ועם מאה שורות זו לא דרך. החיפוש עובר
          על מספר הפנייה, השם, הכתובת, הטלפון, שם המשרד וטקסט הפנייה —
          כלומר על כל מה שהמתקשר יכול למסור.
        */}
        <div className="ms-auto">
          <SearchField
            label="חיפוש בתור התמיכה"
            placeholder="מספר פנייה, שם או טלפון"
            value={query}
            onChange={setQuery}
          />
        </div>
      </div>

      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      {shown.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>
          {query.trim() === ""
            ? "אין פניות בסינון הזה."
            : `לא נמצאה פנייה שמתאימה ל„${query.trim()}” בסינון הזה.`}
        </p>
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
                    {/*
                      ‎**חומרה על השורה, ולא מאחורי לחיצה.**

                      ‏„חוסם עבודה” פירושו שמישהו עומד **עכשיו** מול
                      מסך שאינו עובד. הוא היה קריא רק אחרי פתיחת
                      הפנייה, כלומר תקלה חוסמת נראתה בתור בדיוק כמו
                      בקשת שיפור — ומי שמטפל היה צריך לפתוח את כולן
                      כדי לדעת במה להתחיל.

                      רק „חוסם” מסומן: תג על כל שורה אינו סימון אלא
                      רעש, ומה שמסמן הכול אינו מסמן דבר.
                    */}
                    {row.severity === "blocking" ? (
                      <b style={{ color: "var(--color-danger)" }}>
                        {SUPPORT_SEVERITY_LABEL.blocking}
                      </b>
                    ) : null}
                    {row.kind !== null ? (
                      <span className="mv-tag" style={{ color: "var(--color-text-muted)" }}>
                        {SUPPORT_KIND_LABEL[row.kind]}
                      </span>
                    ) : null}
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
                    {/*
                      ‎**„לפני 3 שעות” ולא „30 באוגוסט, 10:14”.**

                      השאלה היחידה שנשאלת על הזמן בתור הזה היא „כמה
                      זמן זה מחכה”, ותאריך מלא מחייב את מי שקורא לחשב
                      אותה בעצמו — מאה פעם בגלילה אחת. התאריך המדויק
                      נשאר ב-`title`, במרחק ריחוף.
                    */}
                    <span
                      className="ms-auto"
                      style={{ color: "var(--color-text-muted)" }}
                      title={formatDateTime(row.lastActivityAt)}
                    >
                      {timeAgo(row.lastActivityAt)}
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
                      <ThreadDetail
                        key={row.id}
                        threadId={row.id}
                        wasUnread={row.unread}
                        onChanged={load}
                      />
                    ) : (
                      <TicketDetail
                        key={row.id}
                        ticketId={row.id}
                        onChanged={load}
                        /*
                          ‎**ההודעה עוברת להורה, כי הילד נעלם.**

                          ‏„התשובה נשלחה” נכתבה ב-`TicketDetail`
                          ומוצגת בתוכו — וקיפול הכרטיס מפרק אותו,
                          כלומר מוחק את האישור באותו רגע שבו הוא
                          נכתב. מי ששלח וסגר היה רואה את הכרטיס
                          נעלם בלי לדעת אם התשובה יצאה.
                        */
                        onClosed={() => {
                          setSelected(null);
                          setNotice({ tone: "success", text: "התשובה נשלחה והפנייה נסגרה" });
                        }}
                      />
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
function ThreadDetail({
  threadId,
  wasUnread,
  onChanged,
}: {
  threadId: string;
  /** האם השורה נשאה „חדש” ברגע הפתיחה — קובע אם צריך לרענן אחריה. */
  wasUnread: boolean;
  onChanged: () => void;
}) {
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
    /*
     * ‎**הפתיחה עצמה מסמנת „נקרא” בשרת — והשורה לא ידעה על כך.**
     *
     * הקריאה הזאת היא שכותבת `readAt`, ולכן הרגע שאחריה הוא הרגע
     * שבו התג „חדש” על השורה הפך לשקר. בלי רענון הוא נשאר עד
     * לפעולה אחרת או רענון דף — כלומר המונה „ממתינות” והתג מספרים
     * משהו שכבר לא נכון (ביקורת Codex).
     *
     * ‎`wasUnread` ולא רענון תמידי: פתיחה של שרשור שכבר נקרא אינה
     * משנה דבר בשרת, ושאילתה על כל לחיצה היא רעש.
     */
    void open().then(() => {
      if (wasUnread) onChanged();
    });
    // `onChanged`/`wasUnread` אינם מפעילים פתיחה מחדש — רק `open` כן
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      <Conversation
        messages={view.messages}
        incomingLabel={view.contactName}
        attachmentBase={`${API_BASE}/platform/support/inbox/attachments`}
      />

      {view.contactEmail !== null ? (
        <>
          <Composer
            id={`support-reply-${view.id}`}
            value={reply}
            onChange={setReply}
            fileInput={fileInput}
            busy={busy}
            onSend={() => void send()}
          />
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
/**
 * פנייה מהכפתור — **שיחה, ולא „התשובה האחרונה”.**
 *
 * ## מה הוצג כאן קודם
 *
 * הפנייה, ההקשר הטכני, ואז שורה אחת: „נענה: …” עם מה שנכתב
 * לאחרונה. תיבת המענה הייתה בגובה שתי שורות ובלי צירוף קבצים, ולא
 * היה שום סימן אם התשובה בכלל יצאה — כי לא הייתה שורה שאפשר לסמן
 * עליה. השליחה נבלעה ב-`catch`, והמסך הציג „נענה” גם על מייל
 * שנדחה.
 *
 * עכשיו זה אותו רכיב שיחה של שרשורי המייל, עם אותה תווית „לא
 * נשלחה” ואותה תיבת מענה. מה שנשאר שונה הוא מה שבאמת שונה: ההקשר
 * הטכני, צילום המסך, והטלפון של מי שפנה.
 */
function TicketDetail({
  ticketId,
  onChanged,
  onClosed,
}: {
  ticketId: string;
  onChanged: () => void;
  /** „שליחה וסגירה” מקפלת את הכרטיס — הפנייה כבר אינה מה שמטפלים בו. */
  onClosed: () => void;
}) {
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    apiGet<AdminTicket>(`/platform/support/tickets/${ticketId}`)
      .then(setTicket)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : "הפתיחה נכשלה"),
      );
  }, [ticketId]);

  useEffect(load, [load]);

  async function sendReply(close: boolean): Promise<void> {
    const files = fileInput.current?.files;
    const hasFiles = files !== null && files !== undefined && files.length > 0;
    if (draft.trim() === "" && !hasFiles) return;
    setBusy(true);
    setNotice(null);
    try {
      /*
       * ‎`FormData` ולא JSON: הצירופים נוסעים באותה בקשה כמו
       * התשובה. שתי בקשות היו יוצרות מצב שבו הקבצים נשמרו והמייל
       * לא יצא — או להפך.
       */
      const form = new FormData();
      form.append("reply", draft.trim());
      if (close) form.append("status", "closed");
      for (const file of files ?? []) form.append("files", file);
      const res = await fetch(`${API_BASE}/platform/support/tickets/${ticketId}`, {
        method: "PATCH",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(res.status, problem?.message ?? "השליחה נכשלה", []);
      }
      const sent = (await res.json().catch(() => null)) as { state?: string } | null;
      setDraft("");
      if (fileInput.current) fileInput.current.value = "";
      load();
      onChanged();
      /*
       * ‎**„לא ידוע” אינו „נשלח”.** תוצאה עמומה מהספק מוצגת
       * כאזהרה ולא כהצלחה, אחרת שולחים שוב לנמען שאולי כבר קיבל.
       */
      setNotice(
        sent?.state === "unknown"
          ? {
              tone: "danger",
              text: "לא התקבל אישור מספק הדואר — ייתכן שהתשובה יצאה. בדקו לפני שליחה חוזרת.",
            }
          : { tone: "success", text: "התשובה נשלחה" },
      );
      /*
       * ‎**הקיפול רק כששליחה הצליחה, ורק כשהיא ודאית.**
       *
       * ‏„לא ידוע” נשאר פתוח בכוונה: זו בדיוק הפנייה שצריך להסתכל
       * עליה שוב לפני שליחה חוזרת, וקיפול היה מסתיר את האזהרה
       * שנכתבה עכשיו.
       */
      if (close && sent?.state !== "unknown") onClosed();
    } catch (err: unknown) {
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.message : "השליחה נכשלה" });
    } finally {
      setBusy(false);
    }
  }

  if (error !== null) return <Notice tone="danger">{error}</Notice>;
  if (ticket === null) return <p aria-live="polite">טוען…</p>;

  return (
    <>
      {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

      <div className="mb-1 flex flex-wrap items-center gap-2 text-[length:var(--type-caption-lg)]">
        <span style={{ color: "var(--color-text-muted)" }}>{ticket.userName}</span>
        <a href={`mailto:${ticket.userEmail}`} dir="ltr" className="underline">
          {ticket.userEmail}
        </a>
        {/*
          הטלפון כקישור חיוג ולא כטקסט: תקלה חוסמת נסגרת בשיחה, וזה
          המסך שממנו מתקשרים. „—” היה נראה כמו מספר חסר; „אין טלפון
          בפרופיל” אומר למה.
        */}
        {ticket.userPhone !== null && ticket.userPhone !== "" ? (
          <a href={`tel:${ticket.userPhone}`} dir="ltr" className="underline">
            {ticket.userPhone}
          </a>
        ) : (
          <span style={{ color: "var(--color-text-muted)" }}>· אין טלפון בפרופיל</span>
        )}
        <span>· {SUPPORT_KIND_LABEL[ticket.kind]}</span>
        <span>· {ticket.area}</span>
        {ticket.severity === "blocking" ? (
          <b style={{ color: "var(--color-danger)" }}>· {SUPPORT_SEVERITY_LABEL.blocking}</b>
        ) : null}
        <span className="ms-auto" style={{ color: "var(--color-text-muted)" }}>
          {formatDateTime(ticket.createdAt)}
        </span>
      </div>

      {/*
        ההקשר בפתיח מתקפל: הוא מה שמקצר את הטיפול, אבל אם הוא פתוח
        תמיד הוא קובר את מה שהמשתמש כתב.
      */}
      <details className="mb-2 text-[length:var(--type-caption)]">
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
        <p className="m-0 mb-2 text-[length:var(--type-caption)]">
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

      {/*
        אין נפילה-לאחור ל-`ticket.message` כשהרשימה ריקה: המיגרציה
        כתבה הודעה ראשונה לכל פנייה קיימת, ורשימה ריקה כאן פירושה
        תקלה אמיתית — שכפול הטקסט היה מסתיר אותה.
      */}
      <Conversation
        messages={ticket.messages}
        incomingLabel={ticket.userName}
        attachmentBase={`${API_BASE}/platform/support/tickets/attachments`}
      />

      <Composer
        id={`ticket-reply-${ticket.id}`}
        value={draft}
        onChange={setDraft}
        fileInput={fileInput}
        busy={busy}
        onSend={() => void sendReply(false)}
      >
        {/*
          ‎„שליחה וסגירה” בלחיצה אחת. רוב התשובות הן התשובה האחרונה,
          וסגירה בנפרד פירושה שהתור מלא בפניות שכבר טופלו.
        */}
        {ticket.status !== "closed" ? (
          <button
            type="button"
            className="mv-chip"
            disabled={busy || (draft.trim() === "" && ticket.messages.length === 0)}
            onClick={() => void sendReply(true)}
          >
            שליחה וסגירה
          </button>
        ) : null}
      </Composer>
    </>
  );
}
