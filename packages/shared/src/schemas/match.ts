import { z } from "zod";
import { IdSchema } from "./common.js";

export const MatchStatusSchema = z.enum(["suggested", "dismissed", "offered"]);

/**
 * פירוט הניקוד לכל קריטריון — הבסיס להסבר ההתאמה למתווך.
 * weight: משקל הקריטריון; score: 0–1; note: הסבר קריא ("חסר ממ\"ד, סומן כעדיפות").
 */
/**
 * קריטריוני ההתאמה — **רשימה אחת שהכול נגזר ממנה.**
 *
 * היא הייתה שתיים: הסכמה כאן מנתה עשרה, ו-`DEFAULT_MATCH_WEIGHTS`
 * מנתה שמונה. `floor` ו-`semantic` היו בסכמה בלבד — בלי משקל, בלי
 * תווית, ובלי שום מקום בקוד שמייצר אותם.
 *
 * כל עוד הפירוט לא הוחזר למסך ההפרש היה בלתי נראה. ברגע שהוא מוצג,
 * קריטריון בלי תווית הוא צ'יפ ריק על המסך — ומי שיוסיף מחר `floor`
 * לסכמה יקבל בדיוק את זה, בלי אזהרה.
 *
 * המשקלים נגזרים מכאן (`Record<MatchCriterion, number>`), ולכן
 * קריטריון שיתווסף לרשימה **לא יעבור קומפילציה** עד שיקבל משקל
 * ותווית. זה ההבדל בין שתי רשימות שמסכימות לרשימה אחת.
 */
export const MATCH_CRITERIA = [
  "location",
  "budget",
  "rooms",
  "property_type",
  "area",
  "features_must",
  "features_nice",
  "entry_date",
  /*
   * ‎**`floor` חזר, ועכשיו עם כל מה שהיה חסר לו.**
   *
   * הוא היה כאן פעם — בסכמה בלבד, בלי משקל, בלי תווית ובלי שום קוד
   * שמייצר אותו — והוסר בדיוק מהסיבה הזו. הפעם הוא מגיע יחד עם
   * ‎`floorPreference` בדרישות הקונה, עם משקל, עם תווית ועם ענף
   * ניקוד. הטיפוסים אוכפים את השלושה: קריטריון בלי משקל או בלי
   * תווית אינו עובר קומפילציה.
   */
  "floor",
] as const;

export type MatchCriterion = (typeof MATCH_CRITERIA)[number];

/**
 * ‎**אורך ההערה המרבי — קבוע אחד, ולא מספר שמופיע בשני מקומות.**
 *
 * ההערה נוצרת במנוע ונקראת חזרה מ-JSON דרך הסכמה הזו. כשהמנוע לא
 * הכיר את התקרה הוא ייצר הערות ארוכות ממנה (רשימת מאפיינים שרשורה,
 * בלי גבול על מספר הדרישות של הקונה), הכתיבה שמרה אותן בלי אימות,
 * והקריאה **השמיטה את הרכיב בשקט** — כך שקריטריון שנבדק, נכשל,
 * ואף פסל את ההתאמה, הופיע על המסך כ„לא נבדק” (ביקורת Codex).
 *
 * זו בדיוק ההבחנה שרצועת ההסבר קיימת בשבילה, שנשברה בדרך אליה.
 * הקבוע מיוצא כדי ששני הצדדים יימדדו מולו ולא מול זיכרון.
 */
export const SCORE_NOTE_MAX = 300;

export const ScoreComponentSchema = z.object({
  criterion: z.enum(MATCH_CRITERIA),
  weight: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  note: z.string().max(SCORE_NOTE_MAX).optional(),
});
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;

export const MatchSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  propertyId: IdSchema,
  buyerId: IdSchema,
  score: z.number().int().min(0).max(100),
  breakdown: z.array(ScoreComponentSchema),
  explanation: z.string().max(1000),
  status: MatchStatusSchema,
  computedAt: z.coerce.date(),
});
export type Match = z.infer<typeof MatchSchema>;

/** ספים מוסכמים לתצוגה — מתועדים באפיון (94% מומלץ / 81% ייתכן / 63% דורש בדיקה). */
export const MATCH_THRESHOLDS = {
  recommended: 85,
  possible: 70,
  review: 50,
} as const;

/**
 * ‎**הסף שמעליו התאמה נחשבת שווה-הצגה ברשת השיתופים.**
 *
 * ‏הוא יושב כאן ולא בשירות, ולא בשניים מהם: עד עכשיו המספר היה
 * כתוב פעמיים ב-`apps/api` — פעם בצד הביקושים ופעם בצד הנכסים —
 * ועכשיו יש לו קורא שלישי שאינו יכול לייבא מהם כלל (הסורק
 * ב-`apps/workers`). שלושה עותקים של אותו סף הם שלוש דעות על מה
 * „מתאים”, והמשתמש רואה את שתיהן זו לצד זו: כרטיס שאומר „מתאים”
 * והתראה שלא הגיעה.
 *
 * ‎**מדוע דווקא כאן ולא כערך של `MATCH_THRESHOLDS`.** הוא שווה
 * במקרה ל-`possible`, אבל אינו אותו דבר: הספים שמעליו הם שפת
 * התצוגה הפנימית של המשרד, וזה הרף שמעליו מוצע משהו למשרד **אחר**.
 * קשירה ביניהם הייתה אומרת ששינוי בתצוגה הפנימית משנה מה נשלח
 * החוצה, וזו הכרעה שאיש לא התכוון אליה.
 */
export const NETWORK_MATCH_MIN_SCORE = 70;
