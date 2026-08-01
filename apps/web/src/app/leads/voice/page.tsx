"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { LEAD_INTENT_LABELS } from "@/lib/lead-labels";
import { useRequireAuth } from "@/lib/use-auth";
import { VoiceRecorder } from "../../voice-recorder";

/**
 * "ליד בקול" — המתווך יורד מהשיחה ומספר מה קרה; המערכת מחלצת שם,
 * טלפון וכוונה, והוא מאשר. התמלול המלא נשמר כסיכום הליד.
 */

const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)" } as const;

interface ExtractedPerson {
  name?: string;
  phone?: string;
  intent: string;
  cities: string[];
}

function LeadVoiceForm() {
  const { loading: authLoading } = useRequireAuth();
  const router = useRouter();
  const initial = useSearchParams().get("t") ?? "";
  const [transcript, setTranscript] = useState(initial);
  const [person, setPerson] = useState<ExtractedPerson | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function analyze() {
    if (transcript.trim().length < 2) {
      setError("ספרו על הפנייה — לפחות כמה מילים");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ person: ExtractedPerson; missing: string[] }>("/voice/preview", {
        transcript: transcript.trim(),
        target: "lead",
      });
      setPerson(result.person);
      setMissing(result.missing);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "החילוץ נכשל");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(event.currentTarget);
    try {
      const created = await apiPost<{ leadId: string; merged: boolean; visible: boolean }>(
        "/voice/leads",
        {
          transcript: transcript.trim(),
          name: String(f.get("name")).trim(),
          phone: String(f.get("phone")).trim(),
          intent: String(f.get("intent")),
        },
      );
      router.replace(
        created.visible
          ? `/leads/${created.leadId}${created.merged ? "?merged=1" : ""}`
          : "/leads",
      );
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "יצירת הליד נכשלה");
      setBusy(false);
    }
  }

  if (authLoading) return <p aria-live="polite">טוען…</p>;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold">🎤 הוסף ליד בקול</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ירדתם מהשיחה? ספרו מה היה — שם, טלפון ומה הוא רוצה. המערכת תפרק
        לשדות, והתמלול המלא יישמר כסיכום הליד.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {!person ? (
        <>
          <VoiceRecorder
            value={transcript}
            onChange={setTranscript}
            label="מה קרה בשיחה"
            placeholder='לדוגמה: "התקשר יוסי לוי, 052-9876543, מתעניין בדירת 3 חדרים באשדוד, ביקש שנחזור אליו מחר"'
            onError={setError}
          />
          <Button onClick={() => void analyze()} disabled={busy} className="w-full">
            {busy ? "מנתח…" : "נתח ובדוק"}
          </Button>
        </>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          {missing.length > 0 ? (
            <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}>
              יש להשלים: {missing.join(", ")}
            </p>
          ) : (
            <p role="status" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-success)", background: "var(--color-surface)" }}>
              ✓ הפרטים זוהו — בדקו ואשרו
            </p>
          )}

          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="name" className="mb-1 block font-medium">שם *</label>
              <input id="name" name="name" required minLength={2} defaultValue={person.name ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="phone" className="mb-1 block font-medium">טלפון *</label>
              <input id="phone" name="phone" required dir="ltr" placeholder="+972501234567" defaultValue={person.phone ?? ""} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="intent" className="mb-1 block font-medium">כוונה</label>
              <select id="intent" name="intent" defaultValue={person.intent} className="w-full rounded-lg border px-3 py-2.5" style={inputStyle}>
                {Object.entries(LEAD_INTENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="mb-6 rounded-xl border p-3 text-sm" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}>
            התמלול המלא יישמר כסיכום הליד{person.cities.length > 0 ? ` (זוהו גם: ${person.cities.join(", ")})` : ""}.
          </p>

          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>{busy ? "יוצר…" : "צור ליד"}</Button>
            <Button type="button" variant="ghost" onClick={() => setPerson(null)}>חזרה לעריכת הטקסט</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function LeadVoicePage() {
  return (
    <Suspense fallback={<p aria-live="polite">טוען…</p>}>
      <LeadVoiceForm />
    </Suspense>
  );
}
