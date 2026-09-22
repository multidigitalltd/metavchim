/**
 * רכש מדיה — ארכיון של מדיות (מגזין, לוח, שילוט…) שבכל אחת מהן
 * מוצרים לרכישה: מודעה ברבע עמוד, עמוד שער, באנר.
 *
 * ## שני סוגי מוצר, ושני מסלולי הזמנה
 *
 * - **בתשלום** (`paid`) — המשרד משלם בכרטיס דרך הסליקה של המערכת,
 *   וההזמנה נשלחת לאיש הקשר של המדיה רק אחרי שהתשלום אושר.
 *   הפלטפורמה גובה מהסכום עמלת תיווך באחוזים.
 * - **הפניה** (`lead`) — אין סליקה. ההזמנה נשלחת לנציג המדיה כפנייה,
 *   הוא סוגר את העסקה מול המשרד ישירות, ומשלם לפלטפורמה על ההפניה
 *   עצמה. ההפניה נשלחת מיד, בלי לעבור בדף תשלום.
 *
 * ## למה החישוב כאן ולא בשרת בלבד
 *
 * המסך מציג למשרד את הסכום לפני שהוא מאשר, והשרת רושם אותו על
 * ההזמנה. שני המספרים חייבים להיות אותו מספר, ולכן שניהם נגזרים
 * מפונקציה אחת — אותו לקח כמו בעמלת ההפניות (`referralPayout`).
 */

/** סוגי המדיה שבארכיון. רשימה סגורה — מסוננת ב-`z.enum`. */
export const MEDIA_OUTLET_KINDS = [
  "magazine",
  "newspaper",
  "digital",
  "billboard",
  "radio",
  "other",
] as const;
export type MediaOutletKind = (typeof MEDIA_OUTLET_KINDS)[number];

export const MEDIA_OUTLET_KIND_LABEL: Record<MediaOutletKind, string> = {
  magazine: "מגזין",
  newspaper: "עיתון",
  digital: "דיגיטל",
  billboard: "שילוט",
  radio: "רדיו",
  other: "אחר",
};

/** ‏`paid` = סליקה במערכת; `lead` = הפניה לנציג בלי תשלום. */
export const MEDIA_PRODUCT_KINDS = ["paid", "lead"] as const;
export type MediaProductKind = (typeof MEDIA_PRODUCT_KINDS)[number];

export const MEDIA_PRODUCT_KIND_LABEL: Record<MediaProductKind, string> = {
  paid: "הזמנה ותשלום במערכת",
  lead: "פנייה לנציג",
};

/**
 * מצבי הזמנה.
 *
 * - `pending_payment` — נפתח דף תשלום וטרם אושר.
 * - `paid` — התשלום אושר וההזמנה נשלחה למדיה.
 * - `referred` — הפניה שנשלחה לנציג (מוצר בלי סליקה).
 * - `failed` — התשלום נכשל; ההזמנה לא נשלחה.
 * - `cancelled` — בוטלה לפני תשלום.
 */
export const MEDIA_ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "referred",
  "failed",
  "cancelled",
] as const;
export type MediaOrderStatus = (typeof MEDIA_ORDER_STATUSES)[number];

export const MEDIA_ORDER_STATUS_LABEL: Record<MediaOrderStatus, string> = {
  pending_payment: "ממתין לתשלום",
  paid: "שולם ונשלח למדיה",
  referred: "נשלח לנציג",
  failed: "התשלום נכשל",
  cancelled: "בוטל",
};

/** ברירת המחדל לעמלת התיווך של הפלטפורמה על הזמנת מדיה, באחוזים. */
export const DEFAULT_MEDIA_COMMISSION_PERCENT = 10;

/** תקרת שפיות — מעבר לזה המוצר מפסיק להיות כדאי למדיה. */
export const MAX_MEDIA_COMMISSION_PERCENT = 50;

/** כמה יחידות אפשר להזמין בהזמנה אחת (מודעות באותו גיליון, למשל). */
export const MEDIA_ORDER_MAX_QUANTITY = 20;

/** אורך התדריך/הערות שהמשרד מצרף להזמנה. */
export const MEDIA_ORDER_BRIEF_MAX = 2000;

/**
 * אחוז העמלה כפי שנשמר על המדיה, עם נפילה לברירת המחדל.
 *
 * ריק אינו אפס: מדיה שנוצרה בלי אחוז מקבלת את ברירת המחדל של
 * המערכת, ואפס הוא החלטה שמקלידים במפורש.
 */
export function resolveMediaCommissionPercent(stored: unknown): number {
  if (stored === null || stored === undefined) return DEFAULT_MEDIA_COMMISSION_PERCENT;
  if (typeof stored === "string" && stored.trim() === "") return DEFAULT_MEDIA_COMMISSION_PERCENT;
  const value = typeof stored === "string" ? Number(stored.trim()) : Number(stored);
  if (!Number.isFinite(value)) return DEFAULT_MEDIA_COMMISSION_PERCENT;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > MAX_MEDIA_COMMISSION_PERCENT) {
    return DEFAULT_MEDIA_COMMISSION_PERCENT;
  }
  return rounded;
}

/** פירוק הזמנה בתשלום לשלושת המספרים שהמסך והשרת מציגים. */
export interface MediaOrderTotals {
  /** מחיר ליחידה, נטו, באגורות — צילום מהמוצר ברגע ההזמנה. */
  unitPriceAgorot: number;
  quantity: number;
  /** הסכום נטו שהמשרד משלם (לפני מע"מ). */
  amountAgorot: number;
  commissionPercent: number;
  /** מה שנשאר בפלטפורמה מתוך הסכום — עמלת התיווך. */
  commissionAgorot: number;
  /** מה שמגיע למדיה אחרי העמלה. */
  outletAgorot: number;
}

/**
 * החישוב המלא — **מקור אמת אחד** למסך ולשרת.
 *
 * העמלה מעוגלת **כלפי מטה** ולעולם אינה עולה על הסכום: אותו כלל
 * כמו בעמלת ההפניות, ומאותה סיבה — המסך והשרת הראו פעם שני מספרים
 * שונים על אותה עסקה כשאחד עיגל והשני חתך.
 */
export function mediaOrderTotals(input: {
  unitPriceAgorot: number;
  quantity: number;
  commissionPercent: number;
}): MediaOrderTotals {
  const quantity = Math.max(1, Math.min(MEDIA_ORDER_MAX_QUANTITY, Math.floor(input.quantity)));
  const unitPriceAgorot = Math.max(0, Math.floor(input.unitPriceAgorot));
  const amountAgorot = unitPriceAgorot * quantity;
  const commissionPercent = resolveMediaCommissionPercent(input.commissionPercent);
  const raw = Math.floor((amountAgorot * commissionPercent) / 100);
  const commissionAgorot = Math.max(0, Math.min(raw, amountAgorot));
  return {
    unitPriceAgorot,
    quantity,
    amountAgorot,
    commissionPercent,
    commissionAgorot,
    outletAgorot: amountAgorot - commissionAgorot,
  };
}

/**
 * ‏slug של מדיה — מה שמופיע בכתובת `/media/<slug>`.
 *
 * אותיות לטיניות קטנות, ספרות ומקפים בלבד: הכתובת נשלחת בוואטסאפ
 * ובמייל, ו-slug עם תווים מיוחדים נשבר בהעתקה.
 */
export const MEDIA_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isMediaSlug(value: string): boolean {
  return value.length >= 2 && value.length <= 60 && MEDIA_SLUG_PATTERN.test(value);
}
