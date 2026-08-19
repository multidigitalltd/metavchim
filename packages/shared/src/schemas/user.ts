import { z } from "zod";
import { IdSchema, PhoneSchema } from "./common.js";

/**
 * תפקידי המשתמשים במשרד, מהסמכות הרחבה לצרה.
 *
 * `branch_manager` — מנהל סניף — יושב בין `admin` ל-`agent`: הוא
 * רואה את כל הלקוחות והלידים, מטיל משימות וקורא את דוח הביצועים,
 * ואינו נוגע בהגדרות המשרד, בחיוב, בהרשאות המשתמשים וביומן
 * הביקורת. אלה נשארים אצל בעל המשרד.
 */
export const UserRoleSchema = z.enum([
  "owner",
  "admin",
  "branch_manager",
  "agent",
  "assistant",
  "viewer",
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * השם בעברית של כל תפקיד — מקור אחד לכל המסכים.
 *
 * שלושה מסכים החזיקו כל אחד עותק משלו, וכל אחד מהם היה רשימה
 * חלקית אחרת. תפקיד חדש היה מופיע באחד מהם כקוד גולמי
 * (`branch_manager`) ובאחר בכלל לא היה ניתן לבחירה.
 */
export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "בעלים",
  admin: "מנהל",
  branch_manager: "מנהל סניף",
  agent: "סוכן",
  assistant: "עוזר",
  viewer: "צפייה בלבד",
};

/**
 * השם בעברית של תפקיד שהגיע כמחרוזת מהשרת.
 *
 * נופל בחזרה לקוד הגולמי ולא לטקסט קבוע: תפקיד שאיננו מכירים הוא
 * באג, ו„משתמש” גנרי היה מסתיר אותו במקום להראות אותו.
 */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

/**
 * התפקידים שאפשר להעניק למשתמש אחר.
 *
 * `owner` אינו ברשימה: הוא נקבע בהקמת המשרד, ומסך שמציע אותו
 * כאפשרות בתפריט הופך העברת בעלות לבחירה בשוגג מרשימה נפתחת.
 *
 * הסכימה היא המקור, והרשימה נגזרת ממנה: השרת אימת את הקלט מול
 * `exclude(["owner"])` בעוד המסכים החזיקו רשימה כתובה ביד, ולכן
 * תפקיד חדש היה מתקבל בשרת ולא מופיע בשום תפריט.
 */
export const AssignableRoleSchema = UserRoleSchema.exclude(["owner"]);
export const ASSIGNABLE_ROLES: readonly UserRole[] = AssignableRoleSchema.options;

export const UserSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: PhoneSchema.optional(),
  role: UserRoleSchema,
  isActive: z.boolean().default(true),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;
