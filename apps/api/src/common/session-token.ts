import type { Request } from "express";

/** שם עוגיית ה-Session של אפליקציית הווב. */
export const SESSION_COOKIE = "mv_session";

/**
 * ‏טוקן Session כפי ש-`issueSession` מנפיק אותו: 32 בתים ב-base64url,
 * כלומר 43 תווים בדיוק. כותרת שאינה בצורה הזו אינה טוקן שלנו, ואין
 * טעם לחפש אותה במסד.
 */
const BEARER = /^Bearer\s+([A-Za-z0-9_-]{43})$/u;

/**
 * ‎**הטוקן של הבקשה — מהעוגייה או מכותרת `Authorization`.**
 *
 * ‏שני נשאים לאותו Session, ולא שני סוגי Session: השורה במסד, התפוגה,
 * ‏עידן הסיסמה, רשימת „החיבורים הפתוחים שלי” וניתוקם — הכול זהה.
 * ‏ההבדל הוא רק איך הטוקן מגיע:
 *
 * - **הדפדפן** נושא אותו בעוגיית `httpOnly`, ש-JavaScript אינו קורא
 *   ‏ולכן XSS אינו גונב. הדפדפן מצרף אותה מעצמו, ומכאן ההגנות מול
 *   ‏CSRF — ‎`SameSite` ו-`OriginGuard`.
 * - **האפליקציה לנייד** אין לה צנצנת עוגיות שאפשר לסמוך עליה, ואין
 *   ‏לה מקור (Origin). היא שומרת את הטוקן ב-Keychain / Keystore
 *   ‏ומצרפת אותו במפורש בכותרת. כותרת שמצורפת במפורש אינה נשלחת
 *   ‏מעצמה מאתר זר — ולכן CSRF אינו חל עליה, וזו בדיוק הסיבה
 *   ‏ש-`OriginGuard` מוותר על בקשות בלי Origin.
 *
 * ‏הכותרת קודמת לעוגייה: היא הצהרה מפורשת של הלקוח, והעוגייה היא
 * ‏רקע שהדפדפן מצרף. בפועל הם אינם נפגשים — הווב אינו שולח כותרת
 * ‏והנייד אינו מחזיק עוגייה.
 */
export function sessionTokenOf(req: Pick<Request, "cookies" | "headers">): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const match = BEARER.exec(header.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  const cookie = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE];
  return typeof cookie === "string" && cookie !== "" ? cookie : null;
}
