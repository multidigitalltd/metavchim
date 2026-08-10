"use client";

import { useEffect, useState, use, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * עריכת פגישה קיימת — המסך שנפתח בלחיצה על פגישה ביומן.
 *
 * מועד ומשך הולכים דרך ‎/reschedule‎ ולא דרך PATCH: כך נשמרים המועד
 * הקודם ומונה הדחיות (פגישה שנדחתה שלוש פעמים היא עסקה שמתקררת),
 * ושאר השדות — כותרת, סטטוס, תוצאה והערות — ב-PATCH רגיל.
 */

interface AppointmentDetail {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  buyerId?: string;
  startsAt: string;
  endsAt?: string;
  status: string;
  outcome?: string;
  notes?: string;
}

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "מתוכננת",
  completed: "התקיימה",
  cancelled: "בוטלה",
  no_show: "הלקוח לא הגיע",
};

const OUTCOME_LABELS: Record<string, string> = {
  liked: "אהב את הנכס",
  not_fit: "לא מתאים",
  negotiating: 'עוברים למו"מ',
  needs_other: "צריך נכס אחר",
};

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function EditAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    apiGet<AppointmentDetail>(`/appointments/${id}`)
      .then(setAppointment)
      .catch(() => setError("הפגישה לא נמצאה"));
  }, [authLoading, id]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appointment) return;
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const date = String(f.get("date"));
    const time = String(f.get("time"));
    const duration = Number(f.get("duration"));
    const outcome = String(f.get("outcome") ?? "");

    const started = new Date(appointment.startsAt);
    const currentDuration =
      appointment.endsAt !== undefined
        ? Math.round((new Date(appointment.endsAt).getTime() - started.getTime()) / 60_000)
        : 30;
    const nextStart = new Date(`${date}T${time}`);
    const moved = nextStart.getTime() !== started.getTime() || duration !== currentDuration;

    try {
      if (moved) {
        await apiPost(`/appointments/${id}/reschedule`, {
          startsAt: nextStart.toISOString(),
          durationMinutes: duration,
        });
      }
      const title = String(f.get("title") ?? "").trim();
      const notes = String(f.get("notes") ?? "").trim();
      await apiPatch(`/appointments/${id}`, {
        // שדה שנוקה נשלח כ-null — השמטה הייתה משאירה את הערך הישן
        title: title === "" ? null : title,
        status: String(f.get("status")),
        notes: notes === "" ? null : notes,
        // תוצאת סיור — רק לסוג viewing; מחרוזת קובעת גם "התקיימה", null מנקה
        ...(appointment.kind === "viewing" ? { outcome: outcome === "" ? null : outcome } : {}),
      });
      router.replace("/calendar");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "שמירת הפגישה נכשלה");
      setSubmitting(false);
    }
  }

  if (error && !appointment) {
    return (
      <p role="alert" style={{ color: "var(--color-danger)" }}>
        {error} — <Link href="/calendar" className="underline">חזרה ליומן</Link>
      </p>
    );
  }
  if (!appointment) return <p aria-live="polite">טוען…</p>;

  const starts = new Date(appointment.startsAt);
  const durationMinutes =
    appointment.endsAt !== undefined
      ? Math.round((new Date(appointment.endsAt).getTime() - starts.getTime()) / 60_000)
      : 30;

  return (
    <div className="mx-auto max-w-lg">
      <nav aria-label="נתיב" className="mb-4 text-sm">
        <Link href="/calendar" className="underline">יומן</Link>
        <span aria-hidden="true"> / </span>
        <span>עריכת {KIND_LABELS[appointment.kind] ?? "פגישה"}</span>
      </nav>
      <h1 className="mb-2 text-2xl font-bold">
        עריכת {KIND_LABELS[appointment.kind] ?? "פגישה"}
      </h1>
      <p className="mb-4 flex flex-wrap gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        {appointment.propertyId ? (
          <Link href={`/properties/${appointment.propertyId}`} className="underline">לנכס המקושר</Link>
        ) : null}
        {appointment.leadId ? (
          <Link href={`/leads/${appointment.leadId}`} className="underline">לליד המקושר</Link>
        ) : null}
        {appointment.buyerId ? (
          <Link href={`/buyers/${appointment.buyerId}`} className="underline">לקונה המקושר</Link>
        ) : null}
      </p>

      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <div className="mb-4">
          <label htmlFor="title" className="mb-1 block font-medium">כותרת</label>
          <input id="title" name="title" defaultValue={appointment.title ?? ""} maxLength={200} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>

        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="date" className="mb-1 block font-medium">תאריך</label>
            <input
              id="date"
              name="date"
              type="date"
              required
              defaultValue={`${starts.getFullYear()}-${pad(starts.getMonth() + 1)}-${pad(starts.getDate())}`}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="time" className="mb-1 block font-medium">שעה</label>
            <input
              id="time"
              name="time"
              type="time"
              required
              defaultValue={`${pad(starts.getHours())}:${pad(starts.getMinutes())}`}
              className="w-full rounded-lg border px-3 py-2.5"
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="duration" className="mb-1 block font-medium">משך (דקות)</label>
            <input id="duration" name="duration" type="number" min={15} max={480} step={15} defaultValue={durationMinutes} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
        </div>

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="status" className="mb-1 block font-medium">סטטוס</label>
            <select id="status" name="status" defaultValue={appointment.status} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {appointment.kind === "viewing" ? (
            <div>
              <label htmlFor="outcome" className="mb-1 block font-medium">תוצאת הסיור</label>
              <select id="outcome" name="outcome" defaultValue={appointment.outcome ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                <option value="">טרם תועדה</option>
                {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="mb-6">
          <label htmlFor="notes" className="mb-1 block font-medium">הערות</label>
          <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={appointment.notes ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? "שומר…" : "שמור שינויים"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/calendar")}>
            ביטול
          </Button>
        </div>
      </form>
    </div>
  );
}
