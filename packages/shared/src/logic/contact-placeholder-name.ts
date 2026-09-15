/**
 * ‎**שם שהוא מציין מקום, ולא שם.**
 *
 * ‏שיחה נכנסת שלא נענתה יוצרת כרטיס איש קשר עם
 * ‎`name: callerName ?? phone` — כלומר, כשהמרכזייה לא מסרה שם,
 * ‏הכרטיס נקרא **במספר הטלפון של עצמו**.
 *
 * ‏מאוחר יותר המתווך מבקש „תפתח קונה למספר הזה” ונותן שם אמיתי.
 * ‎`findOrCreateByPhone` מחזיר את הכרטיס הקיים ומתעלם מהשם החדש,
 * ‏ולכן ברשימת השיחות המשיך להופיע המספר — במקום מי שהתקשר
 * ‏(דיווח מהשטח).
 *
 * ‎**מה שאסור כאן הוא דריסה.** שם אמיתי שנשמר קודם הוא ידע של
 * ‏המשרד, ועדכון שקט שלו הוא איבוד נתונים. לכן ההחלטה אינה „יש
 * ‏שם חדש” אלא „מה שיש אינו שם”: ריק, או המספר עצמו.
 */

/** ‏רק ספרות — כדי להשוות „050-123-4567” ו-„+972501234567”. */
function digits(value: string): string {
  return value.replace(/\D/gu, "");
}

/**
 * ‏הצורה שאפשר להשוות בה שני מספרים ישראליים: „0501234567”
 * ‏ו-„972501234567” הם אותו מספר, ולכן הקידומת יורדת משניהם.
 */
function localDigits(value: string): string {
  const d = digits(value);
  if (d.startsWith("972")) return d.slice(3).replace(/^0+/u, "");
  return d.replace(/^0+/u, "");
}

/**
 * ‎**האם השם השמור הוא מציין מקום שמותר להחליף.**
 *
 * ‏שני מקרים בלבד, ושניהם „אין כאן שם”:
 *
 * 1. ‏ריק או רווחים.
 * 2. ‏המספר עצמו — בכל צורה שהיא נכתבה בה.
 *
 * ‏כל דבר אחר הוא שם שמישהו הקליד, ואינו נדרס.
 */
export function isPlaceholderContactName(name: string, phone: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return true;
  /*
   * ‎**כולו מספר, ואותו מספר.** שתי הדרישות נחוצות: „דנה 2” אינה
   * ‏מספר גם אם יש בה ספרה, ומספר אחר לגמרי הוא שם שמישהו הקליד
   * ‏(למשל טלפון נוסף) — ובשני המקרים אסור לדרוס.
   */
  if (!/^[\d\s\-+()]+$/u.test(trimmed)) return false;
  const asPhone = localDigits(trimmed);
  return asPhone !== "" && asPhone === localDigits(phone);
}

/**
 * ‏השם שצריך להישמר על הכרטיס: החדש כשהישן היה מציין מקום,
 * ‏ואחרת הישן. `null` פירושו „אין מה לעדכן”.
 */
export function contactNameUpgrade(
  stored: string,
  incoming: string,
  phone: string,
): string | null {
  const next = incoming.trim();
  if (next === "") return null;
  if (!isPlaceholderContactName(stored, phone)) return null;
  /* ‏שם חדש שהוא עצמו המספר אינו שדרוג */
  if (isPlaceholderContactName(next, phone)) return null;
  return next;
}
