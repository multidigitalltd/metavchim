import { z } from "zod";
import { IdSchema } from "./common.js";

export const OfferChannelSchema = z.enum(["link", "whatsapp", "sms", "email"]);

/**
 * תצוגת הנכס כפי שנשלחה לקונה — Snapshot שנשמר בהצעה עצמה:
 * ההצעה לא משתנה אם הנכס נערך אחר כך, ואין בה PII או הערות פנימיות.
 */
export const OfferPresentationSchema = z.object({
  title: z.string().max(160),
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  rooms: z.number().optional(),
  areaSqm: z.number().optional(),
  floor: z.number().optional(),
  priceAgorot: z.number().optional(),
  features: z.array(z.string()).default([]),
  description: z.string().max(4000).optional(),
  agencyName: z.string().max(120),
});
export type OfferPresentation = z.infer<typeof OfferPresentationSchema>;

export const OfferStatusSchema = z.enum([
  "pending_approval",
  "sent",
  "delivered",
  "opened",
  "interested",
  "declined",
  "expired",
  "failed",
]);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

export const OfferSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  matchId: IdSchema,
  channel: OfferChannelSchema,
  /** הנוסח שנשלח בפועל — נשמר כראיה גם אם התבנית השתנתה מאז. */
  sentText: z.string().max(2000).optional(),
  status: OfferStatusSchema,
  openCount: z.number().int().nonnegative().default(0),
  sentAt: z.coerce.date().optional(),
  firstOpenedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});
export type Offer = z.infer<typeof OfferSchema>;
