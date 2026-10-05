"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";

/**
 * "אל תציג יותר" לפאנלי עזרה — נשמר **למשתמש** ולא לדפדפן.
 *
 * שאלת המשתמש "למה לא למשתמש?" היא הצדק: סגירה ב-localStorage חיה
 * במכשיר אחד, ומי שסגר את הדוגמאות במחשב במשרד היה פוגש אותן שוב
 * בטלפון. ההעדפה יושבת ב-preferences של המשתמש — אותו מנגנון שכבר
 * מסנכרן את התאמות הנגישות בין מכשירים.
 *
 * שתי רמות סגירה:
 * - close — סגירה לביקור הנוכחי בלבד (state), הפאנל יחזור בכניסה
 *   הבאה. למי שרוצה רגע של מסך נקי בלי להתחייב.
 * - never — נכתב לשרת ולא חוזר בשום מכשיר.
 *
 * ‎`hidden`‎ מתחיל true ונפתח רק אחרי שהתשובה מהשרת הגיעה — ההפך היה
 * מהבהב את הפאנל למי שכבר ביקש לא לראות אותו.
 */

interface ProfilePrefs {
  preferences?: { dismissedPanels?: string[] } & Record<string, unknown>;
}

/**
 * ‎**כמה מפתחות, בקשה אחת.**
 *
 * ‏סליידר ההכרזות בדשבורד שואל „לא להציג יותר” על כל שקופית
 * ‏בנפרד. קריאה ל-`useUserDismissed` לכל אחת הייתה שולחת שלוש
 * ‏בקשות `‎/auth/profile` זהות בכל טעינת דשבורד — ובנוסף הייתה
 * ‏מפרה את כללי ה-hooks ברגע שמספר השקופיות משתנה לפי המשרד.
 *
 * ‏לכן קריאה אחת שמחזירה את **הקבוצה**, והבודק הוא פונקציה רגילה.
 *
 * ‎`ready` הוא ההבדל בין „לא הוסתר” לבין „עוד לא יודעים”: הצגה
 * ‏לפני התשובה הייתה מהבהבת הכרזה למי שכבר ביקש לא לראות אותה.
 */
export function useUserDismissedSet(): {
  ready: boolean;
  has: (key: string) => boolean;
  never: (key: string) => void;
} {
  const [keys, setKeys] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<ProfilePrefs>("/auth/profile")
      .then((res) => {
        if (!alive) return;
        const dismissed = res.preferences?.dismissedPanels;
        setKeys(new Set(Array.isArray(dismissed) ? dismissed : []));
      })
      // רשת נפלה — מציגים; הכרזה מיותרת עדיפה על הכרזה שנעלמה לתמיד
      .catch(() => alive && setKeys(new Set()));
    return () => {
      alive = false;
    };
  }, []);

  const has = useCallback((key: string) => keys?.has(key) === true, [keys]);

  const never = useCallback((key: string) => {
    setKeys((prev) => new Set([...(prev ?? []), key]));
    /*
     * נכשל? ההכרזה חוזרת — הסתרה שלא נשמרה שמוצגת כהצלחה הייתה
     * מפתיעה את המשתמש בכניסה הבאה. אותו כלל כמו במפתח היחיד.
     */
    void apiPost("/auth/profile/dismissed-panels", { key }).catch(() =>
      setKeys((prev) => {
        if (prev === null) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
    );
  }, []);

  return { ready: keys !== null, has, never };
}

/**
 * ‎**מפתח יחיד — אותו מנגנון בדיוק, עם `close` לביקור.**
 *
 * ‏היה כאן עותק שני של אותה שליפה ואותה כתיבה, וזו בדיוק הכפילות
 * ‏שנשכחת בצד אחד: תיקון ב„נכשל? הפאנל חוזר” היה צריך להיכתב
 * ‏פעמיים. עכשיו זו עטיפה דקה, וההתנהגות זהה — כולל `hidden`
 * ‏שמתחיל אמת ונפתח רק אחרי שהתשובה הגיעה.
 */
export function useUserDismissed(key: string): {
  hidden: boolean;
  close: () => void;
  never: () => void;
} {
  const { ready, has, never: neverKey } = useUserDismissedSet();
  /** סגירה לביקור הנוכחי בלבד — לא נכתבת לשרת. */
  const [closed, setClosed] = useState(false);

  const close = useCallback(() => setClosed(true), []);
  const never = useCallback(() => neverKey(key), [neverKey, key]);

  return { hidden: !ready || closed || has(key), close, never };
}
