/**
 * תמונות נכס — מה משותף למסך ולשרת (docs/03 — property_media).
 *
 * ## ‏למה יש כאן בכלל קוד
 *
 * ‏השיפור עצמו (יישור, אור, חדות, כיווץ) רץ בשרת עם `sharp`, ואין
 * ‏לו מה לחפש בדפדפן. אבל שלושה דברים נאמרים **בשני הצדדים** ולכן
 * ‏חיים כאן: מפתח ההגדרה של הטבעת הלוגו, גבול הגודל שהמסך מציג
 * ‏למתווך, והמלבן לטשטוש — המסך מצייר אותו כשברים של התמונה
 * ‏המוצגת, והשרת הופך אותו לפיקסלים של התמונה האמיתית.
 *
 * ## ‏למה שברים ולא פיקסלים
 *
 * ‏המסך מציג את התמונה מוקטנת, ובכל רוחב חלון אחרת. מלבן בפיקסלים
 * ‏של המסך היה נכון למכשיר אחד. שבר (0.25 = רבע מהרוחב) נכון לכל
 * ‏גודל, והשרת — היחיד שיודע את הגודל האמיתי — מתרגם.
 */

/** ‏מפתח ההגדרה: „הלוגו של המשרד מוטבע על תמונות חדשות”. */
export const PHOTO_LOGO_OVERLAY_KEY = "photoLogoOverlay";

/** ‏חסר = כבוי. הטבעה על תמונות של מוכרים דורשת בחירה מפורשת. */
export function photoLogoOverlayOn(
  settings: Record<string, unknown> | null | undefined,
): boolean {
  return settings?.[PHOTO_LOGO_OVERLAY_KEY] === true;
}

/** ‏הצלע הארוכה המרבית אחרי השיפור — מספיק לכל מסך ולכל לוח מודעות. */
export const PHOTO_MAX_EDGE = 2000;

/** ‏כמה מלבנים אפשר לטשטש בבקשה אחת. */
export const PHOTO_BLUR_MAX_RECTS = 10;

/** ‏מלבן לטשטוש כשברים (0..1) של רוחב וגובה התמונה **המוצגת**. */
export interface PhotoBlurRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ‏תיבה בפיקסלים — מה ש-`extract` של sharp מקבל. */
export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** ‏מלבן קטן מזה בפיקסלים אינו טשטוש אלא נקודה — מדולג. */
const MIN_BOX_PX = 4;

/**
 * ‏השבר ⟵ פיקסלים, גזור לגבולות התמונה.
 *
 * ‎`null` כשלא נשאר מה לטשטש: מלבן שנגרר מחוץ לתמונה, או קטן
 * ‏מארבעה פיקסלים. הקורא מדלג ואינו נופל — מלבן אחד ריק מתוך
 * ‏שלושה אינו סיבה לא לטשטש את השניים האחרים.
 */
export function blurRectToPixels(
  rect: PhotoBlurRect,
  width: number,
  height: number,
): PixelBox | null {
  if (!(width > 0) || !(height > 0)) return null;
  const clamp = (value: number, max: number): number =>
    Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));
  const left = Math.floor(clamp(rect.x * width, width));
  const top = Math.floor(clamp(rect.y * height, height));
  const right = Math.ceil(clamp((rect.x + rect.w) * width, width));
  const bottom = Math.ceil(clamp((rect.y + rect.h) * height, height));
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (boxWidth < MIN_BOX_PX || boxHeight < MIN_BOX_PX) return null;
  return { left, top, width: boxWidth, height: boxHeight };
}

/**
 * ‏גודל אחרי „להיכנס בתוך” הצלע המרבית — בלי להגדיל תמונה קטנה.
 *
 * ‏מחושב **לפני** העיבוד ולא נקרא ממנו, כי הטבעת הלוגו צריכה לדעת
 * ‏את גודל התוצאה כדי לבחור לו פינה — ו-sharp נותן את הגודל רק
 * ‏אחרי שסיים.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
