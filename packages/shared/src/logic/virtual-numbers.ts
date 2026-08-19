import { normalizePhone } from "./contact-people.js";
import { ISRAELI_PHONE } from "./telephony.js";

/**
 * מספרים וירטואליים — **מאיפה הגיעה השיחה, לא רק ממי.**
 *
 * ## מה זה פותר
 *
 * שיחה נכנסת אומרת מי התקשר. היא אינה אומרת מה גרם לו להתקשר —
 * ובלי זה משרד שמפרסם בארבעה ערוצים אינו יודע איזה מהם עובד, ומשלם
 * על כולם. הפתרון המקובל בענף הוא מספר נפרד לכל פרסום: המספר
 * שאליו התקשרו הוא בעצמו הנתון.
 *
 * ## שלושה שימושים, מנגנון אחד
 *
 * 1. **מדידת קמפיין** — מספר לכל מודעה. "שבע שיחות מפייסבוק, שתיים
 *    מיד2" הוא דוח שנבנה מעצמו.
 * 2. **ניתוב לסוכן** — מספר לכל סוכן, והליד נפתח כבר משויך אליו
 *    במקום לחכות בערימה המשותפת.
 * 3. **זיהוי הנכס** — מספר על שלט של נכס מסוים, והליד נפתח מקושר
 *    אליו. הסוכן יודע על מה מדובר עוד לפני שהרים.
 *
 * שלושתם אותה הגדרה בדיוק — מספר, ומה לעשות כשמתקשרים אליו — ולכן
 * טבלה אחת ולא שלוש. משרד שרוצה גם וגם ממלא שני שדות באותה שורה.
 *
 * ## למה הלוגיקה כאן ולא בשירות
 *
 * ההתאמה היא **נרמול והשוואה**, ובדיוק בגלל זה קל לטעות בה בשקט:
 * מספר שנשמר כ-‎"03-1234567"‎ ומגיע מהמרכזייה כ-‎"+97231234567"‎ הוא
 * אותו מספר, והשוואת מחרוזות פשוטה הייתה מחזירה "אין התאמה" — כלומר
 * הליד נפתח בלי מקור, בלי סוכן ובלי נכס, ואיש לא היה יודע למה.
 */

/** ההגדרה של מספר וירטואלי אחד — מה שהמשרד מילא. */
export interface VirtualNumberRule {
  id: string;
  /** המספר כפי שנשמר. מנורמל בכתיבה, ומנורמל שוב בהשוואה. */
  phone: string;
  /** שם לאדם: "קמפיין פייסבוק ינואר", "שלט ברבי עקיבא 12". */
  label: string;
  /** מקור הליד שייכתב על כל ליד מהמספר הזה. ריק = "טלפון". */
  leadSource: string;
  /** הסוכן שיקבל את הליד. ריק = לערימה המשותפת. */
  assignedToUserId: string | null;
  /** הנכס שהמספר מפרסם. ריק = לא ידוע. */
  propertyId: string | null;
  isActive: boolean;
}

/**
 * המספר בצורתו הקנונית לשמירה ולהשוואה.
 *
 * מחזיר מחרוזת ריקה כשאינו מספר ישראלי תקין — הקורא דוחה, ולא שומר
 * שורה שלעולם לא תותאם.
 */
export function canonicalVirtualNumber(raw: string): string {
  const normalized = normalizePhone(raw);
  return ISRAELI_PHONE.test(normalized) ? normalized : "";
}

/**
 * ההגדרה שמתאימה למספר שאליו התקשרו.
 *
 * מושבתת אינה מותאמת: משרד שסיים קמפיין מכבה את המספר ומצפה
 * שהלידים יחזרו לזרימה הרגילה — מחיקה הייתה מוחקת גם את ההיסטוריה
 * שלפיה הוא מודד את הקמפיין בדיעבד.
 */
export function matchVirtualNumber(
  dialed: string | undefined,
  rules: readonly VirtualNumberRule[],
): VirtualNumberRule | null {
  if (dialed === undefined) return null;
  const needle = canonicalVirtualNumber(dialed);
  if (needle === "") return null;
  return (
    rules.find((rule) => rule.isActive && canonicalVirtualNumber(rule.phone) === needle) ?? null
  );
}

/** למה ההגדרה נדחית, או null כשהיא תקינה. */
export function virtualNumberRejection(input: {
  phone: string;
  label: string;
}): string | null {
  if (canonicalVirtualNumber(input.phone) === "") {
    return "המספר אינו מספר טלפון ישראלי תקין";
  }
  if (input.label.trim().length < 2) return "צריך שם שיזהה את המספר";
  return null;
}

/**
 * מקור הליד שייכתב בפועל.
 *
 * עמודת `source` בליד מוגבלת ל-20 תווים, ותווית ארוכה יותר הייתה
 * מפילה את הכתיבה — כלומר שיחה שנכנסה ולא נפתח ממנה ליד כלל. חיתוך
 * עדיף על אובדן, ולכן הוא כאן ולא בבדיקה שדוחה.
 */
export function leadSourceFor(rule: VirtualNumberRule): string {
  const chosen = rule.leadSource.trim() !== "" ? rule.leadSource.trim() : rule.label.trim();
  return chosen.slice(0, 20) || "phone";
}
