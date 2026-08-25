import { BUYER_SOURCE_LABELS } from "./buyer.js";
import { LEAD_SOURCE_LABELS } from "./lead.js";

/**
 * חיפוש בטוח בטבלת תוויות.
 *
 * טבלאות התוויות מוקלדות לפי הסכימה (`Record<LeadStatus, string>`
 * ולא `Record<string, string>`), כדי שערך שנוסף לסכימה ולא לטבלה
 * ישבור את הבנייה. טבלה רופפת היא בדיוק מה שהציג `very_hot` גולמי
 * למתווך, ואחר כך `in_progress` ו-`rent_in` באותה פונקציה (ביקורת
 * Codex).
 *
 * המחיר הוא שערך שהגיע מהמסד — `string` ולא הטיפוס הסגור — אינו
 * מפתח חוקי. הפונקציה הזו היא המקום היחיד שמגשר: היא מקבלת ערך
 * לא ידוע, מחזירה תווית אם יש, ואת הערך עצמו אם אין. שורה ישנה
 * במסד מוצגת כמות שהיא ולא נעלמת.
 */
export function labelOf<K extends string>(
  table: Record<K, string>,
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return (table as Record<string, string | undefined>)[value] ?? value;
}

/**
 * מקור הקונה לתצוגה, כולל קונה שהומר מליד.
 *
 * המרה מליד שומרת `source = "lead:<מקור הליד>"`, ולכן החיפוש הוא
 * דו-שלבי ואינו סתם טבלה. הפונקציה יושבת כאן ולא במסך כדי שגם
 * הכרטיס שהשרת כותב לוואטסאפ יקרא את אותו דבר (ביקורת Codex).
 */
export function buyerSourceLabel(source: unknown): string | undefined {
  if (typeof source !== "string" || source === "") return undefined;
  if (source.startsWith("lead:")) {
    const leadSource = source.slice("lead:".length);
    return `ליד (${labelOf(LEAD_SOURCE_LABELS, leadSource) ?? leadSource})`;
  }
  return labelOf(BUYER_SOURCE_LABELS, source);
}

/**
 * תוצאת שיחה — הערכים של `OutcomeSchema` בנתיב השיחות.
 *
 * הטבלה רופפת ולא `Record<Outcome, …>` כי הערכים מגיעים גם
 * ממרכזייה חיצונית; מה שאינו מוכר מוצג כמות שהוא.
 */
export const CALL_OUTCOME_LABELS: Record<string, string> = {
  answered: "נענתה",
  missed: "לא נענתה",
  no_answer: "אין מענה",
  voicemail: "תא קולי",
  /*
   * ‎**„לא ידוע” הוא ערך אמיתי ולא חור בנתונים.**
   *
   * המרכזייה אינה תמיד מוסרת אם השיחה נענתה: אירוע ניתוק בלי משך
   * אינו אומר דבר על מענה. עד כה כל מה שלא סווג „לא נענתה” נרשם
   * „נענתה”, ולכן המסך טען טענה שאיש לא בדק — ובשטח *כל* השיחות
   * הוצגו כנענו (דיווח מהמשרד).
   *
   * שיחה שנענתה ושיחה שאיננו יודעים עליה הן שתי עובדות שונות
   * לחלוטין עבור מתווך שמחליט למי לחזור.
   */
  unknown: "לא ידוע",
};

/**
 * התוצאות שמותר **לרשום** ידנית — לא כל מה שמותר להציג.
 *
 * ‎`CALL_OUTCOME_LABELS` הוא טבלת תצוגה, והמסך בנה ממנה גם את
 * רשימת הבחירה בטופס רישום שיחה. ברגע ש-`unknown` נוסף לתצוגה הוא
 * הופיע גם שם — והשרת דוחה אותו בכוונה, כך שהמשתמש היה בוחר ערך
 * לגיטימי למראה ומקבל שגיאה בשמירה (ביקורת Codex).
 *
 * שתי הרשימות אינן אותה רשימה: „לא ידוע” הוא מה שהמרכזייה כותבת
 * כשלא מסרה אם השיחה נענתה, ומי שרושם שיחה בעצמו **יודע** מה קרה
 * בה. הפרדה מפורשת כאן היא מה שמונע מהן להתאחד שוב בשינוי הבא.
 */
export const CALL_OUTCOME_MANUAL = [
  "answered",
  "missed",
  "no_answer",
  "voicemail",
] as const;
