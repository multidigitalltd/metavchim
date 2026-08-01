"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";

/**
 * מקליט משותף לכל מסכי הקול — זיהוי דיבור בעברית בדפדפן (Web Speech API)
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

export function VoiceRecorder({
  value,
  onChange,
  label,
  placeholder,
  onError,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  onError?: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  function toggle() {
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
      onChange((value ? `${value} ` : "") + parts.join(" ").trim());
    };
    recognition.onend = () => setRecording(false);
    recognition.onerror = () => {
      setRecording(false);
      onError?.("זיהוי הדיבור נכשל — אפשר להקליד במקום");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }

  return (
    <>
      {supported ? (
        <div className="mb-4 text-center">
          <Button
            type="button"
            variant={recording ? "danger" : "primary"}
            onClick={toggle}
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
          הדפדפן לא תומך בזיהוי דיבור — אפשר להקליד:
        </p>
      )}

      <div className="mb-6">
        <label htmlFor="voice-transcript" className="mb-1 block font-medium">
          {label} {supported ? "(אפשר לערוך את מה שזוהה)" : ""}
        </label>
        <textarea
          id="voice-transcript"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={5}
          placeholder={placeholder}
          className="w-full rounded-lg border px-3 py-2.5"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
        />
      </div>
    </>
  );
}
