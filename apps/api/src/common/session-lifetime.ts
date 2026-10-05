/**
 * ‏אורך החיים של Session — ההחלטה במקום אחד, טהורה ונבדקת.
 *
 * ‏**דפדפן: 12 שעות, בלי הארכה.** מחשב במשרד נשאר פתוח, ועוגייה שחיה
 * ‏לנצח היא חשבון פתוח לכל מי שיושב שם אחרי הצהריים.
 *
 * ‏**אפליקציה במכשיר נעול: 30 יום, מתגלגל.** הטלפון עצמו נעול בקוד או
 * ‏בטביעת אצבע, והטוקן שמור ב-Keychain / Keystore — הנעילה של המכשיר
 * ‏היא ההגנה, ולא סיסמה שמוקלדת בכל בוקר. כל פעילות מזיזה את התפוגה
 * ‏קדימה, ומי שלא פתח את האפליקציה חודש מתחבר מחדש. אפליקציה במכשיר
 * ‏**בלי** נעילה מקבלת את 12 השעות של הדפדפן: מי שמרים טלפון פתוח
 * ‏מהשולחן לא אמור למצוא בו את כל לקוחות המשרד לחודש קדימה.
 *
 * ‏ההארכה נכתבת למסד לכל היותר פעם ביום ולא בכל בקשה: הפרש של יום
 * ‏בתפוגה אינו משנה דבר למשתמש, וכתיבה בכל בקשה הייתה הופכת כל
 * ‏`GET` לעדכון.
 *
 * ‏**ומכשיר נייד אחד לחשבון.** `client` הוא הצהרה של הלקוח, ולכן היא
 * ‏אינה פטור משער „חיבור אחד לחשבון” של ה-web אלא משבצת נפרדת ומוגבלת:
 * ‏`issueSession` מוחק את ה-Session הנייד הקודם של המשתמש לפני שהוא
 * ‏מנפיק חדש. דפדפן אחד (השער ב-web) + טלפון אחד (כאן) — ולא יותר.
 */

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const PERSISTENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** ‏מרווח ההארכה — התפוגה נדחפת קדימה רק אחרי שעבר לפחות יום מההארכה הקודמת. */
export const RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type SessionClient = "web" | "mobile";

/** ‏Session מתמשך הוא של האפליקציה בלבד — דפדפן שמבקש אותו מקבל את הרגיל. */
export function isPersistentSession(client: SessionClient, requested: boolean): boolean {
  return client === "mobile" && requested;
}

export function sessionTtlMs(persistent: boolean): number {
  return persistent ? PERSISTENT_SESSION_TTL_MS : SESSION_TTL_MS;
}

/**
 * ‏התפוגה החדשה של Session מתמשך אחרי פעילות, או `null` כשאין מה לעדכן:
 * ‏Session רגיל, או מתמשך שהוארך לפני פחות מיום.
 */
export function renewedExpiry(
  session: { persistent: boolean; expiresAt: Date },
  now: Date,
): Date | null {
  if (!session.persistent) return null;
  const full = now.getTime() + PERSISTENT_SESSION_TTL_MS;
  if (full - session.expiresAt.getTime() < RENEW_INTERVAL_MS) return null;
  return new Date(full);
}
