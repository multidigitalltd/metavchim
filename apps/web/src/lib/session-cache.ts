"use client";

import type { AuthUser } from "./use-auth";
import { apiGet } from "./api";

/**
 * זהות המשתמש — **נשלפת פעם אחת, לא בכל מסך.**
 *
 * ## מה היה איטי
 *
 * `useRequireAuth` ירה `GET /auth/me` בכל טעינת עמוד, וה-AppShell
 * ירה אותו בנפרד. כלומר כל מעבר בין מסכים שילם על אותה תשובה
 * פעמיים — ובעיקר, כל מסך המתין לה לפני שהתחיל למשוך את **הנתונים
 * שלו**:
 *
 * ```
 * useEffect(() => { if (authLoading) return; apiGet("/properties") … })
 * ```
 *
 * זה מפל סדרתי: ניווט ⟵ ‎/auth/me‎ ⟵ ‎/properties‎ ⟵ ציור. שתי
 * הלוך-חזור מלאות לפני שמופיע משהו על המסך, בכל מעבר, על תשובה
 * שאינה משתנה. זו הסיבה העיקרית לתחושת האיטיות.
 *
 * ## שלוש התכונות שהופכות את זה לנכון ולא רק למהיר
 *
 * **איחוד בקשות באוויר.** שני רכיבים שנטענים יחד (המעטפת והמסך)
 * מקבלים את **אותה** הבטחה, ולא שתי בקשות מקבילות. זה מה שמסיר את
 * הכפילות גם בטעינה ראשונה, לא רק בניווט.
 *
 * **תפוגה של דקה.** בלעדיה שינוי הרשאות שמנהל משרד עשה לא היה
 * משתקף עד רענון מלא — נסיגה אמיתית, כי היום כל טעינת מסך שואלת
 * מחדש. דקה מכווצת את מפל הניווט ועדיין מתקנת את עצמה מהר יותר
 * ממה שלוקח למנהל לומר לסוכן „רענן”.
 *
 * **כישלון אינו נשמר.** ‎401‎ שנכנס למטמון היה נועל את המשתמש מחוץ
 * למערכת עד לרענון. שגיאה מנקה את המטמון ונזרקת הלאה.
 */

const TTL_MS = 60_000;

let cached: { user: AuthUser; at: number } | null = null;
let inflight: Promise<AuthUser> | null = null;

/** `now` מוזרק לבדיקות; בפרודקשן תמיד השעון. */
export function cachedUser(now: number = Date.now()): AuthUser | null {
  if (cached === null) return null;
  return now - cached.at < TTL_MS ? cached.user : null;
}

export async function fetchMe(): Promise<AuthUser> {
  const fresh = cachedUser();
  if (fresh !== null) return fresh;
  /*
   * בקשה שכבר באוויר מוחזרת כפי שהיא. בלי זה המעטפת והמסך יורים
   * שתי בקשות זהות באותה מילישנייה — בדיוק מה שהמטמון בא למנוע,
   * ודווקא בטעינה הראשונה שהיא האיטית ביותר.
   */
  inflight ??= apiGet<{ user: AuthUser }>("/auth/me")
    .then((res) => {
      cached = { user: res.user, at: Date.now() };
      return res.user;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * ניקוי — ביציאה, ובכל שינוי שמשנה את הזהות או ההרשאות.
 *
 * המעטפת נשארת טעונה בין משתמשים (יציאה היא `router.replace` ולא
 * טעינה מחדש), ולכן בלי הניקוי המשתמש הבא היה מקבל את הזהות של
 * הקודם עד לתפוגה.
 */
export function clearSessionCache(): void {
  cached = null;
  inflight = null;
}
