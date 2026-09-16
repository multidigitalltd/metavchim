import { z } from "zod";
import { IdSchema } from "./common.js";
import { COMPARISON_MAX_PROPERTIES, COMPARISON_MIN_PROPERTIES } from "../logic/comparison.js";

export const ComparisonCreateSchema = z.object({
  propertyIds: z
    .array(IdSchema)
    .min(COMPARISON_MIN_PROPERTIES)
    .max(COMPARISON_MAX_PROPERTIES)
    .refine((ids) => new Set(ids).size === ids.length, { message: "אותו נכס פעמיים" }),
});
export type ComparisonCreate = z.infer<typeof ComparisonCreateSchema>;

/** ‏תמונת המצב שנשמרת בדף — בלי פרטי הקונה. */
export const ComparisonPropertySchema = z.object({
  propertyId: IdSchema,
  title: z.string().max(160),
  city: z.string().optional(),
  neighborhood: z.string().optional(),
  propertyType: z.string().optional(),
  rooms: z.number().optional(),
  areaSqm: z.number().optional(),
  floor: z.number().optional(),
  totalFloors: z.number().optional(),
  priceAgorot: z.number().optional(),
  features: z.array(z.string()).default([]),
  media: z.array(z.object({ key: z.string(), alt: z.string().optional() })).default([]),
});

export const ComparisonPresentationSchema = z.object({
  agencyName: z.string().max(120),
  properties: z.array(ComparisonPropertySchema).min(COMPARISON_MIN_PROPERTIES).max(COMPARISON_MAX_PROPERTIES),
  wants: z.object({
    budgetMaxAgorot: z.number().optional(),
    roomsMin: z.number().optional(),
    roomsMax: z.number().optional(),
    cities: z.array(z.string()).default([]),
  }),
});
export type ComparisonPresentation = z.infer<typeof ComparisonPresentationSchema>;

export const ComparisonInterestSchema = z.object({ propertyId: IdSchema });
