"use client";

import { apiGet } from "@/lib/api";
import {
  A11Y_DEFAULTS,
  applyA11y,
  clearA11y,
  saveA11y,
  type A11yPrefs,
} from "@/lib/a11y-prefs";

/**
 * סנכרון העדפות הנגישות מהשרת — נקודה אחת, לכל מסך.
 *
 * הסנכרון יושב כאן ולא בעמוד הפרופיל, כי המשתמש כמעט אף פעם לא
 * מתחיל שם: הוא מתחבר ונוחת בדשבורד. כשהטעינה ישבה בפרופיל בלבד,
 * מכשיר חדש המשיך לעבוד בברירות מחדל עד שבמקרה נכנסו להגדרות —
 * כלומר ההעדפה "האישית" לא הייתה אישית בפועל.
 */

/** נשלח פעם אחת לכל טעינת עמוד, ולא בכל מעבר מסך. */
let synced = false;

export interface ProfilePrefsResponse {
  preferences?: { a11y?: Partial<A11yPrefs> };
}

/**
 * מושך את ההעדפות של המשתמש המחובר ומחיל אותן.
 *
 * מחזיר את ההעדפות שהוחלו, או null כשאין משתמש מחובר (הקריאה
 * נכשלת בשקט — מסכים ציבוריים לא אמורים לדווח על שגיאה).
 */
export async function syncA11yFromServer(): Promise<A11yPrefs | null> {
  if (synced) return null;
  synced = true;
  try {
    const res = await apiGet<ProfilePrefsResponse>("/auth/profile");
    const fromServer = res.preferences?.a11y;
    /*
     * שרת בלי העדפות = איפוס, לא "השאר מה שיש".
     *
     * מפתח המטמון גלובלי לדפדפן ולא למשתמש, ולכן משתמש שני שנכנס
     * באותו דפדפן היה יורש את הפונט, הניגודיות וקו הקריאה של הראשון
     * — ללא הגבלת זמן (ביקורת Codex). החזרה המפורשת לברירות המחדל
     * מנקה גם את המטמון.
     */
    const next = fromServer ? { ...A11Y_DEFAULTS, ...fromServer } : A11Y_DEFAULTS;
    applyA11y(next);
    if (fromServer) saveA11y(next);
    else clearA11y();
    window.dispatchEvent(new CustomEvent("mv-a11y-change", { detail: next }));
    return next;
  } catch {
    return null; // לא מחובר, או רשת — המטמון המקומי נשאר בתוקף
  }
}

/** איפוס הדגל — נדרש אחרי החלפת משתמש באותה טעינת עמוד. */
export function resetA11ySync(): void {
  synced = false;
}
