"use client";

import { useEffect, useRef, useState } from "react";
import {
  appendDictated,
  collectDictation,
  createDictationSessions,
  dictationMode,
} from "@metavchim/shared";
import {
  extensionForAudioType,
  preferredAudioFormat,
  type DictationMode,
  type DictationResultSegment,
} from "@/lib/dictation";
import { Button } from "@metavchim/ui";
import { API_BASE, apiGet } from "@/lib/api";
import { IconLock, IconStop } from "./icons";

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
/**
 * תקרת זמן לבקשת התמלול של קטע.
 *
 * `fetch` ללא תקרה אינו נכשל לעולם כשהשרת מפסיק לענות באמצע — הוא
 * פשוט תלוי, ואיתו גם תור השליחות שסוגר את הסבב. המסך נשאר על
 * „מסיים לתמלל…” וההכתבה חסומה עד רענון העמוד (ביקורת Codex).
 * קטע הוא עד ~30 שניות אודיו, ולכן דקה וחצי היא הרבה מעבר לכל תמלול
 * סביר — גם כששירות התמלול עמוס.
 */
const SEGMENT_TRANSCRIBE_TIMEOUT_MS = 90_000;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<DictationResultSegment | undefined> }) => void) | null;
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
  /**
   * „הפסקתי לדבר, והמנוע עוד מחזיר את המשפט האחרון” (ביקורת Codex).
   *
   * `stop()` אומר למנוע להפסיק להאזין **ולהחזיר את מה שכבר אסף**,
   * ולכן `onresult` אחרון מגיע *אחרי* הקריאה. כשהכפתורים חזרו מיד,
   * משתמש שהתחיל סבב חדש באותו רגע איבד את המשפט האחרון בשקט —
   * הסבב החדש מנתק את הישן, וזה בדיוק מה שאמור לקרות. לכן הסבב
   * נשאר תפוס עד שהמנוע סוגר אותו בעצמו.
   *
   * זו כבר ההתנהגות בשדות הטפסים; כאן היא הייתה חסרה.
   */
  const [finishing, setFinishing] = useState(false);
  /**
   * ממתינים לתשובת הדפדפן על בקשת המיקרופון.
   *
   * `getUserMedia` אינו חייב לחזור: משתמש שמתעלם מחלונית ההרשאה
   * משאיר אותו תלוי לנצח. עד כה זה נראה כאילו לא קרה כלום —
   * הכפתורים נשארו על המסך, וכל לחיצה נוספת נדחתה בשקט על ידי
   * מנעול נסתר (ביקורת Codex). עכשיו ההמתנה גלויה וניתנת לביטול.
   */
  const [pending, setPending] = useState(false);
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
  /**
   * המנוע בדפדפן כבר נכשל כאן — הלחיצה הבאה תלך לשרת.
   *
   * מרגע שיש כפתור אחד הוא בוחר את המצב בעצמו, ובחירה לפי „הבנאי
   * קיים” בלבד נועלת את המשתמש על מנוע שנכשל בכל ניסיון: באנדרואיד
   * בלי חבילת עברית זה קורה תמיד, בעוד התמלול בשרת זמין ועובד
   * (ביקורת Codex, P1).
   */
  const [browserFailed, setBrowserFailed] = useState(false);
  const segmentSecondsRef = useRef(DEFAULT_SEGMENT_SECONDS);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /**
   * מי הסבב הפעיל — אותה הגנה שיש בשדות הטפסים.
   *
   * מנוע הזיהוי מחזיר תוצאה אחרונה ויורה `onend` מאות מילישניות
   * אחרי `stop()`. לחיצה חוזרת על „הקלטה” בתוך החלון הזה השאירה
   * את המנוע הישן חי — שני מנועים כותבים לאותו שדה, כל אחד עם
   * טקסט הבסיס שלו, וכל מה שנאמר הופיע פעמיים. מזהה לכל סבב סוגר
   * את זה: הלוגיקה נבדקת ב-`@metavchim/shared`.
   */
  const sessionsRef = useRef(createDictationSessions());
  /**
   * סבב הקלטה תפוס — **נלקח לפני כל `await`, ומשותף לשני המצבים.**
   *
   * המנעולים הקודמים היו לכל מצב בנפרד, ולכן חורים בין המצבים נשארו
   * פתוחים: „מדויק” ממתין ל-`getUserMedia`, ובינתיים לחיצה על „מהיר”
   * עוברת — כי `recording` עדיין כבוי וכי המסלול השני בודק רק את
   * `streamRef`. כשההרשאה חוזרת, שני המנועים מקליטים יחד, ו-`stop()`
   * מטפל רק באחד מהם: המיקרופון נשאר פתוח בלי כפתור שיעצור אותו
   * (ביקורת Codex).
   *
   * זה `ref` ולא `state` בכוונה: state מתעדכן ברינדור הבא, וכל החלון
   * שאנחנו סוגרים כאן נמצא *לפניו*.
   */
  const busyRef = useRef(false);
  /** מזהה בקשת ההרשאה הפעילה — ביטול פשוט מקדם אותו. */
  const permitRef = useRef(0);
  /** בבואה של `pending` שנקראת מתוך callbacks, שאינם רואים state. */
  const pendingRef = useRef(false);
  /** מזהה הסבב שהמנוע שב-`recognitionRef` שייך אליו. */
  const browserTokenRef = useRef(0);
  /** ממתין ל-`onend` אחרי `stop()` — ראו `finishing`. */
  const endGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    /*
     * מתאפס בעלייה ולא רק נדלק בירידה.
     *
     * הדגל נכתב ב-cleanup ולא נוקה לעולם, ולכן רכיב שנטען מחדש —
     * StrictMode בפיתוח, או מסך שמורכב שוב — נשאר עם `disposed`
     * דלוק, וכל הקלטה מדויקת נעצרה מיד אחרי אישור ההרשאה. עם מצב
     * ההמתנה החדש זה נעשה גלוי: המסך נתקע על „ממתין לאישור
     * המיקרופון” ללא מוצא (ביקורת Codex).
     *
     * `useDictation` כבר תוקן כך; כאן זה נשאר פתוח.
     */
    disposedRef.current = false;
    return () => {
      // דגל נטישה: קטעים שכבר בתור לא ייצאו לרשת, והבקשה שבאוויר
      // מבוטלת. בלעדיו הקלטות שהמתווך נטש היו ממשיכות להישלח לתמלול
      // אחרי שעזב את המסך (ביקורת Codex)
      disposedRef.current = true;
      abortRef.current?.abort();
      /*
       * גם כאן הסבב נסגר במפורש ולא רק „נעצר”: מנוע שנשאר עם
       * `onresult` דלוק כותב לשדה של רכיב שכבר ירד מהמסך.
       */
      retireRecognition();
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

  /** מצב ההמתנה נכתב לשניהם יחד — ה-state לתצוגה, ה-ref ללוגיקה. */
  function markPending(value: boolean): void {
    pendingRef.current = value;
    setPending(value);
  }

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
    const permit = (permitRef.current += 1);
    markPending(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // תשובה שהגיעה אחרי שהמשתמש כבר ביטל, או אחרי שעזב את המסך,
      // אינה שלנו — ואין לה למי לדווח
      if (permitRef.current !== permit || disposedRef.current) return;
      markPending(false);
      busyRef.current = false;
      setActiveMode(null);
      onError?.("אין גישה למיקרופון — אשרו הרשאה בדפדפן או הקלידו");
      return;
    }
    if (permitRef.current !== permit || disposedRef.current) {
      // בוטל בזמן ההמתנה, או שהרכיב ירד — הזרם שהגיע באיחור נסגר
      // ואינו מקליט דבר. שתי הבדיקות יחד ולפני כל עדכון מצב.
      stream.getTracks().forEach((track) => track.stop());
      if (permitRef.current !== permit) return;
      /*
       * הבקשה עדיין שלנו — ולכן משחררים בכל מקרה, גם אם הדגל אומר
       * שהרכיב ירד. אם הוא בכל זאת על המסך, זו ההגנה מפני מסך שתקוע
       * על „ממתין לאישור המיקרופון” בלי מוצא; ואם הוא באמת ירד,
       * העדכון הוא no-op.
       */
      busyRef.current = false;
      markPending(false);
      setActiveMode(null);
      return;
    }
    markPending(false);
    /*
     * בקשת ההרשאה למיקרופון היא `await`, ולכן שתי לחיצות מהירות על
     * „הקלטה” הגיעו לכאן שתיהן — הבדיקה ב-`begin` נשענת על state
     * שעוד לא התעדכן. עד כה כל אחת פתחה מקליט וצופה-קטעים משלה,
     * וכל קטע נשלח לתמלול פעמיים: הטקסט הופיע כפול וההקלטה
     * הראשונה נשארה פתוחה עם המיקרופון דלוק. השנייה מוותרת.
     */
    if (streamRef.current !== null) {
      stream.getTracks().forEach((track) => track.stop());
      busyRef.current = false;
      return;
    }
    streamRef.current = stream;
    continueRef.current = true;
    failuresRef.current = 0;
    producedTextRef.current = false;
    sendQueueRef.current = Promise.resolve();
    if (!startSegment(stream)) {
      /*
       * המקליט לא עלה — משחררים הכול. בלי זה המנעול שמונע שני
       * מקליטים במקביל נשאר נעול על סבב שמעולם לא התחיל, וכל ניסיון
       * הקלטה נוסף נדחה בשקט בעוד המיקרופון פתוח (ביקורת Codex).
       */
      continueRef.current = false;
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      busyRef.current = false;
      setActiveMode(null);
      // „מהיר” ירד מהמסך — הפניה אליו היא הוראה שאי אפשר לבצע
      onError?.("ההקלטה לא נפתחה במכשיר הזה — אפשר להקליד במקום");
      return;
    }
    setRecording(true);
    startSegmentWatcher(stream);
  }

  /**
   * קטע אחד = הקלטה שלמה ועצמאית. מפעילים MediaRecorder חדש לכל קטע
   * במקום לחתוך זרם אחד: חיתוך של זרם באמצע מייצר קובץ בלי כותרת
   * שאי אפשר לפענח.
   *
   * הפורמט נבחר ולא מונח: ספארי אינו יודע להקליט webm כלל, ולכן
   * ההנחה הקשיחה שהייתה כאן שלחה mp4 בשם ‎.webm‎ מכל iPhone ו-iPad —
   * ראו `preferredAudioFormat` ב-`lib/dictation.ts`.
   */
  /**
   * פותח קטע הקלטה. מחזיר `false` אם המקליט לא עלה בכלל.
   *
   * ## למה זה מחזיר ערך ולא פשוט זורק
   *
   * `new MediaRecorder(...)` ו-`start()` יכולים לזרוק — פורמט שהמכשיר
   * מכריז עליו ואינו תומך בו בפועל הוא המקרה השכיח. עד כה זריקה כזו
   * השאירה את `mediaRecorderRef` ואת הזרם דלוקים בלי שאיש יסגור
   * אותם: המסך נראה רגוע, המיקרופון נשאר פתוח, וכל ניסיון הקלטה
   * נוסף נדחה על ידי המנעול החדש שנועד למנוע כפילות (ביקורת Codex).
   *
   * הקורא הוא זה שיודע מה לעשות בכישלון — לשחרר הכול בפתיחה, או
   * לסגור את הסבב באמצע — ולכן התשובה חוזרת אליו.
   */
  function startSegment(stream: MediaStream): boolean {
    const chunks: Blob[] = [];
    const format = preferredAudioFormat();
    let recorder: MediaRecorder;
    try {
      recorder =
        format === undefined
          ? new MediaRecorder(stream)
          : new MediaRecorder(stream, { mimeType: format.mimeType });
    } catch {
      return false;
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const actual = recorder.mimeType || chunks[0]?.type || "";
      const blob = new Blob(chunks, ...(actual ? [{ type: actual }] : []));
      enqueueTranscription(blob);
      // קטע הבא באותו זרם; אם המקליט אינו נפתח, סוגרים את הסבב
      // במקום להשאיר מיקרופון פתוח שאיש כבר אינו מקליט ממנו
      if (continueRef.current && startSegment(stream)) return;
      continueRef.current = false;
      finishRecording();
    };
    mediaRecorderRef.current = recorder;
    segmentStartRef.current = performance.now();
    silenceSinceRef.current = null;
    try {
      recorder.start();
    } catch {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      mediaRecorderRef.current = null;
      return false;
    }
    return true;
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
      /*
       * ניתוח עוצמת הקול הוא שיפור, לא תנאי: בלעדיו הקטעים נחתכים
       * לפי משך במקום לפי הפסקה טבעית. `AudioContext` שנופל (מדיניות
       * autoplay, מכשיר עמוס) לא אמור להפיל את ההקלטה כולה ולהשאיר
       * את המיקרופון פתוח.
       */
      try {
        const context = new Ctor();
        audioContextRef.current = context;
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
        samples = new Float32Array(analyser.fftSize);
      } catch {
        analyser = null;
        samples = null;
      }
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
    /*
     * ויתרנו על השרת — התור מתרוקן בלי לשלוח (ביקורת Codex).
     *
     * התור סדרתי, ותקרת הזמן חוסמת כל בקשה בנפרד. שרת שמקבל בקשות
     * ואינו עונה גרם לכך ששני הכשלים הראשונים כיבו את התמלול בשרת —
     * אבל כל קטע שכבר הצטבר בתור המשיך לחכות דקה וחצי משלו. ההקלטה
     * נגמרה, המיקרופון נסגר, והמסך נשאר תקוע על „מסיים לתמלל…”
     * דקות ארוכות, כי המנעול משתחרר רק כשהתור מתרוקן.
     *
     * `failuresRef` מתאפס בתחילת כל סבב, ולכן זה אינו חוסם הקלטה
     * הבאה — רק את שאריות הסבב שכבר ויתרנו עליו.
     */
    if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) return;
    setTranscribing(true);
    const controller = new AbortController();
    abortRef.current = controller;
    // שרת שהפסיק לענות באמצע אינו רשאי להשאיר את הסבב פתוח לנצח
    const timeout = setTimeout(() => controller.abort(), SEGMENT_TRANSCRIBE_TIMEOUT_MS);
    try {
      const form = new FormData();
      // הסיומת נגזרת מהפורמט שהוקלט בפועל — שירות התמלול פותח לפיה
      form.append("file", blob, `recording.${extensionForAudioType(blob.type)}`);
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
      clearTimeout(timeout);
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
      // הסבב נגמר רק כשהקטע האחרון כבר תומלל — עד אז סבב חדש היה
      // מאפס את תור השליחות מתחת לרגליו
      busyRef.current = false;
      if (disposedRef.current) return; // הרכיב כבר ירד מהמסך
      // אחרי כשל שירות כבר הוצגה הודעה מדויקת יותר — לא מציפים בשתיים
      if (failuresRef.current >= MAX_CONSECUTIVE_FAILURES) return;
      if (!producedTextRef.current) onError?.("לא זוהה דיבור בהקלטה — נסו שוב או הקלידו");
    });
  }

  /**
   * ניתוק מוחלט של מנוע הזיהוי שרץ כרגע — לא רק החלפת ה-ref.
   *
   * מנוע שאיש לא עצר ממשיך להאזין ולירות `onresult`, ושני מנועים
   * חיים כותבים כל מילה פעמיים. `stop()` על מנוע שכבר נסגר זורק
   * בחלק מהדפדפנים, ולכן הוא עטוף.
   */
  function retireRecognition(): void {
    if (endGuardRef.current !== null) {
      clearTimeout(endGuardRef.current);
      endGuardRef.current = null;
    }
    const previous = recognitionRef.current;
    recognitionRef.current = null;
    browserTokenRef.current = 0;
    if (previous === null) return;
    previous.onresult = null;
    previous.onend = null;
    previous.onerror = null;
    try {
      previous.stop();
    } catch {
      /* מנוע שכבר נסגר — אין מה לעצור */
    }
  }

  /** מצב "מהיר" — זיהוי הדפדפן, הטקסט זוחל על המסך תוך כדי הדיבור. */
  function startBrowserRecognition(): void {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      busyRef.current = false;
      setActiveMode(null);
      return;
    }
    // סבב חדש מבטל את הקודם במפורש, ולא מקווה שייסגר בזמן
    retireRecognition();
    const sessions = sessionsRef.current;
    const token = sessions.begin();
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

    // סט חדש לכל סשן — זיכרון "מי היה זמני" חי בין אירועי onresult
    const interimSeen = new Set<number>();
    recognition.onresult = (event) => {
      // תוצאה מאוחרת של סבב שכבר הוחלף אינה שייכת לשדה שלפנינו
      if (!sessions.isCurrent(token)) return;
      // collectDictation מסנן קטע רפאים שמופיע פעמיים ברצף — הבאג של
      // כרום באנדרואיד שגרם לכל משפט להיכתב פעמיים (מסונן גם בשדות)
      const { final, interim } = collectDictation(event.results, interimSeen);
      const spoken = `${final}${interim}`.trim();
      if (spoken === "") return;
      onChange(appendDictated(base, spoken));
    };
    recognition.onend = () => {
      if (!sessions.end(token)) return;
      retireRecognition();
      busyRef.current = false;
      setRecording(false);
      setFinishing(false);
      setActiveMode(null);
    };
    recognition.onerror = () => {
      if (!sessions.end(token)) return;
      retireRecognition();
      busyRef.current = false;
      setRecording(false);
      setFinishing(false);
      setActiveMode(null);
      setBrowserFailed(true);
      onError?.(
        serverAvailable
          ? "זיהוי הדיבור בדפדפן נכשל — לחצו שוב, והתמלול יעבור לשרת"
          : "זיהוי הדיבור נכשל — אפשר להקליד במקום",
      );
    };
    recognitionRef.current = recognition;
    browserTokenRef.current = token;
    try {
      recognition.start();
    } catch {
      // מנוע שאינו עולה אינו רשאי להשאיר את הסבב תפוס לנצח
      sessions.end(token);
      retireRecognition();
      busyRef.current = false;
      setActiveMode(null);
      setBrowserFailed(true);
      onError?.(
        serverAvailable
          ? "זיהוי הדיבור בדפדפן נכשל — לחצו שוב, והתמלול יעבור לשרת"
          : "זיהוי הדיבור נכשל — אפשר להקליד במקום",
      );
      return;
    }
    setRecording(true);
  }

  /** עצירה — לפי המצב שרץ בפועל, לא לפי מה שזמין. */
  function stop(): void {
    /*
     * ביטול בזמן ההמתנה להרשאה. אי אפשר לבטל `getUserMedia` עצמו,
     * ולכן במקום זה מקדמים את מזהה הבקשה: הזרם שיגיע באיחור יזוהה
     * כלא-שלנו וייסגר מיד.
     */
    if (pendingRef.current) {
      permitRef.current += 1;
      markPending(false);
      busyRef.current = false;
      setActiveMode(null);
      return;
    }
    if (activeMode === "server") {
      stopServerRecording();
      setActiveMode(null);
      return;
    }
    const recognition = recognitionRef.current;
    if (recognition === null) {
      busyRef.current = false;
      setRecording(false);
      setFinishing(false);
      setActiveMode(null);
      return;
    }
    /*
     * הסבב נגמר ב-`onend` ולא כאן — המשפט האחרון עוד באוויר.
     * `activeMode` נשמר עד אז כדי ש„עצור” נוסף ינותב לאותו מסלול.
     */
    const guarded = browserTokenRef.current;
    recognition.stop();
    setRecording(false);
    setFinishing(true);
    /*
     * רשת ביטחון למנוע שאינו יורה `onend` — אחרת הסבב נשאר תפוס
     * לנצח ואי אפשר להכתיב שוב. עשר שניות הן הרבה מעבר לכל סגירה
     * סבירה: מנוע שנשען על רשת יכול לסגור משפט גם אחרי שנייה וחצי,
     * וניתוק מוקדם היה בולע בשקט בדיוק את מה שבאנו לשמר.
     *
     * השעון שייך לסבב מסוים: אם בינתיים נפתח סבב חדש הוא אינו רשאי
     * לגעת בו.
     */
    if (endGuardRef.current !== null) clearTimeout(endGuardRef.current);
    endGuardRef.current = setTimeout(() => {
      endGuardRef.current = null;
      if (!sessionsRef.current.end(guarded)) return;
      retireRecognition();
      busyRef.current = false;
      setFinishing(false);
      setActiveMode(null);
    }, 10_000);
  }

  function begin(mode: DictationMode): void {
    /*
     * סבב שכבר רץ אינו נפתח שוב. הכפתור אמנם מוחלף ב„עצור” בזמן
     * הקלטה, אבל בין הלחיצה לרינדור יש חלון — ולחיצה כפולה מהירה,
     * שכיחה במסך מגע, נכנסה בו והשאירה שני מקליטים על אותו שדה.
     */
    if (busyRef.current || recording || finishing || pending) return;
    busyRef.current = true;
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
                <IconStop s={15} /> עצור הקלטה
              </Button>
              <p aria-live="polite" className="mt-2" style={{ color: "var(--color-danger)" }}>
                {/* ניסוח מדויק לכל מצב: בשרת הטקסט חוזר בסוף כל הפסקה,
                    ורק בזיהוי הדפדפן הוא באמת זוחל תוך כדי הדיבור */}
                {activeMode === "server"
                  ? "מקליט… כל הפסקה נשלחת לתמלול"
                  : "מקליט… הטקסט מופיע תוך כדי הדיבור"}
              </p>
            </>
          ) : pending ? (
            /*
              חלונית ההרשאה של הדפדפן אינה חייבת להיענות, ו-`getUserMedia`
              יכול להישאר תלוי לנצח. בלי הענף הזה הכפתורים נראו זמינים
              וכל לחיצה נדחתה בשקט על ידי מנעול נסתר (ביקורת Codex).
            */
            <>
              <Button type="button" variant="ghost" onClick={stop} className="min-w-48">
                ביטול
              </Button>
              <p aria-live="polite" className="mt-2" style={{ color: "var(--color-text-muted)" }}>
                ממתין לאישור המיקרופון בדפדפן…
              </p>
            </>
          ) : transcribing || finishing ? (
            /*
              הכפתורים אינם חוזרים כל עוד הסבב לא נסגר. `finishing`
              הוא החלון שבין „עצור” לבין המשפט האחרון שהמנוע עוד
              מחזיר — סבב חדש שנפתח בתוכו היה בולע אותו (ביקורת Codex).
            */
            <p aria-live="polite" className="mt-2" style={{ color: "var(--color-text-muted)" }}>
              מסיים לתמלל…
            </p>
          ) : (
            <>
              {/*
                ‎**כפתור אחד, לא שניים.**

                היו כאן „מהיר” ו„מדויק”, והבחירה ביניהם הוטלה על מי
                שרק רוצה לדבר במקום להקליד. בפועל כמעט איש לא נגע
                ב„מדויק” — שתי אפשרויות לפעולה אחת הן שאלה שאין לרוב
                האנשים דעה עליה, והן מאטות גם את מי שכן יודע.

                המצב **לא בוטל**: זיהוי הדפדפן הוא ברירת המחדל כי הוא
                מציג טקסט תוך כדי הדיבור, ובדפדפן שאין בו כזה (פיירפוקס,
                חלק מגרסאות ספארי) אותו כפתור נופל לתמלול בשרת. אף אחד
                לא מאבד את התכונה, ואיש אינו נדרש לבחור.
              */}
              <Button
                type="button"
                variant="primary"
                onClick={() =>
                  begin(
                    dictationMode({
                      browserReady: browserAvailable,
                      serverReady: serverAvailable,
                      browserFailed,
                    }),
                  )
                }
                className="min-w-56"
              >
                🎤 דברו במקום להקליד
              </Button>
              <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
                {browserAvailable && !browserFailed ? (
                  "הסוכן הקולי מקשיב וכותב בשבילכם — הטקסט מופיע תוך כדי הדיבור, ואפשר לערוך אותו אחר כך."
                ) : (
                  <>
                    <IconLock s={15} /> הסוכן הקולי מקשיב וכותב בשבילכם. התמלול
                    מתבצע בשרת של המערכת — ההקלטה לא נשלחת לשום גורם חיצוני.
                  </>
                )}
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
          style={{ borderColor: "var(--color-input-border)", background: "var(--color-bg)" }}
        />
      </div>
    </>
  );
}
