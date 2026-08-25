"use client";

import { useEffect } from "react";
import { IconCheck, IconWarning, IconX } from "./icons";

/**
 * אישור פעולה — חלונית שצפה מעל המסך.
 *
 * ## למה זה החליף הודעה בשורה
 *
 * ההודעות ישבו עד כה כפסקה בראש המסך. אחרי שליחת הצעה הרשימה נטענת
 * מחדש, המסך זז, והמשתמש ממשיך לגלול — כלומר ההודעה שאומרת "נשלח"
 * מופיעה במקום שכבר אינו בשדה הראייה. התוצאה היא מתווך שאינו יודע
 * אם ההצעה יצאה, ולוחץ שוב.
 *
 * החלונית מופיעה במרכז העליון של המסך, מעל התוכן, ונעלמת מעצמה.
 * היא אינה חוסמת: פעולה שהצליחה אינה צריכה אישור נוסף מהמשתמש, וכל
 * לחיצה מיותרת אחרי פעולה מוצלחת היא מס.
 *
 * ## נגישות
 *
 * `role="status"` ולא `alert` להצלחה: קורא מסך מכריז עליה בלי לקטוע
 * את מה שהמשתמש עושה. לשגיאה כן `alert`, כי היא כן דורשת תשומת לב
 * מיידית. הכפתור לסגירה קיים למי שלא רוצה לחכות.
 */

export type ToastTone = "success" | "error";

export interface ToastState {
  text: string;
  tone: ToastTone;
  /** תוכן נוסף — למשל קישור לכרטיס שנוצר. */
  extra?: React.ReactNode;
}

/** כמה זמן החלונית נשארת. ארוך מספיק לקרוא משפט, קצר מכדי להפריע. */
const VISIBLE_MS = 4500;

export function ActionToast({
  state,
  onClose,
}: {
  state: ToastState | null;
  onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (state === null) return;
    const timer = setTimeout(onClose, VISIBLE_MS);
    return () => clearTimeout(timer);
    /*
     * `state` ולא רק קיומו: הודעה שנייה שמגיעה לפני שהראשונה נעלמה
     * מאפסת את הטיימר, ולא יורשת שנייה אחת ממנה.
     */
  }, [state, onClose]);

  if (state === null) return null;
  const success = state.tone === "success";

  return (
    <div
      role={success ? "status" : "alert"}
      aria-live={success ? "polite" : "assertive"}
      className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="flex max-w-[520px] items-start gap-2 rounded-xl border px-4 py-3 shadow-lg"
        style={{
          pointerEvents: "auto",
          background: "var(--color-surface)",
          borderColor: success ? "var(--color-primary)" : "var(--color-danger)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: success ? "var(--color-primary)" : "var(--color-danger)",
          }}
        >
          {success ? <IconCheck s={18} /> : <IconWarning s={18} />}
        </span>
        <div className="text-[length:var(--type-body-sm)]">
          {state.text}
          {state.extra ? <div className="mt-1">{state.extra}</div> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className="ms-1"
          style={{ color: "var(--color-text-muted)" }}
        >
          <IconX s={15} />
        </button>
      </div>
    </div>
  );
}
