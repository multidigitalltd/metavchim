"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@metavchim/ui";

/**
 * חלון אישור — **העצירה שלפני פעולה שאי אפשר לקחת בחזרה.**
 *
 * שליחת הסכם לחתימה היא הפעולה היחידה במערכת שיוצאת החוצה אל לקוח
 * בשם המשרד. עד כה היא קרתה בלחיצה אחת: הודעת וואטסאפ נפתחה, או
 * אימייל יצא, בלי שהמתווך ראה מה נשלח ובלי שנשאל אם הוא בטוח.
 * לחיצה בטעות על הכפתור הזה שולחת מסמך משפטי לאדם אמיתי.
 *
 * ## למה `dialog` נייטיב
 *
 * הדפדפן נותן בחינם את מה שקשה לכתוב נכון: מלכודת פוקוס, סגירה
 * ב-Escape, ושכבה שמעל כל השאר בלי מלחמות `z-index`. `showModal`
 * גם הופך את שאר העמוד ל-inert, כך שקורא מסך אינו נודד אל תוכן
 * שמוסתר מאחורי החלון.
 */

export type DialogTone = "default" | "danger" | "success";

const TONE_COLOR: Record<DialogTone, string> = {
  default: "var(--color-primary)",
  danger: "var(--color-danger)",
  success: "var(--color-success)",
};

export function ConfirmDialog({
  open,
  title,
  tone = "default",
  confirmLabel = "אישור",
  cancelLabel = "ביטול",
  busy = false,
  busyLabel = "שולח…",
  confirmDisabled = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  tone?: DialogTone;
  confirmLabel?: string;
  /** `null` = אין ביטול — חלון בשורה בלבד ("בוצע"). */
  cancelLabel?: string | null;
  busy?: boolean;
  /**
   * מה כתוב על הכפתור בזמן הפעולה. ברירת המחדל "שולח…" נכונה לחלון
   * שנולד לשליחת הסכם; חלון שמוחק אומר "מוחק…" — כפתור שמדווח על
   * פעולה אחרת ממה שנלחץ הוא בדיוק מה שגורם ללחוץ שוב.
   */
  busyLabel?: string;
  /**
   * אישור חסום — לחלון שעדיין אינו יודע מה הפעולה תגרור. „מחק”
   * שמופעל לפני שהתשובה הגיעה מבצע מחיקה שהמסך עוד לא גילה
   * (ביקורת Codex, P1). הביטול נשאר פעיל תמיד.
   */
  confirmDisabled?: boolean;
  /** `undefined` = אין מה לאשר; הכפתור היחיד סוגר. */
  onConfirm?: (() => void) | undefined;
  onClose: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="mv-dialog"
      /*
       * `cancel` הוא Escape ולחיצה על הרקע. בלי המאזין הזה הדפדפן
       * סוגר את החלון אבל ה-state של הקורא נשאר "פתוח", והחלון לא
       * ייפתח שוב בלחיצה הבאה.
       */
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 className="m-0 mb-2 text-[length:var(--type-metric)] font-extrabold" style={{ color: TONE_COLOR[tone] }}>
        {title}
      </h2>
      <div className="mv-dialog-body">{children}</div>
      <div className="mt-5 flex flex-wrap gap-2.5">
        {onConfirm ? (
          <Button disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        ) : (
          <Button onClick={onClose}>{confirmLabel}</Button>
        )}
        {onConfirm && cancelLabel !== null ? (
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
        ) : null}
      </div>
    </dialog>
  );
}
