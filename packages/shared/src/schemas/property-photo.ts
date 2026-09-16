import { z } from "zod";
import { PHOTO_BLUR_MAX_RECTS } from "../logic/property-photo.js";

/** ‏שבר של התמונה — 0 עד 1. */
const Fraction = z.number().min(0).max(1);

/** ‏מלבן אחד לטשטוש. רוחב וגובה חיוביים — מלבן ריק אינו בקשה. */
export const PhotoBlurRectSchema = z
  .object({ x: Fraction, y: Fraction, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .strict();

/** ‏בקשת טשטוש: מלבן אחד לפחות, עד עשרה. */
export const PhotoBlurSchema = z
  .object({ rects: z.array(PhotoBlurRectSchema).min(1).max(PHOTO_BLUR_MAX_RECTS) })
  .strict();

export type PhotoBlurRequest = z.infer<typeof PhotoBlurSchema>;
