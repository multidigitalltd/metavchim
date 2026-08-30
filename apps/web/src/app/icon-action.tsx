"use client";

import type { ReactNode } from "react";

/**
 * ‎**כפתור אייקון שאומר מה הוא עושה.**
 *
 * ## למה זה קיים
 *
 * שורת הפעולות שבכותרת הנכס מציגה שלוש פעולות כאייקון בלבד — שיתוף
 * לרשת, עריכה ומחיקה. אייקון בלי מילה הוא ניחוש, וכאן הניחוש יקר:
 * אחת מהשלוש הרסנית, ופח האשפה והעיפרון יושבים זה לצד זה.
 *
 * ## מה הקומפוננטה מבטיחה
 *
 * ‎`label` הוא **גם** ההסבר שבבועה וגם `aria-label` של הכפתור — ערך
 * אחד, ולכן אי אפשר שהרואים יקבלו הסבר אחד וקורא המסך אחר. הבועה
 * עצמה `aria-hidden`, אחרת אותו טקסט היה מוקרא פעמיים.
 *
 * ‎`tone="danger"` צובע את האייקון בלבד ואינו הסימן היחיד: ההסבר
 * אומר במילים שהפעולה מוחקת.
 */
export function IconAction({
  label,
  onClick,
  tone,
  disabled,
  children,
}: {
  /** ההסבר — בבועה ובתווית הנגישות כאחד */
  label: string;
  onClick: () => void;
  tone?: "danger";
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="mv-tip">
      <button
        type="button"
        className="mv-btn-plain mv-btn-icon"
        aria-label={label}
        disabled={disabled}
        style={tone === "danger" ? { color: "var(--color-danger)" } : undefined}
        onClick={onClick}
      >
        {children}
      </button>
      <span className="mv-tip__bubble" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
