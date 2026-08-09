/**
 * חתימת יד מצוירת, כתמונת PNG ב-data URL.
 *
 * המחרוזת הזו מגיעה מנתיב **ציבורי** (עמוד החתימה, בלי התחברות)
 * ונשמרת בבסיס הנתונים ומוצגת אחר כך במסמך. לכן היא נבדקת כאן ולא
 * נסמכת על כך שהדפדפן שלנו הוא זה ששלח אותה:
 *
 * - רק `image/png` — SVG הוא מסמך שמריץ סקריפטים, ותמונת חתימה
 *   שמוצגת בכרטיס הלקוח הייתה הופכת לנתיב XSS מושלם
 * - רק base64, בלי תווים מחוץ לאלפבית — כדי שהמחרוזת לא תוכל לשאת
 *   `"` או `<` ולצאת מתוך התכונה שבה היא מוצגת
 * - תקרת גודל — הקלט ציבורי, ובלי תקרה כל אחד יכול לכתוב מגה-בייטים
 *   לשורה בבסיס הנתונים
 */

const PREFIX = "data:image/png;base64,";

/**
 * ‎~59KB. ציור על קנבס 600×200 שוקל בפועל 5–20KB, ולכן זו תקרה רחבה.
 *
 * היא נשארת **מתחת** למגבלת גוף הבקשה של השרת (100KB): תקרה גבוהה
 * ממנה הייתה מייצרת חתימה שעוברת את הבדיקה כאן ונדחית שכבה אחת
 * מתחת, עם שגיאה שאינה אומרת דבר לחותם.
 */
export const MAX_SIGNATURE_CHARS = 60_000;

/** המינימום המעשי — קנבס ריק לגמרי מתקמפל לכמה מאות תווים. */
const MIN_SIGNATURE_CHARS = PREFIX.length + 100;

export function isSignatureDataUrl(value: string): boolean {
  if (!value.startsWith(PREFIX)) return false;
  if (value.length > MAX_SIGNATURE_CHARS) return false;
  if (value.length < MIN_SIGNATURE_CHARS) return false;
  const payload = value.slice(PREFIX.length);
  return /^[A-Za-z0-9+/]+={0,2}$/u.test(payload);
}
