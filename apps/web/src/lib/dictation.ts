"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, apiGet } from "@/lib/api";

/**
 * הכתבה לכל שדה טקסט במערכת, בשני מצבים שהמשתמש בוחר ביניהם במפורש:
 *
 * - **מהיר** (`browser`) — זיהוי הדיבור של הדפדפן. הטקסט מופיע *תוך כדי
 *   הדיבור*, בלי לגעת בשרת. פחות מדויק בעברית, ולא עובד בכל דפדפן.
 * - **מדויק** (`server`) — ההקלטה נשלחת לשירות התמלול שרץ על השרת של
 *   המשרד. הטקסט מגיע רק בסוף, אבל איכות העברית גבוהה בהרבה, וההקלטה
 *   לא יוצאת מהשרת ונמחקת מיד.
 *
 * שני המצבים זמינים תמיד — אין נפילה אוטומטית ממצב למצב. משתמש שבחר
 * "מדויק" ומקבל טקסט גרוע מהדפדפן היה חושב שהשרת שלו מקולקל.
 *
 * למה כאן ולא ב-VoiceRecorder הקיים: שם ההקלטה נחתכת להפסקות ומתומללת
 * בזרם — נכון למונולוג ארוך של קליטת נכס. בשדה טופס מדברים 3–10 שניות,
 * וחיתוך לקטעים היה מוסיף מורכבות בלי להרוויח דבר.
 */

export type DictationMode = "browser" | "server";

/** ברירת המחדל — דיוק העברית חשוב יותר מהמיידיות ברוב השדות. */
export const DEFAULT_DICTATION_MODE: DictationMode = "server";
const MODE_STORAGE_KEY = "mv-dictation-mode";

export function loadPreferredMode(): DictationMode {
  if (typeof window === "undefined") return DEFAULT_DICTATION_MODE;
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === "browser" || stored === "server" ? stored : DEFAULT_DICTATION_MODE;
}

export function savePreferredMode(mode: DictationMode): void {
  if (typeof window !== "undefined") window.localStorage.setItem(MODE_STORAGE_KEY, mode);
}

/* ---------- גישה ל-API של הדפדפן ---------- */

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
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

function canRecordAudio(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    navigator.mediaDevices !== undefined
  );
}

/* ---------- זמינות שירות התמלול ---------- */

/**
 * נשאל פעם אחת לכל טעינת עמוד ומשותף לכל השדות: עשרות שדות עם מיקרופון
 * לא ישלחו עשרות בקשות זהות. ההבטחה נשמרת, לא התוצאה — כך גם שדות
 * שנטענים מאוחר יותר מקבלים את אותה תשובה.
 */
let serverAvailability: Promise<boolean> | null = null;

function checkServerAvailability(): Promise<boolean> {
  serverAvailability ??= apiGet<{ available: boolean }>("/voice-intakes/transcription-status")
    .then((res) => res.available)
    .catch(() => false);
  return serverAvailability;
}

export interface DictationState {
  /** האם המצב המהיר (דפדפן) נתמך כאן. */
  browserReady: boolean;
  /** האם שירות התמלול בשרת מוגדר וזמין. */
  serverReady: boolean;
  recording: DictationMode | null;
  transcribing: boolean;
  error: string | null;
  start: (mode: DictationMode) => void;
  stop: () => void;
  clearError: () => void;
}

/**
 * הלוגיקה המשותפת. הרכיב שמשתמש בה מספק `onAppend` — מה לעשות עם טקסט
 * שזוהה. הפרדה זו מאפשרת לחבר את אותו מנוע גם ל-input, גם ל-textarea
 * וגם לשדה שמנוהל בטופס לא-מבוקר.
 */
export function useDictation(onAppend: (text: string, isInterim: boolean) => void): DictationState {
  const [browserReady, setBrowserReady] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [recording, setRecording] = useState<DictationMode | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const disposedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // ה-callback העדכני — ההקלטה חיה בין רינדורים, ולולאת הסגירה
  // (closure) הייתה נצמדת לגרסה הישנה ודורסת עריכות של המשתמש
  const appendRef = useRef(onAppend);
  appendRef.current = onAppend;

  useEffect(() => {
    setBrowserReady(getSpeechRecognition() !== null);
    void checkServerAvailability().then((ok) => {
      if (!disposedRef.current) setServerReady(ok && canRecordAudio());
    });
  }, []);

  /* ניתוק המיקרופון והבקשה כשהשדה יורד מהמסך — בלי זה ההקלטה
     ממשיכה לרוץ אחרי שהמשתמש עזב (אותה תקלה שתוקנה ב-VoiceRecorder) */
  useEffect(() => {
    return () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      recognitionRef.current?.stop();
      const recorder = recorderRef.current;
      if (recorder?.state === "recording") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const startBrowser = useCallback((): void => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    // התוצאות הזמניות הן כל העניין במצב המהיר: הטקסט זוחל על המסך
    // תוך כדי הדיבור במקום לקפוץ בסוף המשפט
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) final += text;
        else interim += text;
      }
      const combined = `${final}${interim}`.trim();
      if (combined !== "") appendRef.current(combined, interim !== "");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setRecording(null);
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setRecording(null);
      setError("זיהוי הדיבור בדפדפן נכשל — אפשר לנסות הקלטה מדויקת או להקליד");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording("browser");
  }, []);

  const startServer = useCallback(async (): Promise<void> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("אין גישה למיקרופון — אשרו הרשאה בדפדפן או הקלידו");
      return;
    }
    if (disposedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      void transcribe(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording("server");
  }, []);

  async function transcribe(blob: Blob): Promise<void> {
    if (blob.size === 0 || disposedRef.current) return;
    setTranscribing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const form = new FormData();
      form.append("file", blob, "recording.webm");
      const res = await fetch(`${API_BASE}/voice-intakes/transcribe`, {
        method: "POST",
        credentials: "include",
        body: form,
        signal: controller.signal,
      });
      if (disposedRef.current) return;
      if (res.status === 429) {
        setError("שירות התמלול עסוק כרגע — נסו שוב בעוד רגע");
        return;
      }
      if (!res.ok) throw new Error("transcribe failed");
      const body = (await res.json()) as { text?: string };
      const text = (body.text ?? "").trim();
      if (text === "") {
        setError("לא זוהה דיבור בהקלטה — נסו שוב או הקלידו");
        return;
      }
      appendRef.current(text, false);
    } catch {
      if (disposedRef.current) return;
      setError("התמלול נכשל — נסו הקלטה מהירה או הקלידו");
    } finally {
      if (!disposedRef.current) setTranscribing(false);
    }
  }

  const start = useCallback(
    (mode: DictationMode): void => {
      setError(null);
      if (mode === "browser") startBrowser();
      else void startServer();
    },
    [startBrowser, startServer],
  );

  const stop = useCallback((): void => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      recognitionRef.current = null;
      setRecording(null);
      return;
    }
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    setRecording(null);
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  return { browserReady, serverReady, recording, transcribing, error, start, stop, clearError };
}
