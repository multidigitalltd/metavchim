/**
 * פענוח תשובות קצרות בצ'אט של הסוכן האישי — פונקציות טהורות,
 * מכוסות בבדיקות בנפרד מהשירות.
 *
 * ההתאמה היא **מילה שלמה בלבד**: "אשר" מאשר, אבל "אשר לי פגישה
 * ליום שלישי" הוא משפט חדש. משפט שמכיל את המילה ועוד תוכן חייב
 * להתפרש מחדש — אישור שנקרא מתוך משפט ארוך היה מבצע פעולה שהמתווך
 * לא התכוון אליה.
 */

const CONFIRM_WORDS = new Set([
  "אשר",
  "אישור",
  "מאשר",
  "מאשרת",
  "כן",
  "בצע",
  "תבצע",
  "יאללה",
  "אוקיי",
  "אוקי",
  "בסדר",
  "סבבה",
  "ok",
  "yes",
]);

const CANCEL_WORDS = new Set(["בטל", "ביטול", "תבטל", "לא", "עזוב", "עזבי", "cancel", "no"]);

/**
 * בקשת תפריט — "מה אתה יודע לעשות?" נשאלת שוב ושוב, ובכל פעם עלתה
 * קריאת מודל שלמה כדי לנסח את אותה תשובה. כאן היא נענית מהקטלוג,
 * חינם ובלי סיכוי לניסוח שגוי: הרשימה נגזרת מהפעולות שלמשתמש הזה
 * מותר לבקש. ההתאמה על משפט שלם בלבד — "עזרה עם הקונה של אתמול"
 * הוא בקשה אמיתית ולא תפריט.
 */
const HELP_PHRASES = new Set([
  "עזרה",
  "תפריט",
  "עזור לי",
  "מה אתה יודע",
  "מה אתה יודע לעשות",
  "מה אפשר לעשות",
  "מה את יודעת לעשות",
  "מה אתה יכול לעשות",
  "אפשרויות",
  "help",
  "menu",
]);


/** ניקוי לפני השוואה: סימני פיסוק וגרשיים שוואטסאפ ומקלדות מוסיפים. */
function normalizeShort(text: string): string {
  return text
    .trim()
    .replace(/[.,!?״"'׳*]+/gu, "")
    .toLowerCase();
}

export function isConfirmMessage(text: string): boolean {
  return CONFIRM_WORDS.has(normalizeShort(text));
}

export function isCancelMessage(text: string): boolean {
  return CANCEL_WORDS.has(normalizeShort(text));
}

export function isHelpMessage(text: string): boolean {
  return HELP_PHRASES.has(normalizeShort(text));
}

/**
 * בחירת מועמד במספר — "2" או "2." בלבד, בטווח הרשימה שהוצגה.
 * null = זו לא בחירה (והמשפט יתפרש כפקודה חדשה).
 */
export function choiceIndex(text: string, optionCount: number): number | null {
  const cleaned = normalizeShort(text);
  if (!/^\d{1,2}$/u.test(cleaned)) return null;
  const index = Number.parseInt(cleaned, 10);
  if (index < 1 || index > optionCount) return null;
  return index - 1;
}

/**
 * צורות ההקלדה הנפוצות של מספר ישראלי — להשוואה מול טלפון המשתמש.
 *
 * ה-wa_id של Meta הוא ספרות בינלאומיות ("9725..."); בפרופיל
 * המשתמשים מקלידים בדרך כלל מקומית ("05..."). ההשוואה נעשית על
 * ספרות בלבד משני הצדדים, ולכן די בשתי הצורות.
 */
export function waPhoneVariants(waId: string): string[] {
  const digits = waId.replace(/\D/gu, "");
  const variants = new Set<string>([digits]);
  if (digits.startsWith("972")) variants.add(`0${digits.slice(3)}`);
  else if (digits.startsWith("0")) variants.add(`972${digits.slice(1)}`);
  return [...variants];
}
