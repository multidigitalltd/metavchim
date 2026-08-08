"use client";

import { useEffect, useRef, useState } from "react";
import type { DictationMode } from "@/lib/dictation";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet } from "@/lib/api";

/**
 * מקליט משותף לכל מסכי הקול, בשני מצבים:
 *
 * 1. **תמלול בשרת** (ברירת מחדל כשמוגדר): הטקסט מופיע *תוך כדי הדיבור*.
 *    ההקלטה נחתכת להפסקות טבעיות ונשלחת לשירות התמלול המקומי —
 *    איכות עברית גבוהה, עובד בכל דפדפן, וההקלטה לא יוצאת מהשרת.
 * 2. **תמלול בדפדפן** (Web Speech API): גיבוי כשהשרת לא מוכן או
 *    נכשל — פחות מדויק בעברית, אבל מיידי ובלי עומס על השרת.
 *
 * למה חיתוך בהפסקות ולא בטיימר קבוע: Whisper אינו מודל סטרימינג —
 * הוא מפענח חלון שלם. חיתוך כל N שניות היה חותך מילים באמצע ופוגע
 * דווקא בשמות רחובות ובמספרים, שהם הכי קריטיים למתווך. לכן מנטרים
 * את עוצמת הקול ומסיימים קטע כשהדובר עוצר לנשום.
 */

/**
 * אורך הקטע מגיע מהשרת (נמדד לפי מהירות התמלול בפועל) — Whisper
 * מקודד תמיד חלון של 30 שניות, ולכן קטע קצר מזמן העיבוד היה יוצר
 * פיגור מצטבר במקום טקסט חי. עד שהשרת עונה: ערך שמרן.
 */
const DEFAULT_SEGMENT_SECONDS = 20;
/** חיתוך כפוי כשאין הפסקה — פי כמה מהאורך המומלץ. */
const SEGMENT_MAX_FACTOR = 1.6;
/** משך שקט שנחשב "הדובר סיים משפט". */
const SILENCE_MS = 500;
/** סף RMS לשקט — מתחתיו נחשב שאין דיבור. */
const SILENCE_RMS = 0.015;
/** אחרי כמה כשלים רצופים מוותרים על השרת ועוברים לדפדפן. */
const MAX_CONSECUTIVE_FAILURES = 2;

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

function getAudioContext(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["AudioContext"] ?? w["webkitAudioContext"] ?? null) as (new () => AudioContext) | null;
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
  /**
   * המצב של ההקלטה שרצה כרגע; null = לא מקליטים.
   *
   * אין כאן העדפה שמורה: המשתמש בוחר בכל לחיצה. הגדרה מרוחקת שקובעת
   * מה יקרה במסך אחר היא בדיוק מה שגרם למשתמש לחשוב שהמערכת מתעלמת
   * ממנו — הבחירה חייבת להיות במקום שבו לוחצים.
   */
  const [activeMode, setActiveMode] = useState<DictationMode | null>(null);
  const segmentSecondsRef = useRef(DEFAULT_SEGMENT_SECONDS);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // האם להמשיך לקטע הבא כשהנוכחי נסגר (false = המתווך לחץ עצירה)
  const continueRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const watcherRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef(0);
  const silenceSinceRef = useRef<number | null>(null);
  // שרשור השליחות: הקטעים חייבים להיכתב לפי הסדר שנאמרו, גם אם
  // תשובה אחת חוזרת מהר מקודמתה
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const failuresRef = useRef(0);
  const producedTextRef = useRef(false);
  // הרכיב ירד מהמסך — אין לשלוח, לעדכן state או להציג שגיאות
  const disposedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // הערך העדכני — התמלול בשרת אורך שניות, והמתווך עשוי לערוך בינתיים.
  // בלי זה התשובה הייתה דורסת את מה שהקליד (ביקורת Codex).
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setBrowserSupported(getSpeechRecognition() !== null);
    apiGet<{ available: boolean; segmentSeconds?: number }>("/voice-intakes/transcription-status")
      .then((res) => {
        setServerStt(res.available);
        if (res.segmentSeconds !== undefined && res.segmentSeconds > 0) {
          segmentSecondsRef.current = res.segmentSeconds;
        }
      })
      .catch(() => setServerStt(false));
  }, []);

  // ניתוק המיקרופון גם כשעוזבים את המסך באמצע הקלטה — בלי זה
  // ה-MediaStream ממשיך לרוץ אחרי שהרכיב ירד (ביקורת Codex)
  useEffect(() => {
    return () => {
      // דגל נטישה: קטעים שכבר בתור לא ייצאו לרשת, והבקשה שבאוויר
      // מבוטלת. בלעדיו הקלטות שהמתווך נטש היו ממשיכות להישלח לתמלול
      // אחרי שעזב את המסך (ביקורת Codex)
      disposedRef.current = true;
      abortRef.current?.abort();
      recognitionRef.current?.stop();
      continueRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") {
        // ניתוק ה-callbacks לפני העצירה: בלעדיו onstop היה שולח לתמלול
        // הקלטה שהמתווך נטש כשעזב את המסך, ומעדכן state של רכיב שירד
        // (ביקורת Codex)
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      stopWatching();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const canRecordAudio =
    typeof navigator !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    navigator.mediaDevices !== undefined;
  /*
   * ההעדפה קודמת לזמינות.
   *
   * קודם היה כאן `serverStt && canRecordAudio` בלבד — כלומר ברגע
   * ששירות התמלול זמין, הוא נבחר תמיד, וזיהוי הדפדפן שימש רק כגיבוי
   * לכשל. משתמש שבחר "מהיר — זיהוי בדפדפן" בפרופיל קיבל בכל זאת
   * תמלול בשרת, וההעדפה שלו נראתה כאילו אינה עושה כלום.
   *
   * מי שבחר "מהיר" ואין לו תמיכה בדפדפן עדיין מקבל את השרת — עדיף
   * שיעבוד מאשר שיישאר בלי מיקרופון בכלל.
   */
  // שתי היכולות, בלי הכרעה ביניהן — ההכרעה היא של המשתמש בלחיצה
  const serverAvailable = serverStt && canRecordAudio;
  const browserAvailable = browserSupported;

  function stopWatching(): void {
    if (watcherRef.current !== null) {
      clearInterval(watcherRef.current);
      watcherRef.current = null;
    }
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
  }

  /** מצב 1 — הקלטה רציפה שנחתכת בהפסקות ומתומללת תוך כדי. */
  async function startServerRecording(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("אין גישה למיקרופון — אשרו הרשאה בדפדפן או הקלידו");
      return;
    }
    streamRef.current = stream;
    continueRef.current = true;
    failuresRef.current = 0;
    producedTextRef.current = false;
    sendQueueRef.current = Promise.resolve();
    setRecording(true);
    startSegment(stream);
    startSegmentWatcher(stream);
  }

  /**
   * קטע אחד = הקלטת webm שלמה ועצמאית. מפעילים MediaRecorder חדש לכל
   * קטע במקום לחתוך זרם אחד: חיתוך של זרם webm באמצע מייצר קובץ בלי
   * כותרת שאי אפשר לפענח.
   */
  function startSegment(stream: MediaStream): void {
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      enqueueTranscription(blob);
      if (continueRef.current) {
        startSegment(stream); // ממשיכים לקטע הבא באותו זרם
      } else {
        finishRecording();
      }
    };
    mediaRecorderRef.current = recorder;
    segmentStartRef.current = performance.now();
    silenceSinceRef.current = null;
    recorder.start();
  }

  /**
   * חותך את הקטע בהפסקה טבעית של הדובר לפי עוצמת הקול. אם WebAudio
   * לא זמין בדפדפן, הניטור ממשיך לרוץ עם חיתוך לפי זמן בלבד — בלי זה
   * ההקלטה הייתה הופכת לקטע אחד ארוך שנשלח רק בסוף, כלומר הפיצ'ר
   * נעלם בשקט (ביקורת Codex).
   */
  function startSegmentWatcher(stream: MediaStream): void {
    const Ctor = getAudioContext();
    let analyser: AnalyserNode | null = null;
    let samples: Float32Array<ArrayBuffer> | null = null;
    if (Ctor) {
      const context = new Ctor();
      audioContextRef.current = context;
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      samples = new Float32Array(analyser.fftSize);
    }

    watcherRef.current = setInterval(() => {
      const recorder = mediaRecorderRef.current;
      if (recorder?.state !== "recording") return; // בין קטע לקטע

      const now = performance.now();
      if (analyser && samples) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const sample = samples[i] ?? 0;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / samples.length);
        if (rms < SILENCE_RMS) {
          silenceSinceRef.current ??= now;
        } else {
          silenceSinceRef.current = null;
        }
      }

      const minMs = segmentSecondsRef.current * 1000;
      const elapsed = now - segmentStartRef.current;
      const silentFor = silenceSinceRef.current === null ? 0 : now - silenceSinceRef.current;
      const pausedAfterSpeech = elapsed >= minMs && silentFor >= SILENCE_MS;
      if (pausedAfterSpeech || elapsed >= minMs * SEGMENT_MAX_FACTOR) {
        recorder.stop(); // onstop שולח לתמלול ופותח קטע חדש
      }
    }, 100);
  }

  /** שמירה על סדר הקטעים ועל בקשה אחת בכל רגע. */
  function enqueueTranscription(blob: Blob): void {
    sendQueueRef.current = sendQueueRef.current.then(() => sendForTranscription(blob));
  }

  async function sendForTranscription(blob: Blob): Promise<void> {
    // נבדק כאן ולא רק בכניסה לתור: קטע שממתין בתור עשוי להגיע לתורו
    // אחרי שהמתווך כבר עזב את המסך
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
        // עומס רגעי בשרת — נשארים במצב תמלול בשרת ומבקשים לנסות שוב
        onError?.("שירות התמלול עסוק כרגע — נסו שוב בעוד רגע");
        return;
      }
      if (!res.ok) throw new Error("transcribe failed");
      const body = (await res.json()) as { text?: string };
      const text = (body.text ?? "").trim();
      failuresRef.current = 0;
      // קטע ללא דיבור (הפסקה ארוכה) הוא תקין לגמרי בהקלטה רציפה —
      // מדלגים בשקט במקום להטריד בהודעת שגיאה
      if (text === "") return;
      producedTextRef.current = true;
      const current = valueRef.current;
      onChange((current ? `${current} ` : "") + text);
    } catch {
      // ביטול בעקבות עזיבת המסך אינו כשל של השירות
      if (disposedRef.current) return;
      failuresRef.current += 1;
      if (failuresRef.current < MAX_CONSECUTIVE_FAILURES) {
        onError?.("קטע אחד לא תומלל — ההקלטה ממשיכה");
        return;
      }
      // כשל חוזר ⇒ מעבר לזיהוי הדפדפן, במקום לשלוח שוב ושוב
      // לשירות שלא עונה (ביקורת Codex)
      setServerStt(false);
      // רק אם ההקלטה עדיין רצה — אחרת היינו סוגרים אותה פעמיים
      if (continueRef.current) stopServerRecording();
      onError?.(
        getSpeechRecognition() !== null
          // כפתור "מדויק" נעלם עד לרענון — אומרים את זה, במקום להבטיח
          // מעבר אוטומטי שכבר אינו קיים מאז שהבחירה היא של המשתמש
          ? "התמלול בשרת נכשל — אפשר להמשיך עם ההקלטה המהירה בדפדפן"
          : "התמלול נכשל — אפשר להקליד את הטקסט",
      );
    } finally {
      setTranscribing(false);
    }
  }

  function stopServerRecording(): void {
    continueRef.current = false;
    setRecording(false);
    setActiveMode(null);
    const recorder = mediaRecorderRef.current;
    // onstop הוא שמוסיף את הקטע האחרון לתור, ומשם finishRecording
    if (recorder?.state === "recording") recorder.stop();
    else finishRecording();
  }

  /**
   * סגירת ההקלטה אחרי שהקטע האחרון כבר בתור. חשוב שהבדיקה "לא זוהה
   * דיבור" תשורשר כאן ולא ב-stopServerRecording: שם התור עדיין לא
   * כלל את הקטע האחרון, והודעת השגיאה הייתה נורית מיד בכל הקלטה
   * קצרה — עוד לפני שהטקסט חזר (ביקורת Codex).
   */
  function finishRecording(): void {
    stopWatching();
    streamRef.current?.getTracks().forEach((track) => track.stop()); // כיבוי המיקרופון
    streamRef.current = null;
    void sendQueueRef.current.then(() => {
      if (disposedRef.current) return; // הרכיב כבר ירד מהמסך
      // אחרי כשל שירות כבר הוצגה הודעה מדויקת יותר — לא מציפים בשתיים
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) return;
      if (!producedTextRef.current) onError?.("לא זוהה דיבור בהקלטה — נסו שוב או הקלידו");
    });
  }

  /** מצב "מהיר" — זיהוי הדפדפן, הטקסט זוחל על המסך תוך כדי הדיבור. */
  function startBrowserRecognition(): void {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    /*
     * זה כל ההבדל בין "מהיר" ל"מדויק", והוא היה כבוי.
     *
     * עם interimResults=false הדפדפן מדווח רק תוצאות סופיות, ולכן
     * הטקסט הופיע רק בסוף — כלומר המצב "המהיר" התנהג בדיוק כמו
     * המצב האיטי, והכיתוב על המסך הבטיח משהו שלא קרה.
     */
    recognition.interimResults = true;

    // טקסט הבסיס נלכד פעם אחת בתחילת הסבב: התוצאות הזמניות מתעדכנות
    // שוב ושוב על אותו קטע, ובלי בסיס קבוע כל עדכון היה מצטבר כפול
    const base = valueRef.current;

    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const alt = event.results[i]?.[0];
        if (alt) text += alt.transcript;
      }
      const spoken = text.trim();
      if (spoken === "") return;
      onChange(base.trim() === "" ? spoken : `${base.trimEnd()} ${spoken}`);
    };
    recognition.onend = () => {
      setRecording(false);
      setActiveMode(null);
    };
    recognition.onerror = () => {
      setRecording(false);
      setActiveMode(null);
      onError?.("זיהוי הדיבור נכשל — אפשר להקליד במקום");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }

  /** עצירה — לפי המצב שרץ בפועל, לא לפי מה שזמין. */
  function stop(): void {
    if (activeMode === "server") stopServerRecording();
    else {
      recognitionRef.current?.stop();
      setRecording(false);
      setActiveMode(null);
    }
    setActiveMode(null);
  }

  function begin(mode: DictationMode): void {
    setActiveMode(mode);
    if (mode === "server") void startServerRecording();
    else startBrowserRecognition();
  }

  const canRecord = serverAvailable || browserAvailable;

  return (
    <>
      {canRecord ? (
        <div className="mb-4 text-center">
          {recording ? (
            <>
              <Button type="button" variant="danger" onClick={stop} className="min-w-48">
                ⏹ עצור הקלטה
              </Button>
              <p aria-live="polite" className="mt-2" style={{ color: "var(--color-danger)" }}>
                {/* ניסוח מדויק לכל מצב: בשרת הטקסט חוזר בסוף כל הפסקה,
                    ורק בזיהוי הדפדפן הוא באמת זוחל תוך כדי הדיבור */}
                {activeMode === "server"
                  ? "מקליט… כל הפסקה נשלחת לתמלול"
                  : "מקליט… הטקסט מופיע תוך כדי הדיבור"}
              </p>
            </>
          ) : transcribing ? (
            <p aria-live="polite" className="mt-2" style={{ color: "var(--color-text-muted)" }}>
              מסיים לתמלל…
            </p>
          ) : (
            <>
              {/* שני הכפתורים, תמיד, ובלי מודגש: הבחירה נעשית כאן ועכשיו
                  לפי מה שמקליטים — כתובת רוצים מדויקת, סיכום רוצים מהר */}
              <div className="flex flex-wrap justify-center gap-2">
                {browserAvailable ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => begin("browser")}
                    className="min-w-44"
                  >
                    ⚡ מהיר — בדפדפן
                  </Button>
                ) : null}
                {serverAvailable ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => begin("server")}
                    className="min-w-44"
                  >
                    🎯 מדויק — בשרת
                  </Button>
                ) : null}
              </div>
              <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {browserAvailable && serverAvailable
                  ? "מהיר — הטקסט מופיע תוך כדי הדיבור, פחות מדויק בעברית. מדויק — התמלול על השרת שלכם, איטי יותר ולא יוצא החוצה."
                  : serverAvailable
                    ? "🔒 התמלול מתבצע על השרת שלכם — ההקלטה לא נשלחת לשום גורם חיצוני"
                    : "⚡ זיהוי הדיבור של הדפדפן. לעברית מדויקת יותר נדרש שירות תמלול בשרת."}
              </p>
            </>
          )}
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
