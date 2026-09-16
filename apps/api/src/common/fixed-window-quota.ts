import { ServiceUnavailableException } from "@nestjs/common";
import type IORedis from "ioredis";

/**
 * ‎**מונה חלון קבוע ב-Redis — עותק אחד, לכל מי שמגביל קצב.**
 *
 * ‏שלושת הכללים שמקודדים כאן הם שלוש ביקורות Codex נפרדות שכל אחת
 * ‏מהן תיקנה באג אמיתי בהגבלת קצב. כל עוד הם ישבו בתוך שירות אחד,
 * ‏המגביל הבא היה כותב `INCR` משלו ומקבל את שלושתם בחזרה. לכן הם
 * ‏כאן, במקום אחד, ולא בכל מי שסופר.
 */

/** ‏תוצאת גבייה אחת. */
export interface FixedWindowCharge {
  /** ‎`false` = הבקשה חצתה את התקרה, וההגדלה שלה **כבר בוטלה**. */
  allowed: boolean;
  /**
   * ‏מזהה הדור של החלון שנגבה — רק כשנמסר `stampKey`, ורק למי
   * ‏שמחזיר מכסה. ‎`null` = אין חותם, או שלא ניתן לקרוא אותו.
   */
  window: string | null;
}

export interface FixedWindowInput {
  /** ‏מפתח המונה. **לא PII** — גבבו כתובת אימייל או IP לפני שמגיעים לכאן. */
  key: string;
  /** ‏כמה מותר בחלון. בקשה שחוצה — נדחית. */
  limit: number;
  windowSeconds: number;
  /**
   * ‏מפתח שני שנושא מזהה דור לחלון, ו-`stamp` הוא הערך שייכתב בו.
   * ‏נחוץ **רק** למי שמחזיר מכסה — ראו `releaseFixedWindow`.
   */
  stampKey?: string;
  stamp?: string;
  /** ‏מה נאמר למשתמש כשהתשובה מ-Redis אינה קריאה. */
  unavailableMessage: string;
}

/**
 * ‏גבייה אטומית: הגדלה, תפוגה, ובדיקת התקרה — הכול בסקריפט אחד.
 *
 * ‎**המונה והתפוגה בפעולה אחת.**
 * ‏`INCR` ואז `EXPIRE` הם שתי פקודות, ובין השתיים אפשר להיכשל. מה
 * ‏שנשאר אז הוא מפתח מונה **בלי תפוגה**: הוא ממשיך לגדול בכל ניסיון,
 * ‏ומרגע שעבר את התקרה המקור חסום **לתמיד** ולא לחלון (ביקורת Codex).
 * ‏זה הכשל הגרוע ביותר האפשרי בהגבלת קצב — הגבלה שאין לה סוף. התפוגה
 * ‏נקבעת גם כשהמפתח קיים ואיבד אותה משום מה (`ttl == -1`), כדי שמפתח
 * ‏כזה שכבר שרד ייפדה מעצמו בפנייה הבאה.
 *
 * ‎**בקשה שנדחתה אינה משאירה את ההגדלה שלה.**
 * ‏כשהבדיקה ישבה מחוץ לסקריפט, הבקשה שחצתה את התקרה הגדילה — ונדחתה,
 * ‏והשאירה את הערך הגבוה במונה. אם אחת מקודמותיה הוחזרה אחר-כך, המונה
 * ‏ירד לתקרה בעוד שבפועל יצאו פחות בקשות: הבקשה הלגיטימית הבאה מוצאת
 * ‏תקרה מלאה עד סוף החלון (ביקורת Codex). הביטול קורה באותו סקריפט,
 * ‏ולכן אין רגע שבו הספירה כוללת ניסיון שנדחה.
 *
 * ‎**החלון מסומן במזהה, כדי שההחזר יידע למי הוא שייך.**
 * ‏החזר עיוור (`DECR` סתם) פוגע בכל דבר חוץ מהחלון שנגבה: מפתח שפג
 * ‏בינתיים נוצר מחדש בערך ‎-1 **בלי תפוגה**, וחלון חדש שכבר נפתח סופג
 * ‏הפחתה של בקשה שאינה שייכת לו (ביקורת Codex). המזהה נכתב עם הגבייה
 * ‏הראשונה, חי בדיוק כמו המונה, וההחזר מותנה בו.
 */
export async function chargeFixedWindow(
  redis: Pick<IORedis, "eval">,
  input: FixedWindowInput,
): Promise<FixedWindowCharge> {
  const stamped = input.stampKey !== undefined;
  const charged = await redis.eval(
    `local n = redis.call('INCR', KEYS[1])
     if n == 1 or redis.call('TTL', KEYS[1]) == -1 then
       redis.call('EXPIRE', KEYS[1], ARGV[1])
       if KEYS[2] then redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[1]) end
     end
     if n > tonumber(ARGV[3]) then
       redis.call('DECR', KEYS[1])
       return { 0, '' }
     end
     if KEYS[2] then return { 1, redis.call('GET', KEYS[2]) } end
     return { 1, '' }`,
    stamped ? 2 : 1,
    ...(stamped ? [input.key, input.stampKey!] : [input.key]),
    String(input.windowSeconds),
    input.stamp ?? "",
    String(input.limit),
  );
  const [allowedRaw, windowRaw] = Array.isArray(charged) ? charged : [];
  /*
   * ‏תשובה שאי אפשר לקרוא **עוצרת** את הפעולה. „אם זה מספר וגם מעל
   * ‏התקרה” נכשל לכיוון הפתוח, כלומר הופך תקלה בספירה לביטול ההגבלה.
   */
  if (typeof allowedRaw !== "number") {
    throw new ServiceUnavailableException(input.unavailableMessage);
  }
  /* בלי מזהה חלון לא יוחזר דבר — עדיף לגבות יתר על לאבד תקרה. */
  const window = typeof windowRaw === "string" && windowRaw !== "" ? windowRaw : null;
  return { allowed: allowedRaw === 1, window };
}

/**
 * ‏החזר מכסה — **רק** לחלון שממנו היא נגבתה.
 *
 * ‏התנאי הכפול הוא כל העניין: החותם חייב להיות אותו חותם, והמונה
 * ‏חייב עדיין להתקיים. בלעדיו ההחזר מגיע לחלון של מישהו אחר, או
 * ‏מחייה מפתח שפג — בערך שלילי ובלי תפוגה.
 */
export async function releaseFixedWindow(
  redis: Pick<IORedis, "eval">,
  input: { key: string; stampKey: string; window: string },
): Promise<void> {
  await redis.eval(
    `if redis.call('GET', KEYS[2]) == ARGV[1] and redis.call('EXISTS', KEYS[1]) == 1 then
       return redis.call('DECR', KEYS[1])
     end
     return 0`,
    2,
    input.key,
    input.stampKey,
    input.window,
  );
}
