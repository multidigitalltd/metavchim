import { z } from "zod";
import { IdSchema } from "./common.js";

export const OfferChannelSchema = z.enum(["whatsapp", "sms", "email"]);

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
