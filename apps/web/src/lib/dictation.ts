"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUDIO_RECORDING_FORMATS,
  collectDictation,
  createDictationSessions,
  extensionForAudioType,
  type DictationResultSegment,
} from "@metavchim/shared";
import { API_BASE, apiGet } from "@/lib/api";

export { extensionForAudioType, collectDictation };
export type { DictationResultSegment };

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
 * תקרת זמן לבקשת התמלול.
 *
 * `fetch` ללא תקרה אינו נכשל לעולם כשהשרת מפסיק לענות באמצע — הוא
 * פשוט תלוי. הסבב נשאר „פעיל”, המסך תקוע על „מתמלל”, וההכתבה חסומה
 * עד רענון העמוד (ביקורת Codex). הכתבה בשדה טופס היא 3–10 שניות של
 * אודיו, ולכן דקה היא הרבה מעבר לכל תמלול סביר וגם גבול ברור.
 */
const TRANSCRIBE_TIMEOUT_MS = 60_000;

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
  onerror: ((event: { error?: string }) => void) | null;
}

/**
 * למה זיהוי הדיבור נכשל — בניסוח שאפשר לעשות איתו משהו.
 *
 * עד כה כל כשל קיבל את אותו משפט („זיהוי הדיבור בדפדפן נכשל”),
 * וזה בדיוק המצב שבו המשתמש אינו יכול לדעת אם צריך לאשר מיקרופון,
 * לדבר חזק יותר, או לעבור למצב המדויק. בטלפון זה קריטי יותר מאשר
 * במחשב: שם ההרשאה נשאלת פעם אחת בכרטיסייה, וכאן היא נשאלת לכל
 * אתר ולעיתים נדחית בטעות.
 *
 * `language-not-supported` הוא החשוד המרכזי בפער בין מחשב לטלפון:
 * מנוע הזיהוי במחשב הוא ענן שיש בו עברית, ובאנדרואיד הוא נשען על
 * חבילת השפה שמותקנת במכשיר — ואם אין בה עברית, הזיהוי נכשל שם
 * ועובד כאן.
 */
export function dictationErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "הדפדפן חסם את המיקרופון — אשרו גישה למיקרופון בהגדרות האתר ונסו שוב";
    case "audio-capture":
      return "לא נמצא מיקרופון במכשיר — אפשר להקליד או לנסות ממכשיר אחר";
    case "language-not-supported":
      return "זיהוי הדיבור במכשיר הזה אינו תומך בעברית — השתמשו ב„מדויק”, שמתמלל בשרת";
    case "network":
      return "זיהוי הדיבור בדפדפן דורש חיבור לרשת — נסו „מדויק” או בדקו את החיבור";
    case "no-speech":
      return "לא נשמע דיבור — נסו שוב קרוב יותר למיקרופון";
    default:
      return "זיהוי הדיבור בדפדפן נכשל — אפשר לנסות הקלטה מדויקת או להקליד";
  }
}

/*
 * `collectDictation` ו-`DictationResultSegment` עברו ל-`@metavchim/shared`
 * (ראו `logic/dictation.ts`) ומיוצאים מכאן מחדש לשם תאימות.
 *
 * הסיבה מעשית: ב-`apps/web` אין הרצת בדיקות, ולכן שני התיקונים
 * הקודמים לכפילות ההכתבה נמסרו בלי שאיש הריץ עליהם ולו מקרה אחד.
 * בחבילה המשותפת יש להם בדיקות.
 */

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

/* ---------- פורמט ההקלטה ---------- */

/**
 * הפורמט שהדפדפן **באמת** יודע להקליט.
 *
 * ## למה זה לא קבוע
 *
 * הקוד כאן בנה תמיד `Blob(..., { type: "audio/webm" })` ושלח בשם
 * `recording.webm`. בכרום במחשב זה נכון במקרה — הוא באמת מקליט webm.
 * ספארי אינו יודע להקליט webm **בכלל**: ב-iPhone וב-iPad
 * `MediaRecorder` מפיק `audio/mp4`, וכל דפדפן ב-iOS הוא ספארי מתחת
 * למכסה. כלומר ההקלטה יצאה mp4 עטופה בתווית webm ובשם ‎.webm‎.
 *
 * זה לא נעצר בתווית: שירות התמלול פותח קובץ זמני **לפי הסיומת של
 * השם שנשלח** (`infra/stt/server.py`), ולכן קובץ mp4 נכתב כ-‎.webm‎
 * ומגיע למפענח כשקר. זו הסיבה שההכתבה עבדה מצוין במחשב ולא עשתה
 * דבר בטלפון (דיווח המשתמש).
 *
 * ## למה רשימה ולא בדיקת ספארי
 *
 * זיהוי דפדפן לפי `userAgent` מזדקן ומשקר. `isTypeSupported` היא
 * שאלה ישירה למי שיודע את התשובה, והסדר כאן הוא סדר העדפה: opus
 * דחוס יותר ומדויק יותר לדיבור, ו-mp4 הוא מה שנשאר כשאין.
 */
/** הפורמט הראשון ברשימה שהדפדפן הזה תומך בו, או `undefined` = ברירת המחדל שלו. */
export function preferredAudioFormat(): { mimeType: string; extension: string } | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  // דפדפן ישן ללא `isTypeSupported` — נותנים לו לבחור בעצמו
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return AUDIO_RECORDING_FORMATS.find((format) => MediaRecorder.isTypeSupported(format.mimeType));
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
  /** ממתינים לתשובת הדפדפן על בקשת המיקרופון — ניתן לביטול ב-`stop`. */
  pending: boolean;
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
  /**
   * ממתינים לתשובת הדפדפן על בקשת המיקרופון.
   *
   * `getUserMedia` אינו חייב לחזור: משתמש שמתעלם מחלונית ההרשאה
   * משאיר אותו תלוי לנצח. עד כה זה נראה כאילו לא קרה כלום — הכפתורים
   * נשארו על המסך, וכל לחיצה נוספת נדחתה בשקט על ידי מנעול נסתר
   * (ביקורת Codex). עכשיו ההמתנה גלויה, ואפשר לבטל אותה.
   */
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const disposedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** ממתין ל-`onend` אחרי `stop()` — ראו ההערה ב-`stop`. */
  const endGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * מי הסבב הפעיל — התיקון ל„ההכתבה מתמללת פעמיים”.
   *
   * מנוע הזיהוי אינו נעצר ברגע ש-`stop()` נקרא: הוא מחזיר תוצאה
   * אחרונה ואז יורה `onend`, מאות מילישניות אחר כך. עד כה הזהות
   * של הסבב הייתה ה-ref היחיד שהחזיק את המנוע, ולכן לחיצה חוזרת
   * על „מהיר” לפני שהסבב הקודם נסגר הפילה שרשרת שלמה: `onend`
   * הישן אִפֵּס את ה-ref — כלומר ניתק את המערכת מהמנוע **החדש**
   * שכבר רץ — כיבה את „מקליט”, וכיבוי הסבב אִפֵּס את טקסט הבסיס
   * בעוד המנוע החדש ממשיך לכתוב. מכאן ואילך כל מה שנאמר נכתב על
   * טקסט שכבר מכיל אותו, ולחיצה נוספת הוסיפה מנוע שלישי שמקליט
   * במקביל. שתי דרכים שונות לאותה תוצאה: הכול פעמיים.
   *
   * עכשיו לכל סבב מזהה משלו, וכל callback מציג אותו לפני שהוא
   * נוגע במצב. הלוגיקה עצמה נבדקת ב-`@metavchim/shared`.
   */
  const sessionsRef = useRef(createDictationSessions());
  /**
   * סבב הקלטה תפוס — **נלקח לפני כל `await`, ומשותף לשני המצבים.**
   *
   * המנעולים הקודמים היו לכל מצב בנפרד, ולכן החור שבין המצבים נשאר
   * פתוח: „מדויק” ממתין ל-`getUserMedia`, ובינתיים לחיצה על „מהיר”
   * עוברת — `recording` ו-`transcribing` עדיין כבויים. כשההרשאה
   * חוזרת, המסלול השני בודק רק את `recorderRef` ומתחיל גם הוא: שני
   * מנועים מקליטים יחד, `stop()` מעדיף את מנוע הזיהוי, וה-`onend`
   * שלו מכבה את מצב ההקלטה בעוד ה-`MediaRecorder` ממשיך לרוץ בלי
   * כפתור שיעצור אותו (ביקורת Codex).
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
  // ה-callback העדכני — ההקלטה חיה בין רינדורים, ולולאת הסגירה
  // (closure) הייתה נצמדת לגרסה הישנה ודורסת עריכות של המשתמש
  const appendRef = useRef(onAppend);
  appendRef.current = onAppend;

  /**
   * ניתוק מוחלט של מנוע הזיהוי שרץ כרגע, אם יש כזה.
   *
   * לא די בהחלפת ה-ref: מנוע שאיש לא עצר ממשיך להאזין למיקרופון
   * ולירות `onresult`, ושני מנועים חיים כותבים כל מילה פעמיים. לכן
   * כאן מסירים את המאזינים **וגם** עוצרים בפועל. `stop()` על מנוע
   * שכבר נסגר זורק בחלק מהדפדפנים, ולכן הוא עטוף.
   */
  const retireBrowser = useCallback((): void => {
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
  }, []);

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
    const sessions = sessionsRef.current;
    const retire = retireBrowser;
    return () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      /*
       * גם כאן הסבב נסגר במפורש ולא רק „נעצר”: רכיב שירד מהמסך
       * בעוד המנוע חי היה משאיר `onresult` שכותב לשדה שכבר איננו.
       */
      sessions.end(browserTokenRef.current);
      retire();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder?.state === "recording") {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [retireBrowser]);

  const startBrowser = useCallback((): void => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      busyRef.current = false;
      return;
    }
    // סבב חדש מבטל את הקודם במפורש, ולא מקווה שייסגר בזמן
    retireBrowser();
    const sessions = sessionsRef.current;
    const token = sessions.begin();
    const recognition = new Ctor();
    recognition.lang = "he-IL";
    recognition.continuous = true;
    // התוצאות הזמניות הן כל העניין במצב המהיר: הטקסט זוחל על המסך
    // תוך כדי הדיבור במקום לקפוץ בסוף המשפט
    recognition.interimResults = true;
    // סט חדש לכל סשן — זיכרון "מי היה זמני" חי בין אירועי onresult
    const interimSeen = new Set<number>();
    recognition.onresult = (event) => {
      // תוצאה מאוחרת של סבב שכבר הוחלף אינה שייכת לשדה שלפנינו
      if (!sessions.isCurrent(token)) return;
      const { final, interim } = collectDictation(event.results, interimSeen);
      const combined = `${final}${interim}`.trim();
      if (combined !== "") appendRef.current(combined, interim !== "");
    };
    recognition.onend = () => {
      if (!sessions.end(token)) return;
      if (endGuardRef.current !== null) {
        clearTimeout(endGuardRef.current);
        endGuardRef.current = null;
      }
      recognitionRef.current = null;
      browserTokenRef.current = 0;
      busyRef.current = false;
      setRecording(null);
    };
    recognition.onerror = (event) => {
      if (!sessions.end(token)) return;
      if (endGuardRef.current !== null) {
        clearTimeout(endGuardRef.current);
        endGuardRef.current = null;
      }
      recognitionRef.current = null;
      browserTokenRef.current = 0;
      busyRef.current = false;
      setRecording(null);
      setError(dictationErrorMessage(event?.error));
    };
    recognitionRef.current = recognition;
    browserTokenRef.current = token;
    try {
      recognition.start();
    } catch {
      // מנוע שאינו עולה אינו רשאי להשאיר את הסבב תפוס לנצח
      sessions.end(token);
      retireBrowser();
      busyRef.current = false;
      setError(dictationErrorMessage(undefined));
      return;
    }
    setRecording("browser");
  }, [retireBrowser]);

  /** מצב ההמתנה נכתב לשניהם יחד — ה-state לתצוגה, ה-ref ללוגיקה. */
  const markPending = useCallback((value: boolean): void => {
    pendingRef.current = value;
    setPending(value);
  }, []);

  const startServer = useCallback(async (): Promise<void> => {
    const permit = (permitRef.current += 1);
    markPending(true);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // תשובה שהגיעה אחרי שהמשתמש כבר ביטל, או אחרי שהשדה ירד מהמסך,
      // אינה שלנו — ואין לה למי לדווח
      if (permitRef.current !== permit || disposedRef.current) return;
      markPending(false);
      busyRef.current = false;
      setError("אין גישה למיקרופון — אשרו הרשאה בדפדפן או הקלידו");
      return;
    }
    if (permitRef.current !== permit || disposedRef.current) {
      // בוטל בזמן ההמתנה, או שהרכיב ירד — הזרם שהגיע באיחור נסגר
      // ואינו מקליט דבר. שתי הבדיקות יחד ולפני כל עדכון מצב.
      stream.getTracks().forEach((t) => t.stop());
      if (permitRef.current === permit) busyRef.current = false;
      return;
    }
    markPending(false);
    /*
     * בקשת ההרשאה למיקרופון היא `await`, ולכן שתי לחיצות מהירות על
     * „מדויק” הגיעו לכאן שתיהן. עד כה כל אחת בנתה מקליט משלה —
     * ושתיהן דחפו לאותו `chunksRef`. הקובץ שנשלח לתמלול הכיל את
     * אותה שמיעה פעמיים, ולכן הטקסט חזר כפול, וההקלטה הראשונה
     * נשארה פתוחה עם המיקרופון דלוק. השנייה מוותרת.
     */
    if (recorderRef.current !== null) {
      stream.getTracks().forEach((t) => t.stop());
      busyRef.current = false;
      return;
    }
    /**
     * שחרור מלא כשהמקליט אינו עולה.
     *
     * `new MediaRecorder(...)` ו-`start()` יכולים לזרוק — פורמט
     * שהמכשיר מכריז עליו ואינו תומך בו בפועל הוא המקרה השכיח. אז
     * `onstop` לעולם אינו נורה, ולכן המנעול שמונע שני מקליטים
     * במקביל נשאר נעול על סבב שמעולם לא התחיל: המסך נראה רגוע,
     * המיקרופון פתוח, וכל ניסיון „מדויק” נוסף נדחה בשקט
     * (ביקורת Codex).
     */
    function abandon(): void {
      busyRef.current = false;
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      stream.getTracks().forEach((t) => t.stop());
      setRecording(null);
      setTranscribing(false);
      setError("ההקלטה לא נפתחה בדפדפן הזה — נסו „מהיר” או הקלידו");
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const format = preferredAudioFormat();
    let recorder: MediaRecorder;
    try {
      recorder =
        format === undefined
          ? new MediaRecorder(stream)
          : new MediaRecorder(stream, { mimeType: format.mimeType });
    } catch {
      abandon();
      return;
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      // משחרר את המנעול שמונע שני מקליטים במקביל — בלי זה ההקלטה
      // הבאה באותו שדה הייתה נדחית לנצח
      if (recorderRef.current === recorder) recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      /*
       * הסוג נלקח מהמקליט עצמו ולא ממה שביקשנו: דפדפן רשאי להתעלם
       * מהבקשה ולהקליט במה שיש לו, ואז שוב היינו מתייגים שקר.
       * `chunk.type` הוא הגיבוי לדפדפן שאינו מכריז `mimeType`.
       */
      const actual = recorder.mimeType || chunksRef.current[0]?.type || "";
      const blob = new Blob(chunksRef.current, ...(actual ? [{ type: actual }] : []));
      void transcribe(blob, extensionForAudioType(actual || blob.type));
    };
    recorderRef.current = recorder;
    try {
      recorder.start();
    } catch {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      abandon();
      return;
    }
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
  }, [markPending]);

  async function transcribe(blob: Blob, extension: string): Promise<void> {
    // ההקלטה כבר סימנה `transcribing`; הקלטה ריקה חייבת לכבות אותו
    // בעצמה, אחרת הסבב נשאר "פעיל" לנצח והכפתורים אינם חוזרים
    if (blob.size === 0 || disposedRef.current) {
      busyRef.current = false;
      setTranscribing(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    // שרת שהפסיק לענות באמצע אינו רשאי להשאיר את הסבב פתוח לנצח
    const timeout = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);
    try {
      const form = new FormData();
      /*
       * שם הקובץ אינו קישוט: שירות התמלול פותח את הקובץ הזמני לפי
       * הסיומת שמגיעה כאן (`infra/stt/server.py`).
       */
      form.append("file", blob, `recording.${extension}`);
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
      clearTimeout(timeout);
      // הסבב נגמר רק כשהטקסט חזר — עד אז „מדויק” עדיין באוויר
      busyRef.current = false;
      if (!disposedRef.current) setTranscribing(false);
    }
  }

  const start = useCallback(
    (mode: DictationMode): void => {
      /*
       * סבב שכבר רץ אינו נפתח שוב.
       *
       * הכפתורים אמנם מוחלפים ב„עצור” בזמן הקלטה, אבל בין הלחיצה
       * לבין הרינדור יש חלון — ולחיצה כפולה מהירה, שכיחה במסך מגע,
       * נכנסה בו. במצב המדויק זה שלח לתמלול קובץ שמכיל את אותה
       * שמיעה פעמיים; במצב המהיר זה השאיר שני מנועים מקליטים.
       */
      if (busyRef.current || recording !== null || transcribing) return;
      busyRef.current = true;
      setError(null);
      if (mode === "browser") startBrowser();
      else void startServer();
    },
    [recording, transcribing, startBrowser, startServer],
  );

  const stop = useCallback((): void => {
    /*
     * ביטול בזמן ההמתנה להרשאה. אי אפשר לבטל `getUserMedia` עצמו,
     * ולכן במקום זה מקדמים את מזהה הבקשה: הזרם שיגיע באיחור יזוהה
     * כלא-שלנו וייסגר מיד.
     */
    if (pendingRef.current) {
      permitRef.current += 1;
      markPending(false);
      busyRef.current = false;
      return;
    }
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
       * רשת ביטחון למנוע שאינו יורה `onend` — אחרת הכפתורים נשארים
       * על „מקליט” לנצח ואי אפשר להכתיב שוב.
       *
       * ## שתי טעויות שהיו בגרסה הראשונה של השעון הזה (ביקורת Codex)
       *
       * **הוא סיים את הסבב בלי לנתק את המנוע.** איפוס ה-ref אינו
       * מבטל את הזיהוי ואינו מסיר את המאזינים, ולכן תוצאה סופית
       * שהגיעה אחרי שהשעון פעל נחתה על סבב שכבר „נגמר” — בדיוק
       * הכפילות שה-PR הזה מתקן. לכן השעון **מנתק** קודם: בלי
       * מאזינים אין תוצאה מאוחרת, והסיום בטוח.
       *
       * **הוא היה קצר מדי.** מנוע שנשען על רשת יכול לסגור משפט
       * לאחר יותר משנייה וחצי, וניתוק בזמן כזה היה בולע את המשפט
       * האחרון בשקט. עשר שניות הן הרבה מעבר לכל סגירה סבירה, ועדיין
       * גבול ברור למנוע תקוע. איבוד טקסט גרוע מכפתור שנתקע.
       */
      const token = browserTokenRef.current;
      if (endGuardRef.current !== null) clearTimeout(endGuardRef.current);
      endGuardRef.current = setTimeout(() => {
        endGuardRef.current = null;
        /*
         * השעון שייך לסבב מסוים. אם בינתיים נפתח סבב חדש — משתמש
         * שלחץ „מהיר” שוב — הוא אינו רשאי לנתק את המנוע שרץ עכשיו.
         * בלי הבדיקה הזו השעון היה הורג הקלטה פעילה עשר שניות
         * אחרי שקודמתה נעצרה.
         */
        if (!sessionsRef.current.end(token)) return;
        retireBrowser();
        busyRef.current = false;
        setRecording(null);
      }, 10_000);
      return;
    }
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    setRecording(null);
  }, [retireBrowser, markPending]);

  const clearError = useCallback((): void => setError(null), []);

  return {
    browserReady,
    serverReady,
    recording,
    transcribing,
    pending,
    error,
    start,
    stop,
    clearError,
  };
}
