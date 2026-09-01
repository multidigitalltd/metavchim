import { z } from "zod";
import { normalizePhone } from "../logic/contact-people.js";

/** מזהה ישות — ULID (26 תווים, Crockford Base32). */
export const IdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u, "מזהה לא תקין");
export type Id = z.infer<typeof IdSchema>;

/**
 * טלפון ישראלי מנורמל לפורמט E.164 (‎+9725XXXXXXXX).
 * הנורמליזציה נעשית בשכבת הקלט; בסכמה נשמר רק הפורמט הסופי.
 */
export const PhoneSchema = z.string().regex(/^\+972[2-9]\d{7,8}$/u, "מספר טלפון ישראלי לא תקין");
export type Phone = z.infer<typeof PhoneSchema>;

/**
 * ‎**טלפון כפי שאדם מקליד אותו** — מנורמל, ואז מאומת.
 *
 * ## הבאג שזה מונע
 *
 * ‎`PhoneSchema` מתעד ש„הנורמליזציה נעשית בשכבת הקלט”, וזה היה נכון
 * כל עוד שכבת הקלט זכרה. היא לא: שלושה מסכים החזיקו כל אחד עותק
 * פרטי של הנרמול, ושני מסכי העריכה — בעל הנכס והמחזיק — לא החזיקו
 * אף אחד. התוצאה היא ש-`0504143565`, מספר תקין לחלוטין, נדחה
 * ב„קלט לא תקין” בעריכה ונקלט ביצירה.
 *
 * שלושת העותקים גם היו **חלשים יותר** מהמקור: הם לא ידעו לקרוא
 * ‎`972…`‎ בלי `+`, ולא מספר בן תשע ספרות בלי אפס מוביל.
 *
 * ‎**התיקון הוא שהשרת מנרמל, ולא שכל מסך יזכור.** מסך חדש שיישכח
 * לא יכול לשבור את מה שאין לו אפשרות לשכוח.
 *
 * הנרמול לפני האימות ולא במקומו: קלט פגום עדיין נדחה בהודעה ברורה
 * ואינו הופך בשקט למחרוזת אחרת.
 */
export const PhoneInputSchema = z
  .string()
  .trim()
  .max(25)
  .transform(normalizePhone)
  .pipe(PhoneSchema);

/** סכום בשקלים חדשים, באגורות (Integer) — לעולם לא Float לכסף. */
export const MoneyAgorotSchema = z.number().int().nonnegative();
export type MoneyAgorot = z.infer<typeof MoneyAgorotSchema>;

/**
 * התקרה לגודל עמוד — **מקור אמת אחד לשרת ולמסך.**
 *
 * הסכימות בשרת הן `.strict()`, ולכן בקשה מעל התקרה נדחית בשער ולא
 * מגיעה לשירות כלל. מסך שקבע לעצמו מספר גדול יותר אינו „מקבל פחות
 * שורות” — הוא מקבל 400 על כל בקשה, וזה בדיוק מה שקרה לבורר
 * הנכסים התואמים. קבוע משותף הופך את הפער הזה לבלתי אפשרי.
 */
export const PAGE_LIMIT_MAX = 100;

/** עמוד תוצאות מבוסס Cursor — הסטנדרט לכל רשימה במערכת. */
export const PageRequestSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(PAGE_LIMIT_MAX).default(50),
});
export type PageRequest = z.infer<typeof PageRequestSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
