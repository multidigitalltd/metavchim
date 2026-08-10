import { z } from "zod";
import { IdSchema, MoneyAgorotSchema } from "./common.js";
import { PropertyTypeSchema, DealTypeSchema } from "./property.js";

export const BuyerMaturitySchema = z.enum(["very_hot", "hot", "interested", "not_ripe"]);
export type BuyerMaturity = z.infer<typeof BuyerMaturitySchema>;

/** תוויות עברית לבשלות — מקור אמת אחד ל-UI ולטקסטים שהשרת כותב (ציר, ייצוא). */
export const MATURITY_LABELS: Record<string, string> = {
  very_hot: "חם מאוד",
  hot: "חם",
  interested: "מתעניין",
  not_ripe: "לא בשל",
};

export const FinancingStatusSchema = z.enum([
  "cash",
  "pre_approved",
  "in_process",
  "not_started",
  "unknown",
]);

/** דרישה בודדת של קונה: חובה או עדיפות — ההבחנה מזינה ישירות את מנוע ההתאמות. */
export const RequirementLevelSchema = z.enum(["must", "nice"]);

export const BuyerRequirementsSchema = z.object({
  /*
   * ריק = בלי מגבלת אזור, וזה ערך תקין: ייבוא מגיליון בלי עמודת עיר
   * לא אמור להידחות, וקונה "כל הארץ" הוא לקוח אמיתי. ההתאמות
   * מדלגות על קריטריון המיקום כשהרשימה ריקה — חוסר מידע אינו
   * אי-התאמה, כפי שכבר נכון לשאר השדות.
   */
  cities: z.array(z.string().min(1)).default([]),
  neighborhoods: z.array(z.string()).default([]),
  dealType: DealTypeSchema,
  propertyTypes: z.array(PropertyTypeSchema).default([]),
  budgetMinAgorot: MoneyAgorotSchema.optional(),
  budgetMaxAgorot: MoneyAgorotSchema,
  roomsMin: z.number().multipleOf(0.5).optional(),
  roomsMax: z.number().multipleOf(0.5).optional(),
  areaSqmMin: z.number().int().optional(),
  /** מאפיין → רמת דרישה. למשל: { hasElevator: "must", hasSafeRoom: "nice" } */
  features: z
    .record(
      z.enum(["hasElevator", "hasParking", "hasBalcony", "hasSafeRoom", "hasStorage"]),
      RequirementLevelSchema,
    )
    .default({}),
  entryBy: z.coerce.date().optional(),
  flexibilityNotes: z.string().max(1000).optional(),
});
export type BuyerRequirements = z.infer<typeof BuyerRequirementsSchema>;

export const BuyerSchema = z.object({
  id: IdSchema,
  tenantId: IdSchema,
  contactId: IdSchema,
  requirements: BuyerRequirementsSchema,
  financing: FinancingStatusSchema.default("unknown"),
  maturity: BuyerMaturitySchema,
  /** דריסה ידנית של המתווך גוברת על החישוב האוטומטי. */
  maturityOverridden: z.boolean().default(false),
  source: z.string().max(60),
  aiNotes: z.string().max(4000).optional(),
  agentNotes: z.string().max(4000).optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Buyer = z.infer<typeof BuyerSchema>;
