"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * העתקה ללוח שמדווחת את מה שקרה באמת.
 *
 * ## למה זה לא `navigator.clipboard.writeText` ישירות
 *
 * `writeText` נכשל יותר משנדמה: הקשר לא מאובטח (http), דפדפן ישן,
 * מדיניות ארגונית שחוסמת גישה ללוח, או לחיצה שהדפדפן לא ספר כמחוות
 * משתמש. הדפוס שהיה כאן — `.catch(() => undefined)` ואז `setCopied(true)`
 * — הפך כל אחד מהמצבים האלה ל„✓ הועתק” שקרי, והמתווך הדביק כתובת
 * ישנה אצל ספק המרכזייה או שלח ללקוח קישור שאינו הקישור שיצר.
 *
 * כישלון בהעתקה אינו תקלה שצריך להסתיר: הטקסט עצמו מוצג בכל אחד
 * מהמסכים האלה, ולכן ההודעה הנכונה מפנה להעתקה ידנית — שהיא פעולה
 * שהמשתמש יכול לבצע מיד, בניגוד לניחוש למה הדבקה לא עבדה.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    /*
     * `navigator.clipboard` עצמו יכול להיות `undefined` ולא רק
     * להיכשל — בהקשר לא מאובטח הוא פשוט אינו קיים, וקריאה עליו
     * זורקת `TypeError` לפני שיש הבטחה לתפוס.
     */
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CopyState = "idle" | "copied" | "failed";

/**
 * מצב ההעתקה האחרון + מפתח הפריט שהועתק.
 *
 * המפתח קיים כי אותו כפתור חוזר בכל שורה ברשימה: בלעדיו הודעת
 * „הועתק” הייתה מופיעה על כל השורות בבת אחת. במסך עם כפתור יחיד
 * פשוט לא מעבירים מפתח.
 *
 * ההודעה מתאפסת מעצמה, וה-timeout נוקה בפירוק הרכיב — אחרת לחיצה
 * ומעבר מסך מייצרים `setState` על רכיב שכבר אינו קיים.
 *
 * `resetMs = 0` משאיר את ההודעה עד ההעתקה הבאה. זה הנכון כשהיא
 * יושבת בתוך אזור שנשאר על המסך (הבאנר של דף הנחיתה, שורת ההצעה):
 * הודעה שנעלמת מתוך כרטיס שנשאר נראית כאילו משהו התקלקל.
 */
export function useCopy(resetMs = 3000): {
  state: CopyState;
  key: string | null;
  copy: (text: string, key?: string) => Promise<void>;
} {
  const [state, setState] = useState<CopyState>("idle");
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * מונה ניסיונות. שני תפקידים, ושניהם על אותה תקלה: תוצאה של
   * ניסיון אחד שמתוארת כתוצאה של ניסיון אחר.
   *
   * בלעדיו ההעתקה **השנייה** ירשה את „✓ הועתק” של הראשונה לכל אורך
   * ההמתנה — ועם `resetMs = 0` גם אחריה — כלומר בדיוק השקר שההוק
   * הזה נכתב כדי למנוע, רק בפעם השנייה. ובשני ניסיונות חופפים,
   * הישן שמסתיים אחרון היה דורס את החדש (ביקורת Codex).
   */
  const attempt = useRef(0);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string, itemKey?: string): Promise<void> => {
      const mine = ++attempt.current;
      /* חוזרים ל„לא ידוע” לפני ההמתנה, ולא אחריה */
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setState("idle");
      setKey(null);

      const ok = await copyText(text);
      if (mine !== attempt.current) return;

      setState(ok ? "copied" : "failed");
      setKey(itemKey ?? null);
      if (resetMs <= 0) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        setState("idle");
        setKey(null);
      }, resetMs);
    },
    [resetMs],
  );

  return { state, key, copy };
}
