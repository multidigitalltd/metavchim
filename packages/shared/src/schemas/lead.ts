import { z } from "zod";
import { IdSchema } from "./common.js";

export const LeadSourceSchema = z.enum([
  "voice_call",
  "whatsapp",
  "web_form",
  /*
   * פנייה מדף נחיתה של נכס. `LandingService` כותבת אותה כבר היום
   * (`ingestForTenant(..., "landing")`), והיא נעדרה מהרשימה — כלומר
   * הסכימה תיארה פחות ממה שהמערכת שומרת בפועל, והתווית שלה ירדה
   * עם הרשימה (ביקורת Codex).
   */
  "landing",
  "kanko",
  "referral",
  "manual",
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadIntentSchema = z.enum(["buy", "sell", "rent_in", "rent_out", "info", "unknown"]);
export type LeadIntent = z.infer<typeof LeadIntentSchema>;

export const LeadStatusSchema = z.enum([
  "new",
  "in_progress",
  "waiting_customer",
  "converted",
  "closed",
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

/*
 * תוויות עברית לשלושת הערכים הסגורים של הליד — מקור אמת אחד למסכים
 * ולטקסטים שהשרת כותב.
 *
 * הטיפוס הוא `Record<LeadStatus, string>` ולא `Record<string, string>`
 * בכוונה: ערך שנוסף לסכימה ולא לטבלה שובר את הבנייה. טבלה מקומית
 * שנכתבה ביד היא בדיוק מה שהציג `very_hot` גולמי למתווך, ובאותה
 * פונקציה גם `in_progress` ו-`rent_in` (ביקורת Codex).
 */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "חדש",
  in_progress: "בטיפול",
  waiting_customer: "ממתין ללקוח",
  converted: "הומר",
  closed: "סגור",
};

export const LEAD_INTENT_LABELS: Record<LeadIntent, string> = {
  buy: "קונה",
  sell: "מוכר",
  rent_in: "שוכר",
  rent_out: "משכיר",
  info: "מתעניין",
  unknown: "לא ידוע",
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  voice_call: "שיחה",
  whatsapp: "וואטסאפ",
  web_form: "אתר",
  landing: "דף נחיתה",
  kanko: "Kanko",
  referral: "המלצה",
  manual: "ידני",
};

/** סטטוסים שבהם הליד עדיין "חי" — פנייה נוספת מצטרפת אליו במקום לפצל ציר זמן. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["new", "in_progress", "waiting_customer"];

export const LeadSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  contactId: IdSchema,
  source: LeadSourceSchema,
  intent: LeadIntentSchema,
  status: LeadStatusSchema,
  assignedToUserId: IdSchema.optional(),
  /** ליד שהסוכן הקולי/הבוט סימן כרגיש — חובת מגע אנושי, מוצג באדום בדשבורד. */
  requiresHuman: z.boolean().default(false),
  requiresHumanReason: z.string().max(500).optional(),
  propertyId: IdSchema.optional(),
  summary: z.string().max(2000).optional(),
  firstResponseAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Lead = z.infer<typeof LeadSchema>;
