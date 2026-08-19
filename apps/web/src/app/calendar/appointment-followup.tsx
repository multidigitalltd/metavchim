"use client";

import { useState } from "react";
import { API_BASE, apiPatch, apiPost, ApiError } from "@/lib/api";
import { Notice } from "../notice";

/**
 * מה קורה אחרי הפגישה.
 *
 * עד כה "התקיימה" ו"לא התקיימה" היו לחיצה אחת שכתבה סטטוס ונגמרה —
 * ושתיהן איבדו את הדבר החשוב:
 *
 * - **"לא התקיימה"** משאירה את המתווך בלי מועד חדש. פגישה שלא
 *   התקיימה כמעט תמיד צריכה להיקבע מחדש, וסימון סטטוס בלבד הופך את
 *   הלקוח למי שנשכח. הכפתור פותח קביעת מועד — לא מבטל ופותח פגישה
 *   מאפס, כי אז נשבר הקשר לנכס, לקונה ולהיסטוריה.
 * - **"התקיימה"** לא שאלה מה קרה בה. הפגישה היא כל המידע העסקי
 *   שנוצר באותו יום, וסטטוס `completed` בלי מילה אחת עליו מוחק אותו.
 *
 * ההקלטה נשמרת ועוברת לתמלול ולסיכום באותו צינור של הקלטות שיחה.
 */

const OUTCOMES: { value: string; label: string }[] = [
  { value: "liked", label: "אהב את הנכס" },
  { value: "not_fit", label: "לא מתאים" },
  { value: "negotiating", label: 'עוברים למו"מ' },
  { value: "needs_other", label: "צריך נכס אחר" },
];

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-field)" } as const;

/** ‎`datetime-local` דורש זמן מקומי בלי אזור — לא ISO של UTC. */
function localInputValue(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AppointmentFollowUp({
  appointment,
  mode,
  onDone,
  onCancel,
  canTranscribe,
}: {
  appointment: { id: string; kind: string; startsAt: string; title?: string };
  /** ‎reschedule‎ = לא התקיימה | ‎document‎ = התקיימה */
  mode: "reschedule" | "document";
  onDone: () => void;
  onCancel: () => void;
  canTranscribe: boolean;
}): React.JSX.Element {
  /*
   * ברירת מחדל לדחייה: אותה שעה, שבוע קדימה. זה הניחוש הנכון ברוב
   * המקרים, והמתווך משנה במקום להקליד מאפס.
   */
  const [startsAt, setStartsAt] = useState(() =>
    localInputValue(new Date(new Date(appointment.startsAt).getTime() + 7 * 24 * 60 * 60 * 1000)),
  );
  const [duration, setDuration] = useState("60");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitReschedule(): Promise<void> {
    if (startsAt === "") {
      setError("בחרו מועד חדש");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/appointments/${appointment.id}/reschedule`, {
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: Number(duration),
        ...(reason.trim() !== "" ? { reason: reason.trim() } : {}),
      });
      onDone();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "הדחייה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function submitDocument(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      /*
       * הסטטוס והתיעוד נשלחים יחד. `outcome` כבר מסמן `completed`
       * בשרת, ולכן הוא נשלח לבדו כשנבחר — שליחת שניהם הייתה כותבת
       * את אותו דבר פעמיים.
       */
      await apiPatch(`/appointments/${appointment.id}`, {
        ...(outcome !== "" ? { outcome } : { status: "completed" }),
        ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
      });

      if (file) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`${API_BASE}/appointments/${appointment.id}/recording`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        /*
         * כישלון בהעלאה **אינו** מבטל את התיעוד שכבר נשמר — הוא רק
         * נאמר. אחרת המתווך היה מקליד סיכום, רואה שגיאה, ומניח
         * שהכול אבד.
         */
        if (!res.ok) {
          setError("התיעוד נשמר, אבל העלאת ההקלטה נכשלה — אפשר לנסות שוב מכרטיס הלקוח");
          setBusy(false);
          return;
        }
      }
      onDone();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת התיעוד נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-2 w-full rounded-xl border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      <p className="m-0 mb-2 text-sm font-bold">
        {mode === "reschedule" ? "קביעת מועד חדש" : "תיעוד הפגישה"}
      </p>

      {error ? (
        <Notice tone="danger">{error}</Notice>
      ) : null}

      {mode === "reschedule" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`rs-${appointment.id}`} className="mb-1 block text-sm">
              מועד חדש
            </label>
            <input
              id={`rs-${appointment.id}`}
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor={`rd-${appointment.id}`} className="mb-1 block text-sm">
              משך (דק׳)
            </label>
            <input
              id={`rd-${appointment.id}`}
              type="number"
              min={15}
              max={480}
              step={15}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-24 rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </div>
          <div className="flex-1" style={{ minWidth: "160px" }}>
            <label htmlFor={`rr-${appointment.id}`} className="mb-1 block text-sm">
              סיבה (לא חובה)
            </label>
            <input
              id={`rr-${appointment.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="למשל: הלקוח ביקש לדחות"
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </div>
          <button
            type="button"
            className="mv-btn-action"
            disabled={busy}
            onClick={() => void submitReschedule()}
          >
            {busy ? "דוחה…" : "דחה למועד הזה"}
          </button>
          <button type="button" className="mv-btn-plain" onClick={onCancel}>
            ביטול
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {appointment.kind === "viewing" ? (
            <div>
              <label htmlFor={`oc-${appointment.id}`} className="mb-1 block text-sm">
                תוצאת הסיור
              </label>
              <select
                id={`oc-${appointment.id}`}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="rounded-lg border px-3 py-2"
                style={inputStyle}
              >
                <option value="">בלי תוצאה</option>
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor={`nt-${appointment.id}`} className="mb-1 block text-sm">
              מה היה בפגישה
            </label>
            <textarea
              id={`nt-${appointment.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="מה נאמר, מה סוכם, מה השלב הבא"
              className="w-full rounded-lg border px-3 py-2"
              style={inputStyle}
            />
          </div>
          {canTranscribe ? (
            <div>
              <label htmlFor={`rec-${appointment.id}`} className="mb-1 block text-sm">
                הקלטה (לא חובה) — תתומלל ותסוכם אוטומטית
              </label>
              <input
                id={`rec-${appointment.id}`}
                type="file"
                accept="audio/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="mv-btn-action"
              disabled={busy}
              onClick={() => void submitDocument()}
            >
              {busy ? "שומר…" : "שמור תיעוד"}
            </button>
            <button type="button" className="mv-btn-plain" onClick={onCancel}>
              ביטול
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
