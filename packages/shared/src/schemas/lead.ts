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
  /*
   * ‎**פרסום לא-מקוון.** ‏עיתון מקומי ומודעה על עמוד חשמל הם עדיין
   * שני הערוצים שמביאים מוכרים בשכונות ותיקות, והם נחתו עד היום
   * תחת „ידני” — כלומר המשרד שילם על מודעה ולא יכול היה לדעת אם
   * היא עבדה. שני ערכים ולא אחד („פרסום”), כי התשובה שמעניינת היא
   * באיזה מהם להמשיך.
   */
  "newspaper",
  "street_ad",
  "manual",
  /*
   * ‎**„אחר”, עם המקום לומר מה.** ‏רשימה סגורה תמיד תפספס משהו —
   * דוכן ביריד, שלט על רכב, קבוצת ווטסאפ שכונתית. עד היום מי שבחר
   * „אחר” איבד את המידע לגמרי; כאן הוא נשמר ב-`sourceNote` והוא מה
   * שמוצג במסך במקום המילה „אחר”.
   */
  "other",
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
  newspaper: "עיתון",
  street_ad: "מודעת רחוב",
  manual: "ידני",
  other: "אחר",
};

/**
 * ‎**מה כתוב על המסך במקום „אחר”.**
 *
 * ‏מקור „אחר” הוא בדיוק כמה שהוא נשמע — לא-ידוע. אם המתווך טרח
 * לרשום „דוכן ביריד הנדל״ן”, זה מה שצריך להופיע: הסיבה היחידה
 * לשאול הייתה לדעת את התשובה.
 *
 * ‏הפונקציה כאן ולא בכל מסך בנפרד, כי יש ארבעה מקומות שמציגים מקור
 * ליד (רשימה, כרטיס, שיתופי פעולה, וכרטיס הסוכן בוואטסאפ) — וארבעה
 * עותקים של אותה החלטה הם ארבע הזדמנויות להיפרד.
 */
export function leadSourceText(source: string, sourceNote?: string | null): string {
  const note = sourceNote?.trim();
  if (source === "other" && note !== undefined && note !== "") return note;
  return LEAD_SOURCE_LABELS[source as LeadSource] ?? source;
}

/** סטטוסים שבהם הליד עדיין "חי" — פנייה נוספת מצטרפת אליו במקום לפצל ציר זמן. */
export const OPEN_LEAD_STATUSES: readonly LeadStatus[] = ["new", "in_progress", "waiting_customer"];

export const LeadSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  contactId: IdSchema,
  source: LeadSourceSchema,
  /** ‏הטקסט החופשי של „אחר”. קצר בכוונה — תווית, לא סיפור. */
  sourceNote: z.string().trim().max(60).optional(),
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
