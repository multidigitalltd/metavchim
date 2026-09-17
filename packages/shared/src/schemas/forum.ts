import { z } from "zod";
import {
  FORUM_BODY_MAX,
  FORUM_BODY_MIN,
  FORUM_KINDS,
  FORUM_LISTING_AREA_MAX,
  FORUM_LISTING_CONTACT_MAX,
  FORUM_LISTING_DESCRIPTION_MAX,
  FORUM_LISTING_KINDS,
  FORUM_LISTING_NAME_MAX,
  FORUM_LISTING_URL_MAX,
  FORUM_PRO_CATEGORIES,
  FORUM_RATING_COMMENT_MAX,
  FORUM_REPLY_MAX,
  FORUM_REPLY_MIN,
  FORUM_REPORT_NOTE_MAX,
  FORUM_REPORT_REASONS,
  FORUM_SEARCH_MAX,
  FORUM_TITLE_MAX,
  FORUM_TITLE_MIN,
  FORUM_TOOL_CATEGORIES,
  FORUM_TOPICS,
} from "../logic/forum.js";
import { IdSchema } from "./common.js";

/**
 * הפורום המקצועי — סכמות הקלט (docs/16).
 *
 * הגבולות נגזרים מהקבועים ב-`logic/forum.ts`, שמהם נגזרות גם
 * העמודות במסד: קלט שה-API מקבל וה-DB דוחה הוא שגיאה שנראית
 * כתקלה (הלקח מ-`MENTOR_INTENTION_MAX`). כל הסכמות `strict` —
 * שדה שלא הוצהר נדחה בשער.
 */

export const ForumKindSchema = z.enum(FORUM_KINDS);
export const ForumTopicSchema = z.enum(FORUM_TOPICS);

export const ForumThreadInputSchema = z
  .object({
    kind: ForumKindSchema,
    topic: ForumTopicSchema,
    title: z.string().trim().min(FORUM_TITLE_MIN).max(FORUM_TITLE_MAX),
    body: z.string().trim().min(FORUM_BODY_MIN).max(FORUM_BODY_MAX),
    /** בעילום שם — ברירת המחדל שקרית: הבחירה חייבת להיות מפורשת. */
    anonymous: z.boolean().default(false),
  })
  .strict();
export type ForumThreadInput = z.infer<typeof ForumThreadInputSchema>;

export const ForumThreadEditSchema = z
  .object({
    topic: ForumTopicSchema.optional(),
    title: z.string().trim().min(FORUM_TITLE_MIN).max(FORUM_TITLE_MAX).optional(),
    body: z.string().trim().min(FORUM_BODY_MIN).max(FORUM_BODY_MAX).optional(),
  })
  .strict();
export type ForumThreadEdit = z.infer<typeof ForumThreadEditSchema>;

export const ForumReplyInputSchema = z
  .object({
    body: z.string().trim().min(FORUM_REPLY_MIN).max(FORUM_REPLY_MAX),
    anonymous: z.boolean().default(false),
  })
  .strict();
export type ForumReplyInput = z.infer<typeof ForumReplyInputSchema>;

export const ForumReplyEditSchema = z
  .object({ body: z.string().trim().min(FORUM_REPLY_MIN).max(FORUM_REPLY_MAX) })
  .strict();

/** הסינון של רשימת השרשורים — הכול אופציונלי, הכול מרשימות סגורות. */
export const ForumThreadListSchema = z
  .object({
    topic: ForumTopicSchema.optional(),
    kind: ForumKindSchema.optional(),
    /** רק אנונימיים — הלשונית „שאלות אנונימיות” */
    anonymous: z.enum(["1"]).optional(),
    /** רק שרשורים שאני עוקב/ת אחריהם */
    following: z.enum(["1"]).optional(),
    /** רק שלי — כולל האנונימיים שלי, שרק אני יודע/ת שהם שלי */
    mine: z.enum(["1"]).optional(),
    /** רק שאלות בלי תשובה מקובלת */
    unanswered: z.enum(["1"]).optional(),
    sort: z.enum(["active", "newest", "top"]).default("active"),
    q: z.string().trim().max(FORUM_SEARCH_MAX).optional(),
    cursor: IdSchema.optional(),
  })
  .strict();
export type ForumThreadList = z.infer<typeof ForumThreadListSchema>;

export const ForumListingKindSchema = z.enum(FORUM_LISTING_KINDS);

const httpUrl = z
  .string()
  .trim()
  .max(FORUM_LISTING_URL_MAX)
  .regex(/^https?:\/\/\S+$/u, "כתובת חייבת להתחיל ב-http:// או https://");

/**
 * רשומה במדריך. הקטגוריה נבדקת מול הרשימה של **הסוג** — כלי עם
 * קטגוריה של בעל מקצוע הוא קלט פגום, לא רשומה.
 */
export const ForumListingInputSchema = z
  .object({
    kind: ForumListingKindSchema,
    category: z.string().trim().max(30),
    name: z.string().trim().min(2).max(FORUM_LISTING_NAME_MAX),
    description: z.string().trim().min(10).max(FORUM_LISTING_DESCRIPTION_MAX),
    url: httpUrl.optional(),
    /** טלפון או מייל עסקי — של העסק, לא של אדם פרטי */
    contact: z.string().trim().max(FORUM_LISTING_CONTACT_MAX).optional(),
    /** אזור שירות — „גוש דן”, „הצפון”, „כל הארץ” */
    area: z.string().trim().max(FORUM_LISTING_AREA_MAX).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allowed: readonly string[] =
      value.kind === "pro" ? FORUM_PRO_CATEGORIES : FORUM_TOOL_CATEGORIES;
    if (!allowed.includes(value.category)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "קטגוריה לא מוכרת" });
    }
  });
export type ForumListingInput = z.infer<typeof ForumListingInputSchema>;

export const ForumListingListSchema = z
  .object({
    kind: ForumListingKindSchema,
    category: z.string().trim().max(30).optional(),
    q: z.string().trim().max(FORUM_SEARCH_MAX).optional(),
  })
  .strict();
export type ForumListingList = z.infer<typeof ForumListingListSchema>;

/**
 * דירוג מניסיון אישי — כוכב אחד עד חמישה, ומשפט על החוויה.
 *
 * ## ‏`anonymous` — ההכרעה שהתהפכה, ולמה
 *
 * ‏עד כאן הדירוג היה תמיד בשם, מנימוק שנשאר נכון: חוות דעת היא
 * ‏אמירה על **העסק של מישהו אחר**, והוא זה שנושא את המחיר.
 *
 * ‏אלא שהמחיר של הכלל ההפוך התברר כגבוה יותר: מתווך שעבד עם עורך
 * ‏דין או שמאי שמופיע גם אצל הקולגה ממול פשוט **אינו כותב** את
 * ‏חוות הדעת השלילית. מדריך שיש בו רק חמישה כוכבים אינו מדריך.
 * ‏ההכרעה כאן היא של בעל המוצר, והיא: עילום שם מותר.
 *
 * ‏מה שלא השתנה הוא האחריות. ‏`raterKey` (חותם HMAC) ממשיך לאכוף
 * ‏„דירוג אחד לכל מדרג”, הדיווח והניהול עובדים על הדירוג כרגיל,
 * ‏ובשורה נשמר `rater_ref` מוצפן — בדיוק כמו בשרשור אנונימי, כדי
 * ‏שהפלטפורמה תוכל לטפל בהתעללות בלי שהזהות תיחשף לאיש.
 *
 * ‏ברירת המחדל היא `false`: מי שאינו מבקש עילום שם מדרג בשמו.
 */
export const ForumRatingInputSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().max(FORUM_RATING_COMMENT_MAX).optional(),
    anonymous: z.boolean().default(false),
  })
  .strict();
export type ForumRatingInput = z.infer<typeof ForumRatingInputSchema>;

export const ForumReportInputSchema = z
  .object({
    reason: z.enum(FORUM_REPORT_REASONS),
    note: z.string().trim().max(FORUM_REPORT_NOTE_MAX).optional(),
  })
  .strict();
export type ForumReportInput = z.infer<typeof ForumReportInputSchema>;

/** פעולת ניהול — מנהל הפלטפורמה בלבד. */
export const ForumModerationSchema = z
  .object({
    hidden: z.boolean().optional(),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();
export type ForumModeration = z.infer<typeof ForumModerationSchema>;
