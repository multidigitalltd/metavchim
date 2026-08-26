/**
 * לאן מותר להחזיר משתמש אחרי התחברות.
 *
 * שני מסלולי הכניסה שופטים את אותו `next`: הטופס בדפדפן, והחזרה
 * מ-Google שמתבצעת בשרת. שני עותקים של אותה רשימה היו נפרדים ביום
 * שמישהו מרחיב אחד מהם, ולכן ההיתר יושב כאן — במקום אחד ששניהם
 * מייבאים.
 *
 * ההיתר מונה נתיבים ולא מתיר "כל דבר שמתחיל ב-/": פרמטר הפניה פתוח
 * הוא open redirect, וגם נתיב פנימי שרירותי היה מאפשר להנחית משתמש
 * טרי על מסך מטעה. כרגע הנתיב היחיד שמפנה להתחברות עם חזרה הוא דף
 * ההצעה בלינק.
 */
const ALLOWED_RETURN_PATHS: readonly RegExp[] = [/^\/subscribe\/[A-Za-z0-9_-]{8,64}$/u];

/**
 * הנתיב עצמו כשהוא מותר, אחרת `null`.
 *
 * הקלט מוכרז `unknown` בכוונה: מקורו במחרוזת השאילתה, ובשרת הוא
 * יכול להגיע גם כמערך (`?next=a&next=b`). מי שיקבל כאן `string`
 * ייאלץ להמיר בכוח בכל אתר קריאה, וההמרה הזו היא בדיוק הנקודה
 * שבה בדיקה נשמטת.
 */
export function safeLoginReturnPath(next: unknown): string | null {
  if (typeof next !== "string") return null;
  return ALLOWED_RETURN_PATHS.some((pattern) => pattern.test(next)) ? next : null;
}

/** יעד סופי אחרי התחברות — ברירת המחדל היא לוח הבקרה. */
export function afterLoginTarget(next: unknown): string {
  return safeLoginReturnPath(next) ?? "/";
}

/**
 * הוספת `next` לכתובת, רק כשהוא מותר.
 *
 * כך נשמרת החזרה גם כשהכניסה עוברת עוד תחנה — החלפת סיסמה זמנית
 * או סבב OAuth — במקום ליפול ללוח הבקרה באמצע הדרך.
 */
export function withLoginReturn(url: string, next: unknown): string {
  const safe = safeLoginReturnPath(next);
  return safe === null ? url : `${url}?next=${encodeURIComponent(safe)}`;
}
