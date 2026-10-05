import * as z from "../zod.js";
import { OFFER_STATUSES } from "../logic/offer-status.js";


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
  /** מפתחות תמונות הנכס בזמן היצירה — נחתמים ל-URL בכל צפייה ציבורית */
  media: z.array(z.object({ key: z.string(), alt: z.string().optional() })).default([]),
});
export type OfferPresentation = z.infer<typeof OfferPresentationSchema>;

/**
 * ‎**נגזר מ-`OFFER_STATUSES` ולא כתוב כאן שוב.**
 *
 * הרשימה שהייתה כאן מנתה `expired` ו-`failed` — שני מצבים שהקוד
 * **אינו כותב לעולם** — והחסירה את `pending_email` ואת `email_failed`,
 * שהוא כן כותב. כלומר הצהרה שהתיישנה בשקט מול העמודה שהיא מתארת,
 * ולצידה עוד שתי רשימות שנכתבו בנפרד: הסינון בבקר וקבוצות הסוכן.
 * שלוש רשימות, שלוש טעויות שונות.
 */
export const OfferStatusSchema = z.enum(OFFER_STATUSES);

