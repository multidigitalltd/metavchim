"use client";

import { jerusalemDayLabel } from "@metavchim/shared";

/**
 * ‎**„הבנתי” על שורה ברשימת „מה חשוב לעשות היום”.**
 *
 * ## מה השורות האלה, ולמה אי אפשר פשוט „לסמן כבוצע”
 *
 * הרשימה אינה רשימת משימות. אין מאחוריה רשומה שאפשר לסגור: כל שורה
 * היא **מסקנה שנגזרת מחדש מהנתונים** בכל טעינה — „ליד ממתין מעל 3
 * שעות”, „551 קונים חמים בלי הצעה”, „נכס בלי תמונות”. אין מה לעדכן
 * בשרת כדי שהשורה תיעלם; היא תיעלם כשהמצב עצמו ישתנה.
 *
 * ‏ולכן הכפתור אינו „בוצע” אלא „הבנתי”, והוא עושה בדיוק מה שהוא
 * אומר: **מסתיר את השורה עד מחר**. מתווך שראה את השורה, החליט שהיא
 * לא לעכשיו, ולא רוצה שהיא תסתיר ממנו את השורה השביעית — זו הבקשה,
 * וזו התשובה עליה. מחר, אם הליד עדיין לא נענה, השורה חוזרת. הסתרה
 * לצמיתות הייתה הופכת את הדשבורד למסך ששוכח בעיות.
 *
 * ## למה בדפדפן ולא בשרת
 *
 * ‏„ראיתי את השורה הזו היום” היא העדפת תצוגה של אדם ליום אחד, ולא
 * נתון של המשרד: אין לה קורא אחר, אין לה ביקורת, ואין מי שיבקש
 * אותה בחזרה. טבלה עם RLS, מחיקה ו-purge לערך שתוקפו פג בחצות היא
 * תשתית שלמה סביב כלום. זו גם המוסכמה הקיימת במסך — `DuplicateContacts`
 * זוכר ב-`localStorage` איזו קבוצת כפילויות המשתמש כבר סגר.
 *
 * ‎**המחיר נאמר במפורש**: מי שסימן „הבנתי” במחשב יראה את השורה שוב
 * בטלפון. זה מקובל לשורה שממילא חוזרת מחר.
 *
 * ## למה היום **הישראלי**
 *
 * „מחר” נקבע לפי לוח השנה של המשרד ולא של המכשיר. מתווך שפותח את
 * המערכת מחו״ל אינו אמור לקבל את השורות בחזרה באמצע יום העבודה
 * שלו, ולא להישאר בלעדיהן בבוקר.
 */

/** מפתח לכל משתמש — מחשב משותף במשרד אינו מחליף העדפות בין סוכנים. */
function storageKey(userId: string): string {
  return `mv.today.dismissed.${userId}`;
}

/** ‎`YYYY-MM-DD` של היום הישראלי — הרזולוציה שהתפוגה נמדדת בה. */
export function todayLabel(now: Date): string {
  return jerusalemDayLabel(now);
}

/**
 * מה שהוסתר **היום**.
 *
 * ‎`day` שאינו היום מוחזר כריק, ולכן התפוגה אינה דורשת ניקוי יזום:
 * הרשומה הישנה פשוט אינה נקראת, והכתיבה הבאה דורסת אותה.
 *
 * ‎`localStorage` זורק בגלישה פרטית ובדפדפן שחוסם אחסון, ובשרת הוא
 * אינו קיים כלל. בכל המקרים האלה התשובה הנכונה היא „כלום לא הוסתר”
 * — מסך שנופל כי לא הצליח לזכור העדפת תצוגה גרוע מכל.
 */
export function readDismissed(userId: string, today: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Set();
    const { day, keys } = parsed as { day?: unknown; keys?: unknown };
    if (day !== today || !Array.isArray(keys)) return new Set();
    return new Set(keys.filter((k): k is string => typeof k === "string"));
  } catch {
    return new Set();
  }
}

/** שמירה — נכשלת בשקט, מאותה סיבה בדיוק שהקריאה נכשלת בשקט. */
export function writeDismissed(
  userId: string,
  today: string,
  keys: ReadonlySet<string>,
): void {
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify({ day: today, keys: [...keys] }),
    );
  } catch {
    /* אחסון חסום — ההסתרה תחזיק לרינדור הזה בלבד, וזה בסדר */
  }
}
