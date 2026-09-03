import { z } from "zod";
import { MENTOR_GOAL_METRICS, MENTOR_GOAL_PERIODS } from "../logic/mentor.js";
import { IdSchema } from "./common.js";

/**
 * יעד של המנטור האישי — מה שהמתווך קובע לעצמו (docs/13 §5).
 *
 * המדד והתקופה נגזרים מהרשימות הסגורות ב-`logic/mentor.ts` ולא
 * נכתבים כאן שוב: יעד קיים רק על מדד שה-API יודע לספור, ורשימה
 * שנייה הייתה מתיישנת בשקט ביום שמוסיפים מדד.
 *
 * הגבול העליון על היעד אינו מגבלת מוצר אלא בלם לטעות הקלדה:
 * „500 עסקאות בשבוע” הוא לא יעד שמישהו התכוון אליו, והמנטור היה
 * מודיע על פיגור בכל שבוע לנצח.
 */
export const MentorGoalMetricSchema = z.enum(MENTOR_GOAL_METRICS);
export const MentorGoalPeriodSchema = z.enum(MENTOR_GOAL_PERIODS);

export const MentorGoalInputSchema = z.object({
  metric: MentorGoalMetricSchema,
  period: MentorGoalPeriodSchema,
  target: z.number().int().min(1).max(200),
  /**
   * ה„למה” של המתווך — „בשביל הדירה”, „להוכיח לעצמי”. עוגן שהמנטור
   * מצטט כשקשה. רשות: יעד בלי „למה” הוא יעד, רק בלי עוגן.
   */
  why: z.string().trim().max(200).optional(),
  /**
   * כוונת יישום — „כל יום ב-11:00 שולח הצעות”. „כש… אז…” מכפיל
   * את סיכוי הביצוע מול יעד ערום (docs/13 §2).
   */
  intention: z.string().trim().max(200).optional(),
});
export type MentorGoalInput = z.infer<typeof MentorGoalInputSchema>;

export const MentorGoalSchema = MentorGoalInputSchema.extend({
  id: IdSchema,
  tenantId: IdSchema,
  /** היעד הוא של המתווך, לא של המשרד — מנהל אינו קובע יעד לסוכן דרך המנטור */
  userId: IdSchema,
  createdAt: z.date(),
  /** יעד שהופסק נשמר להיסטוריה — הסיכומים שכבר נאמרו עליו לא נעלמים */
  endedAt: z.date().nullable(),
});
export type MentorGoal = z.infer<typeof MentorGoalSchema>;
