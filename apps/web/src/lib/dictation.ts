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

/**
 * אין ברירת מחדל ואין העדפה שמורה.
 *
 * היה כאן מצב מועדף שנבחר בעמוד הפרופיל, והוא היה טעות: הוא הוסיף
 * מסך שצריך למצוא, הוא לא היה גלוי במקום שבו מקליטים, וכל מסך
 * שהתעלם ממנו נראה שבור. במקומו — שני כפתורים מפורשים בכל מקום
 * שיש בו הקלטה, והמשתמש בוחר בכל פעם מחדש לפי מה שהוא עושה עכשיו:
 * כתובת רוצים מדויקת, סיכום שיחה רוצים מהר.
 */

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

/**
 * איסוף הטקסט מרשימת תוצאות הזיהוי — עם סינון השכפול של אנדרואיד.
 *
 * כרום באנדרואיד, במצב continuous, משכפל קטעים: אותה תוצאה מופיעה
 * פעמיים ברצף ברשימה, והטקסט נכתב פעמיים (דיווח המשתמש: "רושם
 * פעמיים" במצב המהיר).
 *
 * ## איך מבדילים שכפול מחזרה מכוונת
 *
 * מי שחוזר על מילה אחרי הפסקה ("לא… לא") מייצר באמת שני קטעים
 * זהים עוקבים — ומחיקת כל קטע שזהה לקודמו הייתה בולעת גם אותם
 * (ביקורת Codex). ההבדל הוא בדרך שבה הקטע נולד: קטע אמיתי גדל מול
 * העיניים — הוא מופיע קודם כתוצאה זמנית (isFinal=false) באירועים
 * קודמים ורק אז מתקבע; קטע הרפאים של אנדרואיד מופיע יש-מאין, סופי
 * מיד, לצד התאום שלו. לכן `interimSeen` — סט האינדקסים שנראו אי
 * פעם כזמניים בסבב הזה, שהקורא מחזיק בין אירועים — קובע: קטע זהה
 * לקודמו נמחק רק אם מעולם לא היה זמני.
 *
 * משותף לשני מנועי ההכתבה (שדות הטפסים ומסך הסוכן) — תיקון שחי
 * רק באחד מהם היה משאיר את אותה כפילות בשני.
 */
export interface DictationResultSegment {
  readonly isFinal?: boolean;
  readonly 0?: { transcript: string } | undefined;
}

export function collectDictation(
  results: ArrayLike<DictationResultSegment | undefined>,
  /** אינדקסים שנראו כתוצאה זמנית בסבב הזה — סט אחד לכל סשן הקלטה */
  interimSeen: Set<number>,
): { final: string; interim: string } {
  let final = "";
  let interim = "";
  let previous = "";
  for (let i = 0; i < results.length; i += 1) {
    const segment = results[i];
    const text = segment?.[0]?.transcript ?? "";
    if (text.trim() === "") continue;
    const isInterim = segment?.isFinal === false;
    if (isInterim) interimSeen.add(i);
    // קטע רפאים: זהה לקודמו, סופי, ומעולם לא חי כתוצאה זמנית
    if (!isInterim && text.trim() === previous.trim() && !interimSeen.has(i)) continue;
    previous = text;
    if (isInterim) interim += text;
    else final += text;
  }
  return { final, interim };
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
  /** ממתין ל-`onend` אחרי `stop()` — ראו ההערה ב-`stop`. */
  const endGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ה-callback העדכני — ההקלטה חיה בין רינדורים, ולולאת הסגירה
  // (closure) הייתה נצמדת לגרסה הישנה ודורסת עריכות של המשתמש
  const appendRef = useRef(onAppend);
  appendRef.current = onAppend;

  useEffect(() => {
    /*
     * מתאפס בעלייה ולא רק נדלק בירידה.
     *
     * הדגל נכתב ב-cleanup ולא נוקה לעולם, ולכן רכיב שנטען מחדש —
     * StrictMode בפיתוח, או מסך שמורכב שוב — נשאר עם `disposed`
     * דלוק: `setServerReady` לא נורה ו-`transcribe` יצא מיד.
     * כלומר ההכתבה מתה בשקט, בלי שום שגיאה.
     */
    disposedRef.current = false;
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
      if (endGuardRef.current !== null) clearTimeout(endGuardRef.current);
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
    // סט חדש לכל סשן — זיכרון "מי היה זמני" חי בין אירועי onresult
    const interimSeen = new Set<number>();
    recognition.onresult = (event) => {
      const { final, interim } = collectDictation(event.results, interimSeen);
      const combined = `${final}${interim}`.trim();
      if (combined !== "") appendRef.current(combined, interim !== "");
    };
    recognition.onend = () => {
      if (endGuardRef.current !== null) {
        clearTimeout(endGuardRef.current);
        endGuardRef.current = null;
      }
      recognitionRef.current = null;
      setRecording(null);
    };
    recognition.onerror = () => {
      if (endGuardRef.current !== null) {
        clearTimeout(endGuardRef.current);
        endGuardRef.current = null;
      }
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
    /*
     * `transcribing` נדלק **כאן** ולא רק כשהבקשה יוצאת.
     *
     * `recorder.onstop` הוא אסינכרוני, ולכן בין `stop()` לבין תחילת
     * התמלול היה רגע שבו גם `recording` וגם `transcribing` כבויים —
     * ומי שמאזין ל"סבב הסתיים" (`onIdle`) נורה באמצע הסבב ואיפס את
     * טקסט הבסיס בטרם עת. הדלקה מראש סוגרת את החלון: הסבב נחשב פעיל
     * מרגע ההקלטה ועד שהטקסט חזר.
     */
    setTranscribing(true);
    setRecording("server");
  }, []);

  async function transcribe(blob: Blob): Promise<void> {
    // ההקלטה כבר סימנה `transcribing`; הקלטה ריקה חייבת לכבות אותו
    // בעצמה, אחרת הסבב נשאר "פעיל" לנצח והכפתורים אינם חוזרים
    if (blob.size === 0 || disposedRef.current) {
      setTranscribing(false);
      return;
    }
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
      /*
       * הסבב נגמר ב-`onend` ולא כאן.
       *
       * `stop()` אומר למנוע להפסיק להאזין **ולהחזיר את מה שכבר אסף**,
       * ולכן `onresult` אחרון מגיע *אחרי* הקריאה הזו, ו-`onend`
       * אחריו. סימון הסבב כגמור כאן היה מאפס את טקסט הבסיס
       * (`onIdle` ⟵ `useAppender.reset`) בעודו באוויר, והקטע האחרון
       * היה נכתב שוב על טקסט שכבר כולל אותו — כלומר המשפט האחרון
       * מופיע פעמיים (דיווח המשתמש: „ההכתבה מתמללת פעמיים”).
       *
       * `voice-recorder` לא סבל מזה כי הוא לוכד את הבסיס פעם אחת
       * לסשן ואינו מאפס אותו כלל.
       */
      recognition.stop();
      /*
       * רשת ביטחון: מנוע שאינו יורה `onend` היה משאיר את הכפתורים
       * במצב „מקליט” לנצח. שנייה וחצי היא הרבה מעבר לזמן שכרום לוקח,
       * ועדיין קצרה מספיק כדי לא להיראות תקוע.
       */
      endGuardRef.current = setTimeout(() => {
        endGuardRef.current = null;
        recognitionRef.current = null;
        setRecording(null);
      }, 1500);
      return;
    }
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    setRecording(null);
  }, []);

  const clearError = useCallback((): void => setError(null), []);

  return { browserReady, serverReady, recording, transcribing, error, start, stop, clearError };
}
