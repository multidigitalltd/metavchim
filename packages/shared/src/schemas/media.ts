import { z } from "zod";
import {
  MAX_MEDIA_COMMISSION_PERCENT,
  MEDIA_ORDER_BRIEF_MAX,
  MEDIA_ORDER_MAX_QUANTITY,
  MEDIA_OUTLET_KINDS,
  MEDIA_PRODUCT_KINDS,
  MEDIA_SLUG_PATTERN,
} from "../logic/media.js";
import { IdSchema, PhoneInputSchema } from "./common.js";

/** ‏עד מיליון ₪ למוצר — תקרת שפיות, לא תמחור. */
const PRICE_AGOROT_MAX = 100_000_000;

/**
 * הזמנת מוצר מדיה על ידי משרד.
 *
 * פרטי הקשר הם של **מי שמזמין** — האדם שנציג המדיה יחזור אליו.
 * הם מגיעים מהטופס ולא נגזרים מהמשתמש, כי לא תמיד מי שלוחץ הוא
 * מי שינהל את המודעה; ברירת המחדל במסך היא פרטי המשתמש.
 */
export const MediaOrderCreateSchema = z
  .object({
    productId: IdSchema,
    quantity: z.number().int().min(1).max(MEDIA_ORDER_MAX_QUANTITY).default(1),
    /** התדריך — מה לפרסם, איזה נכס, הערות למעצב. */
    brief: z.string().trim().max(MEDIA_ORDER_BRIEF_MAX).default(""),
    contactName: z.string().trim().min(2).max(120),
    contactPhone: PhoneInputSchema,
    contactEmail: z.string().trim().email().max(254),
  })
  .strict();
export type MediaOrderCreate = z.infer<typeof MediaOrderCreateSchema>;

/** ‏ניהול הארכיון במסך הפלטפורמה — מדיה. */
export const MediaOutletUpsertSchema = z
  .object({
    slug: z.string().trim().min(2).max(60).regex(MEDIA_SLUG_PATTERN, "slug באותיות לטיניות קטנות, ספרות ומקפים"),
    name: z.string().trim().min(2).max(120),
    kind: z.enum(MEDIA_OUTLET_KINDS),
    /** שורה אחת מתחת לשם — "המגזין הנפוץ ביותר בציבור החרדי". */
    tagline: z.string().trim().max(200).default(""),
    /** מה המדיה, למי היא מגיעה, מה כלול. */
    description: z.string().trim().max(4000).default(""),
    /** החשיפה — תפוצה, קהל, אזורים. */
    audience: z.string().trim().max(2000).default(""),
    /** מספר אחד שנקרא בעין: "כ-40,000 עותקים בשבוע". */
    reachText: z.string().trim().max(200).default(""),
    /** "שבועי — יוצא ביום חמישי". */
    frequency: z.string().trim().max(120).default(""),
    /** נקודות "מה כלול" — שורה לכל נקודה. */
    highlights: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
    contactName: z.string().trim().max(120).default(""),
    contactEmail: z.union([z.string().trim().email().max(254), z.literal("")]).default(""),
    contactPhone: z.union([PhoneInputSchema, z.literal("")]).default(""),
    commissionPercent: z.number().int().min(0).max(MAX_MEDIA_COMMISSION_PERCENT),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type MediaOutletUpsert = z.infer<typeof MediaOutletUpsertSchema>;

export const MediaOutletPatchSchema = MediaOutletUpsertSchema.partial().strict();
export type MediaOutletPatch = z.infer<typeof MediaOutletPatchSchema>;

/** ‏ניהול הארכיון — מוצר במדיה. */
export const MediaProductUpsertSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).default(""),
    /** "רבע עמוד, צבע מלא, 9×13 ס"מ" */
    specs: z.string().trim().max(200).default(""),
    kind: z.enum(MEDIA_PRODUCT_KINDS),
    /** מחיר ליחידה נטו באגורות. חובה במוצר בתשלום; ריק במוצר הפניה. */
    priceAgorot: z.number().int().min(0).max(PRICE_AGOROT_MAX).nullable().default(null),
    /** מה הנציג משלם לפלטפורמה על הפניה — לרישום, לא לחיוב אוטומטי. */
    leadFeeAgorot: z.number().int().min(0).max(PRICE_AGOROT_MAX).nullable().default(null),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "paid" && (value.priceAgorot === null || value.priceAgorot < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priceAgorot"],
        message: "מוצר בתשלום חייב מחיר",
      });
    }
  });
export type MediaProductUpsert = z.infer<typeof MediaProductUpsertSchema>;

export const MediaProductPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    specs: z.string().trim().max(200).optional(),
    kind: z.enum(MEDIA_PRODUCT_KINDS).optional(),
    priceAgorot: z.number().int().min(0).max(PRICE_AGOROT_MAX).nullable().optional(),
    leadFeeAgorot: z.number().int().min(0).max(PRICE_AGOROT_MAX).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type MediaProductPatch = z.infer<typeof MediaProductPatchSchema>;
