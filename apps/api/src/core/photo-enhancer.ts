import sharp from "sharp";
import { PHOTO_MAX_EDGE, blurRectToPixels, fitWithin, type PhotoBlurRect } from "@metavchim/shared";

/**
 * ‏שיפור תמונת נכס — פונקציות טהורות מעל `sharp` (docs/03 — property_media).
 *
 * ## ‏מה נעשה לכל תמונה שנכנסת
 *
 * 1. **יישור** לפי EXIF — תמונה מהטלפון מגיעה לא פעם „שוכבת” עם דגל
 *    סיבוב; דפדפנים מכבדים אותו, לוחות מודעות לא תמיד.
 * 2. **כיווץ** לצלע ארוכה של 2000px — מספיק לכל מסך, ועשירית
 *    מהמשקל של צילום 12MP.
 * 3. **אור** — מתיחת ניגודיות עדינה (אחוזון 1–99, לא הקצוות, כדי
 *    שפיקסל שרוף אחד לא יכתיב את הכול) ומעט בהירות ורוויה.
 * 4. **חדות** קלה, אחרי הכיווץ ולא לפניו.
 * 5. **WebP** באיכות 82 — רבע מהמשקל של JPEG באותה איכות נראית.
 * 6. **בלי מטא-דאטה.** `sharp` משמיט EXIF כברירת מחדל, ובכוונה
 *    לא מבקשים לשמור אותו: צילום מהטלפון נושא **מיקום GPS** של
 *    הדירה, ותמונה שיוצאת ללוח מודעות עם הקואורדינטות שלה מסגירה
 *    כתובת שהמתווך הסתיר במכוון.
 *
 * ## ‏למה אין „מקור”
 *
 * ‏עותק מקור לכל תמונה היה מכפיל את האחסון של כל משרד לכל החיים,
 * ‏בשביל ביטול שאיש לא מבקש (החלטת בעל המערכת). מה שנשמר הוא
 * ‏התוצאה, וטשטוש הוא לכן **בלתי הפיך** — המסך אומר זאת.
 *
 * ## ‏למה הגודל מחושב מראש
 *
 * ‏הטבעת הלוגו צריכה פינה, ופינה דורשת לדעת את גודל התוצאה —
 * ‏ו-`sharp` מוסר אותו רק בסוף. במקום שני מעברים (עיבוד, קריאת
 * ‏גודל, הטבעה, קידוד שוב) הגודל מחושב מה-metadata ומהכלל של
 * ‎`fitWithin`, ויש מעבר אחד.
 */

export const PHOTO_MIME = "image/webp";
export const PHOTO_EXT = "webp";
const WEBP_QUALITY = 82;
/** ‏60MP — מעל כל טלפון; תמונה גדולה מזה היא ניסיון להפיל את השרת. */
const MAX_INPUT_PIXELS = 60_000_000;
/** ‏הלוגו: עד 16% מהרוחב ומהגובה, במרחק 2.5% מהפינה. */
const LOGO_FRACTION = 0.16;
const LOGO_PAD_FRACTION = 0.025;

/** ‏קובץ שעבר את בדיקת ה-Magic Bytes ובכל זאת אינו תמונה שאפשר לפענח. */
export class UnreadablePhotoError extends Error {
  constructor() {
    super("התמונה פגומה ולא ניתן לעבד אותה");
    this.name = "UnreadablePhotoError";
  }
}

function decoder(input: Buffer): sharp.Sharp {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
}

/** ‏הגודל **אחרי** היישור — סיבוב של 90° מחליף רוחב וגובה. */
async function orientedSize(input: Buffer): Promise<{ width: number; height: number }> {
  let meta: sharp.Metadata;
  try {
    meta = await decoder(input).metadata();
  } catch {
    throw new UnreadablePhotoError();
  }
  if (meta.width === undefined || meta.height === undefined || meta.width === 0 || meta.height === 0) {
    throw new UnreadablePhotoError();
  }
  const swapped = (meta.orientation ?? 1) >= 5;
  return swapped ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

async function logoOverlay(
  logo: Buffer,
  canvas: { width: number; height: number },
): Promise<sharp.OverlayOptions | null> {
  const maxWidth = Math.floor(canvas.width * LOGO_FRACTION);
  const maxHeight = Math.floor(canvas.height * LOGO_FRACTION);
  if (maxWidth < 8 || maxHeight < 8) return null;
  let resized: { data: Buffer; info: sharp.OutputInfo };
  try {
    resized = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: maxWidth, height: maxHeight, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
  } catch {
    /* ‏לוגו פגום אינו סיבה לדחות תמונת נכס — התמונה נשמרת בלעדיו */
    return null;
  }
  const pad = Math.max(8, Math.round(canvas.width * LOGO_PAD_FRACTION));
  return {
    input: resized.data,
    left: Math.max(0, canvas.width - resized.info.width - pad),
    top: Math.max(0, canvas.height - resized.info.height - pad),
  };
}

export interface EnhancedPhoto {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * ‏התמונה כפי שתישמר: מיושרת, מכווצת, מוארת, חדה, WebP, בלי EXIF —
 * ‏ועם הלוגו בפינה כשהמשרד ביקש.
 */
export async function enhancePhoto(
  input: Buffer,
  options: { logo?: Buffer | null } = {},
): Promise<EnhancedPhoto> {
  const size = await orientedSize(input);
  const out = fitWithin(size.width, size.height);
  /*
   * ‏הכיווץ נמסר ל-sharp כגבול על הצלע הארוכה ולא כגודל המחושב:
   * ‏גודל שעוגל (1333×2000) היה מכתיב יחס שונה במעט מהמקור, ו-sharp
   * ‏היה מכווץ לפי הצלע ה„קצרה” של הגבול ומחזיר 1333×1999. הגודל
   * ‏המחושב משמש לפינת הלוגו בלבד, ושם סטייה של פיקסל אינה נראית.
   */
  let pipeline = decoder(input)
    .rotate()
    .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .normalise({ lower: 1, upper: 99 })
    .modulate({ brightness: 1.03, saturation: 1.06 })
    .sharpen({ sigma: 0.8 });
  if (options.logo) {
    const overlay = await logoOverlay(options.logo, out);
    if (overlay !== null) pipeline = pipeline.composite([overlay]);
  }
  try {
    const { data, info } = await pipeline
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new UnreadablePhotoError();
  }
}

/**
 * ‏טשטוש מלבנים — פנים, לוחית רישוי, תמונה משפחתית על הקיר.
 *
 * ‏כל מלבן נחתך מהתמונה **המיושרת**, מטושטש בעוצמה יחסית לגודלו
 * ‏(מלבן קטן עם סיגמה גדולה הוא כתם אחיד; מלבן גדול עם סיגמה
 * ‏קטנה עדיין קריא), ומולבש חזרה במקומו. התוצאה נשמרת כ-WebP
 * ‏כמו כל תמונה משופרת, גם כשהמקור היה JPEG ישן שטרם שופר.
 */
export async function blurPhotoRegions(
  input: Buffer,
  rects: readonly PhotoBlurRect[],
): Promise<EnhancedPhoto> {
  const size = await orientedSize(input);
  const boxes = rects
    .map((rect) => blurRectToPixels(rect, size.width, size.height))
    .filter((box): box is NonNullable<typeof box> => box !== null);
  try {
    const overlays: sharp.OverlayOptions[] = [];
    for (const box of boxes) {
      const sigma = Math.min(200, Math.max(6, Math.round(Math.min(box.width, box.height) / 6)));
      const patch = await decoder(input).rotate().extract(box).blur(sigma).png().toBuffer();
      overlays.push({ input: patch, left: box.left, top: box.top });
    }
    let pipeline = decoder(input).rotate();
    if (overlays.length > 0) pipeline = pipeline.composite(overlays);
    const { data, info } = await pipeline
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    throw new UnreadablePhotoError();
  }
}
