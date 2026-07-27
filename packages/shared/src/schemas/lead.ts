import { z } from "zod";
import { IdSchema } from "./common.js";

export const LeadSourceSchema = z.enum([
  "voice_call",
  "whatsapp",
  "web_form",
  "kanko",
  "referral",
  "manual",
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadIntentSchema = z.enum(["buy", "sell", "rent_in", "rent_out", "info", "unknown"]);

export const LeadStatusSchema = z.enum([
  "new",
  "in_progress",
  "waiting_customer",
  "converted",
  "closed",
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

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
