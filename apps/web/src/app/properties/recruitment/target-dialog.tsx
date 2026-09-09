"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { recruitmentCompleteness } from "@metavchim/shared";
import { TargetDetails, TargetStatusChip } from "./target-details";
import { TargetForm } from "./target-form";
import { targetAddress, type TargetValues } from "./target-values";

/**
 * ‎**חלונית הנכס לגיוס — מה שידוע, ומתחתיו מה שחסר.**
 *
 * ## ‏למה חלונית ולא ניווט
 *
 * ‏העבודה ברשימת הגיוס היא סבב: מתקשרים, שומעים עוד פרט, רושמים,
 * ‏עוברים לשורה הבאה. ניווט לעמוד וחזרה ברינדור מלא בכל שורה הפך
 * ‏את הסבב הזה לאיטי, ואיבד את הסינון והגלילה שהמתווך הגיע איתם.
 * ‏החלונית פותחת את אותם רכיבים בדיוק מעל הרשימה, וסוגרת לאותו
 * ‏מקום.
 *
 * ‎**העמוד המלא נשאר** — הוא נושא את מקטע הפולואפ ואת הקישור
 * ‏העמוק, והקישור אליו יושב בכותרת החלונית. מי שהגיע דרך קישור
 * ‏שנשלח לו במייל צריך למצוא שם עמוד, לא רשימה.
 *
 * ## ‏למה `dialog` נייטיב
 *
 * ‏מלכודת פוקוס, Escape, שכבה מעל הכול ו-`inert` לשאר העמוד —
 * ‏בחינם מהדפדפן. אותה הכרעה בדיוק של `ConfirmDialog`, ואותה שפה
 * ‏עיצובית (`mv-dialog`).
 */
export function TargetDialog({
  target,
  mayEdit,
  onClose,
  onSaved,
}: {
  target: TargetValues;
  mayEdit: boolean;
  onClose: () => void;
  /** ‏נשמר — הרשימה מתרעננת, והחלונית נסגרת. */
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  /*
   * ‏החלונית נטענת רק כשיש שורה, ולכן `showModal` בעלייה. המפתח
   * ‏אצל הקורא הוא מזהה השורה, כך שמעבר לשורה אחרת מרכיב טופס
   * ‏חדש — `defaultValue` נקרא פעם אחת בלבד, וטופס ממוחזר היה
   * ‏מציג את הנכס הקודם.
   */
  useEffect(() => {
    const el = ref.current;
    if (el !== null && !el.open) el.showModal();
  }, []);

  const { filled, total } = recruitmentCompleteness(target);

  return (
    <dialog
      ref={ref}
      className="mv-dialog mv-dialog--wide"
      aria-label={`נכס לגיוס — ${targetAddress(target)}`}
      /*
       * `cancel` הוא Escape ולחיצה על הרקע. בלי המאזין הזה הדפדפן
       * סוגר את החלון אבל ה-state של הקורא נשאר "פתוח", והחלון לא
       * ייפתח שוב בלחיצה הבאה.
       */
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        aria-label="סגירה"
        onClick={onClose}
        className="mv-dialog-dismiss"
      >
        <span aria-hidden="true">✕</span>
      </button>

      <header className="mb-4 pl-10">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 text-[length:var(--type-metric)] font-extrabold">
            {targetAddress(target)}
          </h2>
          <TargetStatusChip status={target.status ?? "new"} />
        </div>
        <p className="m-0 mt-1.5 text-sm text-[var(--color-text-muted)]">
          {filled} מתוך {total} פרטים מולאו
          {target.id === undefined ? null : (
            <>
              {" · "}
              <Link
                href={`/properties/recruitment/${target.id}`}
                className="underline underline-offset-2"
              >
                לעמוד המלא
              </Link>
            </>
          )}
        </p>
      </header>

      <div className="mv-dialog-scroll space-y-5">
        <TargetDetails target={target} />

        {mayEdit ? (
          <TargetForm initial={target} onSaved={onSaved} onCancel={onClose} />
        ) : (
          /*
           * ‏מי שרשאי לצפות ולא לערוך קיבל עד עכשיו טופס מלא ופעיל
           * ‏ששמירתו נדחית ב-403 עם „השמירה נכשלה” — מסך שמזמין
           * ‏פעולה אסורה ואז מאשים את המשתמש (ביקורת Codex).
           */
          <p className="mv-card p-4 text-sm text-[var(--color-text-muted)]">
            לצפייה בלבד — אין לכם הרשאת עריכה לנכסים.
          </p>
        )}
      </div>
    </dialog>
  );
}
