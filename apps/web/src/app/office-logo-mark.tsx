"use client";

import { useState } from "react";
import { API_BASE } from "@/lib/api";

/**
 * הלוגו של המשרד בסרגל הצד.
 *
 * **נעלם בשקט** למשרד שלא העלה לוגו. אין כאן קריאת API מקדימה
 * שתשאל אם יש לוגו — התשובה כבר נמצאת ב-`/auth/me` (`tenantHasLogo`),
 * שנטען ממילא עם המסך. בלי הדגל כל מסך ביקש את הקובץ וקיבל 404
 * בקונסול למשרד שלא העלה. `onError` נשאר כרשת ביטחון לקובץ שנמחק
 * מהאחסון בלי שהדגל התעדכן.
 */
export function OfficeLogoMark({ present }: { present: boolean }): React.JSX.Element | null {
  const [broken, setBroken] = useState(false);
  if (!present || broken) return null;
  return (
    <img
      src={`${API_BASE}/settings/tenant/logo/raw`}
      alt=""
      className="mv-sidebar-logo"
      onError={() => setBroken(true)}
    />
  );
}
