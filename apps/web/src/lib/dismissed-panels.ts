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

export function useUserDismissed(key: string): {
  hidden: boolean;
  close: () => void;
  never: () => void;
} {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let alive = true;
    apiGet<ProfilePrefs>("/auth/profile")
      .then((res) => {
        if (!alive) return;
        const dismissed = res.preferences?.dismissedPanels;
        setHidden(Array.isArray(dismissed) && dismissed.includes(key));
      })
      // רשת נפלה — מציגים; פאנל עזרה מיותר עדיף על פאנל שנעלם לתמיד
      .catch(() => alive && setHidden(false));
    return () => {
      alive = false;
    };
  }, [key]);

  const close = useCallback(() => setHidden(true), []);

  const never = useCallback(() => {
    setHidden(true);
    /*
     * נתיב ייעודי שממזג אטומית בשרת — לא קריאה-ואז-PATCH של כל
     * ה-preferences, שבמקביל לשמירת נגישות או לסגירה ממכשיר שני
     * הייתה דורסת את הכתיבה השנייה (ביקורת Codex).
     *
     * נכשל? הפאנל חוזר — הסתרה שלא נשמרה שמוצגת כהצלחה הייתה
     * מפתיעה את המשתמש בכניסה הבאה (ביקורת Codex). הכפתור נשאר
     * זמין לניסיון נוסף.
     */
    void apiPost("/auth/profile/dismissed-panels", { key }).catch(() =>
      setHidden(false),
    );
  }, [key]);

  return { hidden, close, never };
}
