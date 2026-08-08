"use client";

/**
 * "לא הצלחנו לטעון" — במקום מסך שנראה ריק.
 *
 * הבעיה שזה פותר: כשטעינה נכשלת ומצב השגיאה נבלע, המסך מרנדר את
 * מצב הריק — "אין ביקושים ברשת", "וואטסאפ אינו מחובר". המתווך מסיק
 * מסקנה עסקית שגויה מתקלת רשת, ובמקרה של מסך ההגדרות הוא עלול
 * להתחיל להגדיר מחדש משהו שכבר מוגדר.
 *
 * הרכיב קטן בכוונה: הוא נועד להיכנס לכל מקום שבו היה `catch(() => [])`,
 * בלי לשכתב את המסך סביבו.
 */
export function LoadError({
  message = "לא הצלחנו לטעון את הנתונים",
  onRetry,
}: {
  message?: string;
  /** כשקיים — מוצג כפתור ניסיון חוזר. שגיאת רשת חולפת נפתרת בלחיצה. */
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border p-5 text-center"
      style={{ borderColor: "var(--color-danger)", background: "var(--color-surface)" }}
    >
      <p className="m-0 mb-1 font-semibold" style={{ color: "var(--color-danger)" }}>
        {message}
      </p>
      <p className="m-0 mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        זו תקלת טעינה — הנתונים עצמם לא נפגעו.
      </p>
      {onRetry ? (
        <button type="button" className="mv-btn-plain" onClick={onRetry}>
          נסה שוב
        </button>
      ) : null}
    </div>
  );
}
