import { z } from "zod";
import { BID_DECISIONS, BID_NOTE_MAX, BID_SIDES } from "../logic/property-bids.js";
import { IdSchema } from "./common.js";

/** ‏צעד חדש במו״מ — מי, מאיזה צד, כמה. */
export const PropertyBidCreateSchema = z
  .object({
    buyerId: IdSchema,
    side: z.enum(BID_SIDES),
    /** ‏באגורות, שלם וחיובי — עד עשרה מיליארד ₪ */
    amountAgorot: z.number().int().positive().max(1_000_000_000_000),
    note: z.string().trim().max(BID_NOTE_MAX).optional(),
  })
  .strict();
export type PropertyBidCreate = z.infer<typeof PropertyBidCreateSchema>;

/** ‏הכרעה על ההצעה הפתוחה. */
export const PropertyBidDecisionSchema = z.object({ status: z.enum(BID_DECISIONS) }).strict();
export type PropertyBidDecision = z.infer<typeof PropertyBidDecisionSchema>;
