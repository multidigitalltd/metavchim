"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";

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
    // קוראים את ההעדפות הטריות ורק אז כותבים — PATCH מחליף את
    // האובייקט כולו, וכתיבה עיוורת הייתה דורסת את הגדרות הנגישות
    void apiGet<ProfilePrefs>("/auth/profile")
      .then((res) => {
        const prefs = res.preferences ?? {};
        const existing = Array.isArray(prefs.dismissedPanels)
          ? (prefs.dismissedPanels as string[])
          : [];
        return apiPatch("/auth/profile", {
          preferences: {
            ...prefs,
            dismissedPanels: [...new Set([...existing, key])],
          },
        });
      })
      .catch(() => {
        /* לא נשמר — הפאנל יחזור בכניסה הבאה, והכפתור עדיין שם */
      });
  }, [key]);

  return { hidden, close, never };
}
