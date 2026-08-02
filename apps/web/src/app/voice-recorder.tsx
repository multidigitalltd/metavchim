"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet } from "@/lib/api";

/**
 * מקליט משותף לכל מסכי הקול, בשני מצבים:
 *
 * 1. **תמלול בשרת** (ברירת מחדל כשמוגדר): מקליטים אודיו ושולחים
 *    לשירות התמלול המקומי — איכות עברית גבוהה, עובד בכל דפדפן,
 *    וההקלטה לא יוצאת מהשרת ולא נשמרת.
 * 2. **תמלול בדפדפן** (Web Speech API): גיבוי כשהשרת לא מוגדר או
 *    נכשל — פחות מדויק בעברית, אבל מיידי ובלי עומס על השרת.
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
  const [transcribing, setTranscribing] = useState(false);
  const [browserSupported, setBrowserSupported] = useState(false);
  const [serverStt, setServerStt] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // הערך העדכני — התמלול בשרת אורך שניות, והמתווך עשוי לערוך בינתיים.
  // בלי זה התשובה הייתה דורסת את מה שהקליד (ביקורת Codex).
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setBrowserSupported(getSpeechRecognition() !== null);
    apiGet<{ available: boolean }>("/voice-intakes/transcription-status")
      .then((res) => setServerStt(res.available))
      .catch(() => setServerStt(false));
  }, []);

  // ניתוק המיקרופון גם כשעוזבים את המסך באמצע הקלטה — בלי זה
  // ה-MediaStream ממשיך לרוץ אחרי שהרכיב ירד (ביקורת Codex)
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const canRecordAudio =
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    navigator.mediaDevices !== undefined;
  const useServer = serverStt && canRecordAudio;

  /** מצב 1 — הקלטה ושליחה לשרת לתמלול. */
  async function startServerRecording(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("אין גישה למיקרופון — אשרו הרשאה בדפדפן או הקלידו");
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop()); // כיבוי המיקרופון
      streamRef.current = null;
      void sendForTranscription(new Blob(chunksRef.current, { type: "audio/webm" }));
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }

  async function sendForTranscription(blob: Blob): Promise<void> {
    if (blob.size === 0) return;
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch(`${API_BASE}/voice-intakes/transcribe`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error("transcribe failed");
      const body = (await res.json()) as { text?: string };
      const text = (body.text ?? "").trim();
      if (text === "") {
        onError?.("לא זוהה דיבור בהקלטה — נסו שוב או הקלידו");
        return;
      }
      const current = valueRef.current;
      onChange((current ? `${current} ` : "") + text);
    } catch {
      // כשל בשירות ⇒ מעבר לזיהוי הדפדפן להקלטות הבאות, במקום לשלוח
      // שוב ושוב לשירות שלא עונה (ביקורת Codex)
      setServerStt(false);
      onError?.(
        getSpeechRecognition() !== null
          ? "התמלול בשרת נכשל — ההקלטה הבאה תתומלל בדפדפן"
          : "התמלול נכשל — אפשר להקליד את הטקסט",
      );
    } finally {
      setTranscribing(false);
    }
  }

  /** מצב 2 — זיהוי בדפדפן (גיבוי). */
  function startBrowserRecognition(): void {
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
      const current = valueRef.current;
      onChange((current ? `${current} ` : "") + parts.join(" ").trim());
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

  function toggle(): void {
    if (recording) {
      if (useServer) mediaRecorderRef.current?.stop();
      else recognitionRef.current?.stop();
      setRecording(false);
      return;
    }
    if (useServer) void startServerRecording();
    else startBrowserRecognition();
  }

  const canRecord = useServer || browserSupported;

  return (
    <>
      {canRecord ? (
        <div className="mb-4 text-center">
          <Button
            type="button"
            variant={recording ? "danger" : "primary"}
            onClick={toggle}
            aria-pressed={recording}
            disabled={transcribing}
            className="min-w-48"
          >
            {transcribing ? "מתמלל…" : recording ? "⏹ עצור הקלטה" : "🎤 התחל לדבר"}
          </Button>
          {recording ? (
            <p aria-live="polite" className="mt-2" style={{ color: "var(--color-danger)" }}>
              מקליט… דברו חופשי
            </p>
          ) : transcribing ? (
            <p aria-live="polite" className="mt-2" style={{ color: "var(--color-text-muted)" }}>
              מתמלל בשרת — כמה שניות…
            </p>
          ) : useServer ? (
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              🔒 התמלול מתבצע על השרת שלכם — ההקלטה לא נשלחת לשום גורם חיצוני
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mb-4" style={{ color: "var(--color-text-muted)" }}>
          הדפדפן לא תומך בהקלטה — אפשר להקליד:
        </p>
      )}

      <div className="mb-6">
        <label htmlFor="voice-transcript" className="mb-1 block font-medium">
          {label} {canRecord ? "(אפשר לערוך את מה שזוהה)" : ""}
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
