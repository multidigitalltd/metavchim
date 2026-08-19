"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * הלוגו של המשרד בסרגל הצד.
 *
 * **נעלם בשקט** למשרד שלא העלה לוגו: `onError` מסתיר את האלמנט
 * במקום להשאיר סמל תמונה שבורה. אין כאן קריאת API מקדימה שתשאל אם
 * יש לוגו — היא הייתה בקשה נוספת בכל טעינת מסך כדי לחסוך בקשה אחת
 * שממילא נכשלת בזול.
 */
export function OfficeLogoMark(): React.JSX.Element | null {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <img
      src={`${API_BASE}/settings/tenant/logo/raw`}
      alt=""
      className="mv-sidebar-logo"
      onError={() => setBroken(true)}
    />
  );
}
