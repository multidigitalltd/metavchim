import { z } from "zod";
import {
  PROPERTY_CHECK_KEYS,
  PROPERTY_CHECK_NOTE_MAX,
  PROPERTY_CHECK_STATUSES,
} from "../logic/property-checks.js";

/** מפתח בדיקה — מהרשימה הסגורה בלבד. */
export const PropertyCheckKeySchema = z.enum(PROPERTY_CHECK_KEYS);

/** עדכון מצב של בדיקה אחת. הערה ריקה = מחיקת ההערה. */
export const PropertyCheckUpdateSchema = z
  .object({
    status: z.enum(PROPERTY_CHECK_STATUSES),
    note: z.string().trim().max(PROPERTY_CHECK_NOTE_MAX).optional(),
  })
  .strict();
export type PropertyCheckUpdate = z.infer<typeof PropertyCheckUpdateSchema>;
