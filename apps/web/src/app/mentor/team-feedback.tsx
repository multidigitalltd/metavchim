"use client";

import { useCallback, useEffect, useState } from "react";
import { FEEDBACK_MAX_LENGTH, FEEDBACK_SUGGESTIONS, formatJerusalemDate } from "@metavchim/shared";
import { Button } from "@metavchim/ui";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { IconCheck, IconThumbUp } from "../icons";
import { Notice } from "../notice";

/**
 * ‎**הצוות סגר את השבוע — והמנהל אומר על כך מילה.**
 *
 * ## מה החסם האמיתי, ולמה המסך בנוי סביבו
 *
 * ‏מנהל משרד יודע להגיד „כל הכבוד”. מה שחסר לו הוא **הרגע** — הוא
 * אינו יודע ביום שלישי שסוכן סגר את השבוע — ו**החיכוך**: מנהל שצריך
 * לחבר משפט ידחה את זה ל„אחר כך” שלא יגיע.
 *
 * ‏לכן שלושה משפטים בלחיצה אחת, ושדה חופשי למי שרוצה. המשפטים
 * מנוסחים סביב הפעולה ולא סביב האדם — „מה שעשית השבוע” ולא „אתה
 * סוכן טוב” — כי שבח על תכונה מייצר פחד לאבד אותה.
 *
 * ‎**מה שהמנהל רואה כאן, ומה שאינו רואה.** הוא רואה שהסוכן עמד
 * במה שהתחייב לו, ואת המספרים. הוא **אינו** רואה את היעד עצמו, את
 * „מה בדרך כלל עוצר אותך” ואת תוכנית ה„אם-אז” — אלה הדברים הפרטיים
 * ביותר שמתווך כותב במערכת הזו, ודליפה שלהם הייתה הופכת את המנטור
 * לכלי דיווח. שער בשרת בודק בדיוק את זה.
 */

interface Achievement {
  id: string;
  userId: string;
  userName: string;
  weekKey: string;
  percent: number;
  reachedAt: string;
  lines: { label: string; committed: number; actual: number }[];
  feedback: { text: string; byName: string; at: string } | null;
}

function weekLabel(iso: string): string {
  return formatJerusalemDate(new Date(`${iso}T12:00:00.000Z`));
}

export function TeamFeedback(): React.JSX.Element | null {
  const [rows, setRows] = useState<Achievement[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setRows(await apiGet<Achievement[]>("/mentor/achievements"));
    } catch {
      /*
       * ‏סוכן רגיל מקבל כאן 403, וזה תקין לגמרי — הקטע פשוט אינו
       * שלו. רשימה ריקה ולא הודעת שגיאה: „אין לך הרשאה” על מסך
       * שהמשתמש לא ביקש לראות הוא רעש.
       */
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (rows === null || rows.length === 0) return null;

  async function send(id: string): Promise<void> {
    if (draft.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/mentor/achievements/${id}/feedback`, { text: draft.trim() });
      setOpen(null);
      setDraft("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שליחת הפידבק נכשלה");
    }
    setBusy(false);
  }

  const waiting = rows.filter((r) => r.feedback === null).length;

  return (
    <section className="mv-card mv-card--pad mb-[18px]" aria-labelledby="team-heading">
      <div className="mv-card-head">
        <span className="mv-tile mv-tile--44 mv-domain-green" aria-hidden="true">
          <IconThumbUp s={20} />
        </span>
        <h2 id="team-heading" className="mv-card-head__title">
          הצוות שלך סגר את השבוע
        </h2>
        {waiting === 0 ? null : (
          <span className="mv-card-head__link" style={{ color: "var(--domain-green-fg)" }}>
            {waiting} מחכים למילה
          </span>
        )}
      </div>
      <p
        className="m-0 mb-3 text-[length:var(--type-caption-lg)]"
        style={{ color: "var(--color-text-muted)" }}
      >
        מי שעמד במה שהתחייב לו. משפט אחד מהמנהל שווה יותר מכל דוח —
        במיוחד כשהוא מגיע באותו שבוע.
      </p>

      {error === null ? null : (
        <div className="mb-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <ul className="grid list-none gap-2 p-0">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border p-3"
            style={{ borderColor: "var(--color-input-border)" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-extrabold">{row.userName}</div>
                <div
                  className="text-[length:var(--type-caption)]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  שבוע {weekLabel(row.weekKey)} · {row.percent}% ביצוע
                </div>
              </div>
              {row.feedback === null ? (
                <Button
                  variant={open === row.id ? "ghost" : "primary"}
                  onClick={() => {
                    setOpen(open === row.id ? null : row.id);
                    setDraft("");
                  }}
                >
                  {open === row.id ? "ביטול" : "שליחת פידבק"}
                </Button>
              ) : (
                <span
                  className="flex items-center gap-1.5 text-[length:var(--type-caption-lg)] font-bold"
                  style={{ color: "var(--domain-green-fg)" }}
                >
                  <IconCheck s={14} /> נשלח
                </span>
              )}
            </div>

            {row.lines.length === 0 ? null : (
              <ul className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                {row.lines.map((line) => (
                  <li
                    key={line.label}
                    className="text-[length:var(--type-caption-lg)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    <span style={{ color: "var(--color-text-muted)" }}>{line.label} </span>
                    <span className="font-bold">
                      {line.actual}/{line.committed}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {row.feedback === null ? null : (
              <p
                className="m-0 mt-2 rounded-lg px-3 py-2 text-[length:var(--type-caption-lg)]"
                style={{ background: "var(--color-field)", color: "var(--color-text)" }}
              >
                „{row.feedback.text}” — {row.feedback.byName}
              </p>
            )}

            {open !== row.id ? null : (
              <div className="mt-3">
                {/*
                   ‏המשפטים המוכנים אינם קיצור דרך אלא ההתגברות על
                   החסם: מנהל שצריך *לחבר* טקסט ידחה את זה, ודחייה
                   כאן פירושה שהסוכן לא ישמע כלום.
                */}
                <div className="mb-2 flex flex-wrap gap-2">
                  {FEEDBACK_SUGGESTIONS.map((line) => (
                    <button
                      key={line}
                      type="button"
                      className="mv-btn-plain text-start"
                      onClick={() => setDraft(line)}
                    >
                      {line}
                    </button>
                  ))}
                </div>
                <label htmlFor={`fb-${row.id}`} className="mb-1 block text-sm font-bold">
                  מה תרצה לומר ל{row.userName}?
                </label>
                <textarea
                  id={`fb-${row.id}`}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={FEEDBACK_MAX_LENGTH}
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2.5 text-sm"
                  style={{
                    background: "var(--color-field)",
                    borderColor: "var(--color-input-border)",
                    color: "var(--color-text)",
                  }}
                />
                <div className="mt-2 flex gap-3">
                  <Button
                    onClick={() => {
                      void send(row.id);
                    }}
                    disabled={busy || draft.trim() === ""}
                  >
                    {busy ? "שולח…" : "שליחה"}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
