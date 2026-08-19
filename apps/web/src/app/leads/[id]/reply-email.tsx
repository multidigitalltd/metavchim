"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { DictateFor } from "../../dictation-field";
import { Notice } from "../../notice";

/**
 * תשובה במייל ללקוח, מתוך הכרטיס.
 *
 * המתווך יכול לענות גם מ-Gmail עצמו — אבל אז התשובה לא מותירה זכר
 * בכרטיס, ובעוד שבוע אף אחד לא זוכר מה נענה ומתי. כאן ההודעה נשלחת
 * מהתיבה שלו **ונרשמת בציר הזמן** באותה פעולה.
 *
 * הרכיב מציג את עצמו רק כשיש למה: תיבה מחוברת ולקוח עם כתובת. אחרת
 * הוא נעלם, כדי שלא יהיה כפתור שמוביל לשגיאה.
 */

interface SendState {
  canSend: boolean;
  from?: string;
}

export function ReplyEmail({
  contactId,
  leadId,
  contactEmail,
  contactName,
}: {
  contactId: string;
  leadId: string;
  /** undefined = ללקוח אין כתובת; אין למי לשלוח. */
  contactEmail?: string;
  contactName: string;
}) {
  const [state, setState] = useState<SendState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SendState>("/gmail/can-send")
      .then(setState)
      // כשל בבדיקה מסתיר את הרכיב במקום להציג כפתור שייכשל
      .catch(() => setState({ canSend: false }));
  }, []);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject")).trim();
    const body = String(form.get("body")).trim();
    setBusy(true);
    setError(null);
    apiPost("/gmail/send", { contactId, leadId, subject, body })
      .then(() => {
        setSentTo(contactEmail ?? "");
        setOpen(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "השליחה נכשלה");
      })
      .finally(() => setBusy(false));
  }

  if (state === null || !state.canSend || contactEmail === undefined) return null;

  return (
    <section
      className="mb-4 rounded-xl border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      aria-labelledby="reply-email-heading"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="reply-email-heading" className="m-0" style={{ fontSize: 16.5, fontWeight: 800 }}>
          תשובה במייל
        </h2>
        {state.from ? (
          <span className="text-[14px]" style={{ color: "var(--color-text-muted)" }}>
            נשלח מ-<span dir="ltr">{state.from}</span>
          </span>
        ) : null}
      </div>

      {sentTo !== null ? (
        <p role="status" className="m-0 mb-2 text-sm" style={{ color: "var(--color-primary)" }}>
          ✓ המייל נשלח ל-<span dir="ltr">{sentTo}</span> — ונרשם בציר הזמן של הליד.
        </p>
      ) : null}

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2.5">
          <p className="m-0 text-[14px]" style={{ color: "var(--color-text-muted)" }}>
            אל: <b dir="ltr">{contactEmail}</b>
          </p>
          <label className="text-sm font-semibold">
            נושא
            <input
              name="subject"
              required
              maxLength={200}
              defaultValue={`בהמשך לפנייתך — ${contactName}`}
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal"
              style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
            />
          </label>
          <label htmlFor="reply-body" className="text-sm font-semibold">
            תוכן ההודעה
            {/* כפתור הכתבה כמו בכל שדות הטקסט — מתווך בשטח מכתיב */}
            <div className="mt-1 flex items-start gap-2">
              <textarea
                id="reply-body"
                name="body"
                required
                rows={6}
                maxLength={5000}
                className="flex-1 rounded-lg border px-3 py-2 text-sm font-normal"
                style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
              />
              <DictateFor targetId="reply-body" />
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="mv-btn-action" disabled={busy}>
              {busy ? "שולח…" : "שלח מייל"}
            </button>
            <button type="button" className="mv-btn-plain" onClick={() => setOpen(false)}>
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="mv-btn-plain" onClick={() => setOpen(true)}>
          כתוב תשובה ל-<span dir="ltr">{contactEmail}</span>
        </button>
      )}
    </section>
  );
}
