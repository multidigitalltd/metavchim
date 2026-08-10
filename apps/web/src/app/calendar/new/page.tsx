"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { waMeUrl } from "@/lib/format";
import { useRequireAuth } from "@/lib/use-auth";
import { DictateFor } from "../../dictation-field";

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

const KIND_LABELS: Record<string, string> = {
  viewing: "סיור בנכס",
  meeting: "פגישה",
  call: "שיחה",
};

function NewAppointmentForm() {
  useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const leadId = params.get("leadId") ?? undefined;
  const propertyId = params.get("propertyId") ?? undefined;
  // מהפקודה הקולית: הטקסט נכנס כהערות, והתאריך/שעה/סוג שזוהו ממלאים
  // את הטופס מראש — המתווך רק מאשר או מתקן
  const initialNotes = params.get("notes") ?? "";
  const startsAtParam = params.get("startsAt");
  const initialKind = params.get("kind") ?? "viewing";
  const parsedStart = startsAtParam ? new Date(startsAtParam) : null;
  const validStart = parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : null;
  // ערכי input date/time הם מקומיים — נגזרים מהשעון של הדפדפן
  const pad = (n: number): string => String(n).padStart(2, "0");
  const initialDate = validStart
    ? `${validStart.getFullYear()}-${pad(validStart.getMonth() + 1)}-${pad(validStart.getDate())}`
    : "";
  const initialTime = validStart ? `${pad(validStart.getHours())}:${pad(validStart.getMinutes())}` : "";
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** אחרי היצירה, כשהפגישה מקושרת לליד: הצעה לעדכן את הלקוח בוואטסאפ. */
  const [notify, setNotify] = useState<{ waUrl: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    const f = new FormData(event.currentTarget);
    const date = String(f.get("date"));
    const time = String(f.get("time"));
    const kind = String(f.get("kind"));
    try {
      await apiPost("/appointments", {
        kind,
        title: String(f.get("title") ?? "").trim() || undefined,
        startsAt: new Date(`${date}T${time}`).toISOString(),
        durationMinutes: Number(f.get("duration")),
        notes: String(f.get("notes") ?? "").trim() || undefined,
        leadId,
        propertyId,
      });
      /*
       * "תיאום ביומן עם הודעה ללקוח": כשהפגישה מקושרת לליד, ההודעה
       * נפתחת בוואטסאפ מנוסחת ומוכנה — המתווך רק לוחץ שליחה. השליחה
       * לעולם לא אוטומטית: הודעה ללקוח יוצאת רק ביד של בן אדם.
       */
      if (leadId) {
        try {
          const lead = await apiGet<{ contact: { name: string; phone: string } }>(
            `/leads/${leadId}`,
          );
          const when = new Intl.DateTimeFormat("he-IL", {
            dateStyle: "full",
            timeStyle: "short",
          }).format(new Date(`${date}T${time}`));
          setNotify({
            waUrl: waMeUrl(
              lead.contact.phone,
              `שלום ${lead.contact.name}, קבענו ${KIND_LABELS[kind] ?? "פגישה"} ל${when}. נתראה!`,
            ),
          });
          setSubmitting(false);
          return;
        } catch {
          // אין גישה לליד — פשוט בלי ההצעה; הפגישה כבר נקבעה
        }
      }
      router.replace("/calendar");
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קביעת הפגישה נכשלה");
      setSubmitting(false);
    }
  }

  if (notify) {
    return (
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-2xl font-bold">✓ הפגישה נקבעה</h1>
        <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
          רוצים לעדכן את הלקוח? ההודעה כבר מנוסחת — נשאר רק ללחוץ שליחה בוואטסאפ.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href={notify.waUrl} target="_blank" rel="noopener noreferrer" className="mv-btn-action" style={{ textDecoration: "none" }}>
            💬 שלח עדכון ללקוח בוואטסאפ
          </a>
          <Button variant="ghost" onClick={() => router.replace("/calendar")}>
            סיום — ליומן
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold">פגישה חדשה</h1>
      {leadId ? (
        <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
          הפגישה תקושר לליד ותתועד בציר הזמן שלו.
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        {error ? (
          <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
            {error}
          </p>
        ) : null}

        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kind" className="mb-1 block font-medium">סוג *</label>
            <select id="kind" name="kind" required defaultValue={initialKind} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="viewing">סיור בנכס</option>
              <option value="meeting">פגישה</option>
              <option value="call">שיחה</option>
            </select>
          </div>
          <div>
            <label htmlFor="title" className="mb-1 block font-medium">כותרת</label>
            <input id="title" name="title" maxLength={200} placeholder="סיור עם יעקב כהן" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="date" className="mb-1 block font-medium">תאריך *</label>
            <input id="date" name="date" type="date" required defaultValue={initialDate} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="time" className="mb-1 block font-medium">שעה *</label>
            <input id="time" name="time" type="time" required defaultValue={initialTime} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          </div>
          <div>
            <label htmlFor="duration" className="mb-1 block font-medium">משך (דקות)</label>
            <select id="duration" name="duration" defaultValue="60" className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="90">90</option>
              <option value="120">120</option>
            </select>
          </div>
        </div>

        <div className="mb-6">
          <label htmlFor="notes" className="mb-1 block font-medium">הערות</label>
          <textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={initialNotes} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
          <DictateFor targetId="notes" />
        </div>

        <div className="flex gap-3">
          <Button type="submit" disabled={submitting}>{submitting ? "קובע…" : "קבע פגישה"}</Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>ביטול</Button>
        </div>
      </form>
    </div>
  );
}

export default function NewAppointmentPage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <NewAppointmentForm />
    </Suspense>
  );
}
