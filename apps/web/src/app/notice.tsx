"use client";

import { useEffect, useRef, useState } from "react";

/**
 * הודעה במערכת — **תמיד אפשר לסגור אותה.**
 *
 * ## למה זה רכיב ולא כלל
 *
 * ההודעות במערכת נכתבו כל אחת בנפרד: `<p role="alert">` כאן,
 * `<div className="…">` שם. אין להן מכנה משותף, ולכן „כל הודעה
 * תהיה ניתנת לסגירה” היה כלל שדורש 175 תיקונים ידניים ואז נשבר
 * בהודעה ה-176. רכיב אחד הופך את זה למשהו שקורה מעצמו.
 *
 * ## למה הסגירה מנוהלת כאן
 *
 * הרכיב סוגר את עצמו גם בלי ‎`onClose`‎. זה מכוון: רוב ההודעות
 * במערכת יושבות ב-state של המסך שהציג אותן, ואילו הסגירה הייתה
 * דורשת מכל קורא לנהל דגל נוסף — הרטרופיט לא היה קורה. מי שכן צריך
 * לדעת שנסגרה (למשל כדי לאפס שדה) מקבל ‎`onClose`‎.
 *
 * ## למה ההודעה נפתחת מחדש כשהטקסט משתנה
 *
 * משתמש שסגר „השמירה נכשלה” ולחץ שוב חייב לראות את התוצאה החדשה.
 * בלי האיפוס הזה כישלון שני היה שקט לגמרי — כלומר גרוע יותר
 * מהודעה שאי אפשר לסגור.
 *
 * ## נגישות
 *
 * ‎`role`‎ נגזר מהחומרה: שגיאה מפריעה לקורא מסך מיד (‎alert‎), והצלחה
 * ממתינה לתורה (‎status‎). לכפתור יש שם נגיש, כי „×” לבדו נקרא
 * „כפל”.
 */

export type NoticeTone = "success" | "danger" | "warning" | "info";

/**
 * „סגרתי את זה” — ונשאר סגור.
 *
 * לפאנלים שחוזרים בכל טעינת מסך (סיורים שטרם תועדו, משימות באיחור)
 * סגירה שחיה ב-state בלבד היא לא סגירה: היא נפתחת שוב ברגע שעוברים
 * מסך וחוזרים, וזה בדיוק מה שהופך תזכורת למטרד.
 *
 * המפתח כולל את **התאריך** במכוון. הסגירה שווה ליום אחד: מי שסגר
 * את „סיורים שטרם תועדו” היום אמר „לא עכשיו”, לא „לעולם לא”. סגירה
 * לצמיתות הייתה מסתירה עבודה אמיתית עד שמישהו ימחק localStorage.
 */
export function useDismissedToday(key: string): [boolean, () => void] {
  const storageKey = `mv-dismiss:${key}:${new Date().toISOString().slice(0, 10)}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      /* localStorage חסום — הפאנל פשוט מוצג */
    }
  }, [storageKey]);

  return [
    dismissed,
    () => {
      setDismissed(true);
      try {
        window.localStorage.setItem(storageKey, "1");
      } catch {
        /* נסגר לפחות עד לרענון */
      }
    },
  ];
}

export function Notice({
  tone = "info",
  onClose,
  children,
  className,
  id,
}: {
  tone?: NoticeTone;
  /** נקרא **אחרי** הסגירה. אופציונלי — הרכיב סוגר את עצמו בכל מקרה. */
  onClose?: () => void;
  children: React.ReactNode;
  className?: string;
  /**
   * מזהה, כשטופס מפנה להודעה ב-‎`aria-describedby`‎.
   *
   * אינו קישוט: בלעדיו ההפניה מצביעה על אלמנט שאינו קיים, וקורא מסך
   * פשוט לא מקריא את השגיאה — כלומר מי שהכי זקוק לה לא מקבל אותה.
   */
  id?: string;
}): React.JSX.Element | null {
  const [closed, setClosed] = useState(false);
  /*
   * מפתח התוכן ולא ה-children עצמם: אלמנטים של React הם אובייקטים
   * חדשים בכל רינדור, והשוואה שלהם הייתה מאפסת את הסגירה מיד.
   */
  const signature = typeof children === "string" ? children : String(children);
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      setClosed(false);
    }
  }, [signature]);

  if (closed) return null;

  return (
    <div
      id={id}
      className={`mv-notice${className === undefined ? "" : ` ${className}`}`}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="mv-notice-text">{children}</span>
      <button
        type="button"
        className="mv-notice-close"
        aria-label="סגירת ההודעה"
        onClick={() => {
          setClosed(true);
          onClose?.();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
