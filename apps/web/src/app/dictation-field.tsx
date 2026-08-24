"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { appendDictated } from "@metavchim/shared";
import { useDictation, type DictationMode } from "@/lib/dictation";
import { IconStop } from "./icons";

/**
 * שדה טקסט שאפשר להכתיב אליו במקום להקליד — input או textarea.
 *
 * מתחת לשדה יושבת שורת פקדים עם שני כפתורים, כי שני המצבים זמינים
 * תמיד (ראו lib/dictation.ts): "מהיר" מציג טקסט תוך כדי הדיבור,
 * "מדויק" שולח לתמלול בשרת ומחזיר עברית טובה יותר בסוף.
 *
 * אין העדפה שמורה ואין מצב "מודגש": שני הכפתורים שווים, והבחירה
 * נעשית בכל פעם מחדש לפי מה שמכתיבים. מתווך שמכתיב כתובת רוצה
 * דיוק, ומי שמסכם שיחה רוצה מהירות — אותו אדם, אותו יום.
 */

interface CommonProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** תיאור קצר מתחת לתווית — למשל מה כדאי להכתיב. */
  hint?: string;
  placeholder?: string;
  required?: boolean;
  name?: string;
  dir?: "rtl" | "ltr";
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal";
  className?: string;
}

function MicIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <line x1="12" y1="17.5" x2="12" y2="21" />
    </svg>
  );
}

/**
 * הפקדים בלבד — לשימוש בשדות קיימים שכבר בנויים בטופס משלהם.
 * `onAppend` מקבל את הטקסט המלא שזוהה מאז תחילת ההקלטה.
 */
export function DictationControls({
  onAppend,
  onIdle,
  onBusyChange,
  disabled,
}: {
  onAppend: (text: string) => void;
  /** נקרא כשסבב ההקלטה הסתיים — הזדמנות לאפס את טקסט הבסיס. */
  onIdle?: () => void;
  /** מקליט או מתמלל כרגע — המיקרופון הגלובלי לא מתקפל באמצע סבב. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { browserReady, serverReady, recording, transcribing, pending, error, start, stop } =
    useDictation((text) => onAppend(text));

  /*
   * סוף סבב = לא מקליט ולא מתמלל. בלי האיפוס הזה הקלטה שנייה באותו
   * שדה הייתה נכתבת על הראשונה במקום להתווסף אחריה, כי טקסט הבסיס
   * נשאר מה שהיה לפני ההקלטה הראשונה.
   */
  const idleRef = useRef(onIdle);
  idleRef.current = onIdle;
  const busyRef = useRef(onBusyChange);
  busyRef.current = onBusyChange;
  const busy = recording !== null || transcribing || pending;
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (wasBusyRef.current && !busy) idleRef.current?.();
    wasBusyRef.current = busy;
    busyRef.current?.(busy);
  }, [busy]);

  if (!browserReady && !serverReady) return null;

  function begin(next: DictationMode): void {
    start(next);
  }

  return (
    <div className="mv-dictate">
      {recording !== null ? (
        <>
          <button type="button" className="mv-dictate-stop" onClick={stop}>
            <IconStop s={13} /> עצור
          </button>
          <span className="mv-dictate-live" aria-live="polite">
            <span className="mv-dictate-dot" aria-hidden="true" />
            {recording === "browser" ? "מקליט — הטקסט מופיע תוך כדי" : "מקליט — התמלול בסוף"}
          </span>
        </>
      ) : transcribing ? (
        <span className="mv-dictate-live" aria-live="polite">מתמלל בשרת…</span>
      ) : pending ? (
        /*
          חלונית ההרשאה של הדפדפן אינה חייבת להיענות, ו-`getUserMedia`
          יכול להישאר תלוי לנצח. בלי השורה הזו הכפתורים נראו זמינים
          וכל לחיצה נדחתה בשקט על ידי מנעול נסתר (ביקורת Codex).
        */
        <>
          <button type="button" className="mv-dictate-stop" onClick={stop}>
            ביטול
          </button>
          <span className="mv-dictate-live" aria-live="polite">
            ממתין לאישור המיקרופון בדפדפן…
          </span>
        </>
      ) : (
        <>
          {browserReady ? (
            <button
              type="button"
              className="mv-dictate-btn"
              disabled={disabled}
              onClick={() => begin("browser")}
              title="זיהוי בדפדפן — הטקסט מופיע תוך כדי הדיבור"
            >
              <MicIcon /> מהיר
            </button>
          ) : null}
          {serverReady ? (
            <button
              type="button"
              className="mv-dictate-btn"
              disabled={disabled}
              onClick={() => begin("server")}
              title="תמלול בשרת של המערכת — מדויק יותר בעברית, מגיע בסוף ההקלטה"
            >
              <MicIcon /> מדויק
            </button>
          ) : null}
        </>
      )}
      {error ? (
        <span role="alert" className="mv-dictate-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** ניהול טקסט הבסיס: ההכתבה מוסיפה למה שכבר כתוב, ולא דורסת אותו. */
function useAppender(value: string, onChange: (v: string) => void) {
  const baseRef = useRef<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const append = (text: string): void => {
    // תחילת סבב — שומרים את מה שהיה בשדה. עדכונים הבאים (טקסט זמני
    // שמתעדכן תוך כדי דיבור) מחליפים רק את החלק שהוכתב, ולכן הם
    // מתווספים לאותו בסיס ולא מצטברים כפול.
    baseRef.current ??= valueRef.current;
    onChange(appendDictated(baseRef.current, text));
  };
  const reset = (): void => {
    baseRef.current = null;
  };
  return { append, reset };
}

export function DictationInput({
  value,
  onChange,
  label,
  hint,
  placeholder,
  required,
  name,
  dir,
  inputMode,
  className,
}: CommonProps) {
  const id = useId();
  const { append, reset } = useAppender(value, onChange);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {hint ? (
        <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        dir={dir}
        inputMode={inputMode}
        className="mv-field"
      />
      <DictationControls onAppend={append} onIdle={reset} />
    </div>
  );
}

export function DictationTextarea({
  value,
  onChange,
  label,
  hint,
  placeholder,
  required,
  name,
  rows = 4,
  className,
}: CommonProps & { rows?: number }) {
  const id = useId();
  const { append, reset } = useAppender(value, onChange);
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      {hint ? (
        <p className="m-0 mb-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        rows={rows}
        className="mv-field"
      />
      <DictationControls onAppend={append} onIdle={reset} />
    </div>
  );
}

/** עטיפה לשדה מבוקר שהאפליקציה מרנדרת בעצמה. */
export function WithDictation({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const { append, reset } = useAppender(value, onChange);
  return (
    <>
      {children}
      <DictationControls onAppend={append} onIdle={reset} />
    </>
  );
}

/**
 * הכתבה לשדה **לא מבוקר** לפי ה-id שלו — רוב הטפסים במערכת בנויים כך
 * (defaultValue + FormData), ומעבר לניהול state רק בשביל מיקרופון היה
 * שכתוב מיותר של טפסים שעובדים.
 *
 * הטקסט נכתב ישירות ל-value ומופץ אירוע input, כדי שגם ולידציה של
 * הדפדפן וגם מאזינים אחרים יראו את השינוי.
 */
export function DictateFor({ targetId }: { targetId: string }) {
  const baseRef = useRef<string | null>(null);

  function append(text: string): void {
    const el = document.getElementById(targetId) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (!el) return;
    baseRef.current ??= el.value;
    el.value = appendDictated(baseRef.current, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return <DictationControls onAppend={append} onIdle={() => (baseRef.current = null)} />;
}
