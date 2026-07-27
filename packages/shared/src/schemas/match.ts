import { z } from "zod";
import { IdSchema } from "./common.js";

export const MatchStatusSchema = z.enum(["suggested", "dismissed", "offered"]);

/**
 * פירוט הניקוד לכל קריטריון — הבסיס להסבר ההתאמה למתווך.
 * weight: משקל הקריטריון; score: 0–1; note: הסבר קריא ("חסר ממ\"ד, סומן כעדיפות").
 */
export const ScoreComponentSchema = z.object({
  criterion: z.enum([
    "location",
    "budget",
    "rooms",
    "property_type",
    "area",
    "floor",
    "features_must",
    "features_nice",
    "entry_date",
    "semantic",
  ]),
  weight: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
  note: z.string().max(300).optional(),
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
