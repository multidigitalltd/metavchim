"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

/**
 * ‎**„יש מה לבדוק” — ורק כשיש.**
 *
 * ‏המעבר על רישום משותף הוא עבודה חד-פעמית: הרשימה מתקצרת בכל
 * ‏תשובה ובסוף היא ריקה. שורה קבועה במסך הנכסים הייתה נשארת שם
 * ‏לנצח, ולכן היא מותנית במונה — ונעלמת בעצמה כשהמעבר נגמר.
 *
 * ‏כישלון הטעינה שקט: זו הודעה על עבודה שאפשר לעשות, ולא נתון
 * ‏שהמסך מבטיח. שגיאה אדומה מעל רשימת הנכסים על משהו שולי היא
 * ‏רעש שמלמד להתעלם מהודעות.
 */
export function SharedTabuPending(): React.JSX.Element | null {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    let live = true;
    apiGet<{ remaining: number }>("/properties/shared-tabu-review?limit=1")
      .then((res) => {
        if (live) setRemaining(res.remaining);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (remaining === 0) return null;

  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <p className="m-0 text-sm">
        <b>{remaining} נכסים</b> מעולם לא נשאלו אם הם רשומים בטאבו משותף. נכס כזה מוצע גם
        לקונים שסימנו שאינם מוכנים לרישום משותף.
      </p>
      <Link href="/properties/shared-tabu" className="mv-btn-plain">
        מעבר על הרשימה
      </Link>
    </div>
  );
}
