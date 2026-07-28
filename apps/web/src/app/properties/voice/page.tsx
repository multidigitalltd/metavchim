"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@metavchim/ui";
import { apiPost, ApiError } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-auth";

/**
 * "הוסף נכס בקול" (אפיון §6) — זיהוי דיבור בעברית בדפדפן (Web Speech API)
 * עם עריכה ידנית של התמלול לפני שליחה. הדפדפן הוא ה-STT בשלב זה;
 * תמלול צד-שרת (וואטסאפ/הקלטות) יתווסף עם ספק ה-AI.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] ?? w["webkitSpeechRecognition"] ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export default function VoiceIntakePage() {
  useRequireAuth();
  const router = useRouter();
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognition() !== null);
  }, []);

  function toggleRecording() {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        const alt = event.results[i]?.[0];
        if (alt) parts.push(alt.transcript);
      }
      setTranscript((prev) => (prev ? `${prev} ` : "") + parts.join(" ").trim());
    };
    recognition.onend = () => setRecording(false);
    recognition.onerror = () => {
      setRecording(false);
      setError("זיהוי הדיבור נכשל — אפשר להקליד את תיאור הנכס למטה");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
    setError(null);
  }

  async function submit() {
    if (transcript.trim().length < 5) {
      setError("ספרו על הנכס — לפחות כמה מילים");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<{ property: { id: string } }>("/voice-intakes", {
        transcript: transcript.trim(),
      });
      router.replace(`/properties/${result.property.id}`);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "קליטת הנכס נכשלה");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-2 text-2xl font-bold">🎤 הוסף נכס בקול</h1>
      <p className="mb-6" style={{ color: "var(--color-text-muted)" }}>
        ספרו על הנכס בקול חופשי — עיר, רחוב, חדרים, קומה, מחיר, מאפיינים.
        המערכת תפרק הכל לשדות ותסמן מה חסר.
      </p>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg border p-3" style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}>
          {error}
        </p>
      ) : null}

      {speechSupported ? (
        <div className="mb-4 text-center">
          <Button
            type="button"
            variant={recording ? "danger" : "primary"}
            onClick={toggleRecording}
            aria-pressed={recording}
            className="min-w-48"
          >
            {recording ? "⏹ עצור הקלטה" : "🎤 התחל לדבר"}
          </Button>
          {recording ? (
            <p aria-live="polite" className="mt-2" style={{ color: "var(--color-danger)" }}>
              מקליט… דברו חופשי
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
          הדפדפן לא תומך בזיהוי דיבור — אפשר להקליד או להדביק את תיאור הנכס:
        </p>
      )}

      <div className="mb-6">
        <label htmlFor="transcript" className="mb-1 block font-medium">
          תיאור הנכס {speechSupported ? "(אפשר לערוך את מה שזוהה)" : ""}
        </label>
        <textarea
          id="transcript"
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          rows={5}
          placeholder='לדוגמה: "דירת 3 חדרים בבני ברק, רחוב הרב שך, קומה 2 מתוך 4, בלי מעלית, 68 מטר, משופצת, מחיר 2.15 מיליון"'
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </div>

      <Button onClick={() => void submit()} disabled={submitting} className="w-full">
        {submitting ? "מעבד את הנכס…" : "צור כרטיס נכס"}
      </Button>
    </div>
  );
}
