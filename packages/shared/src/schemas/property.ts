import { z } from "zod";
import { IdSchema, MoneyAgorotSchema } from "./common.js";

export const PropertyTypeSchema = z.enum([
  "apartment",
  "garden_apartment",
  "penthouse",
  "duplex",
  "private_house",
  "two_family",
  "studio",
  "unit",
  "plot",
  "commercial",
  "other",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PropertyStatusSchema = z.enum([
  "draft",
  "active",
  "on_hold",
  "sold",
  "rented",
  "archived",
]);
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

export const DealTypeSchema = z.enum(["sale", "rent"]);

/** השדות שמנוע החילוץ מהקול מנסה לזהות; הכל אופציונלי — החוסרים מסומנים למתווך. */
export const PropertyFieldsSchema = z.object({
  city: z.string().min(1).max(80).optional(),
  neighborhood: z.string().max(80).optional(),
  street: z.string().max(120).optional(),
  houseNumber: z.string().max(10).optional(),
  propertyType: PropertyTypeSchema.optional(),
  dealType: DealTypeSchema.optional(),
  rooms: z.number().multipleOf(0.5).min(1).max(20).optional(),
  areaSqm: z.number().int().min(10).max(2000).optional(),
  floor: z.number().int().min(-2).max(60).optional(),
  totalFloors: z.number().int().min(1).max(60).optional(),
  hasElevator: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  hasBalcony: z.boolean().optional(),
  hasSafeRoom: z.boolean().optional(),
  hasStorage: z.boolean().optional(),
  condition: z.enum(["new", "renovated", "good", "needs_renovation"]).optional(),
  priceAgorot: MoneyAgorotSchema.optional(),
  priceFlexible: z.boolean().optional(),
  entryDate: z.coerce.date().optional(),
  exclusive: z.boolean().optional(),
  exclusiveUntil: z.coerce.date().optional(),
});
export type PropertyFields = z.infer<typeof PropertyFieldsSchema>;

export const PropertySchema = PropertyFieldsSchema.extend({
  id: IdSchema,
  tenantId: IdSchema,
  status: PropertyStatusSchema,
  ownerContactId: IdSchema.optional(),
  marketingTitle: z.string().max(160).optional(),
  marketingDescription: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
  /** מאפיינים נדירים/עתידיים — לא נכנסים כעמודות עד שיש להם שימוש בהתאמות. */
  attributes: z.record(z.string(), z.unknown()).default({}),
  readinessScore: z.number().int().min(0).max(100),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Property = z.infer<typeof PropertySchema>;

/** השדות שבלעדיהם נכס לא נחשב "מוכן לשיווק" — הבסיס לציון המוכנות. */
export const PROPERTY_REQUIRED_FOR_MARKETING = [
  "city",
  "propertyType",
  "dealType",
  "rooms",
  "areaSqm",
  "priceAgorot",
  "floor",
  "hasElevator",
  "hasParking",
  "entryDate",
] as const satisfies readonly (keyof PropertyFields)[];
