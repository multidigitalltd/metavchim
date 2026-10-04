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
 *
 * ‏**הפרסום אינו מצב.** „פורסם” נרשם ב-`publishedAt` לצד המצב, ולא
 * ‏במקומו: הזמנה ששולמה נשארת `paid` גם אחרי שהגיליון יצא, כי ההתחשבנות
 * ‏(ההעברה למדיה, סיכומי העמלות) נשענת על המצב הכספי ואסור שסימון
 * ‏תפעולי יוציא אותה ממנו (ביקורת Codex). למסך יש `mediaOrderStage`.
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

/**
 * ‏השלב שהמסך מציג: המצב הכספי, או „פורסם” כשבעל הפלטפורמה סימן.
 * ‏`published` חי רק כאן — בבסיס הנתונים הוא `publishedAt`.
 */
export type MediaOrderStage = MediaOrderStatus | "published";

export const MEDIA_ORDER_STAGE_LABEL: Record<MediaOrderStage, string> = {
  ...MEDIA_ORDER_STATUS_LABEL,
  published: "פורסם",
};

export function mediaOrderStage(status: MediaOrderStatus, publishedAt: Date | string | null): MediaOrderStage {
  return publishedAt !== null ? "published" : status;
}

/** ‏הזמנה שכבר אצל המדיה וטרם סומנה — זו שאפשר לסמן כפורסמה. */
export function mediaOrderCanPublish(status: MediaOrderStatus, publishedAt: Date | string | null): boolean {
  return (status === "paid" || status === "referred") && publishedAt === null;
}

/* ==================== קובץ המודעה ==================== */

/**
 * ‏קובץ המודעה — מה שהמעצב של המגזין מקבל לדפוס.
 *
 * ‏שלושה סוגים בלבד, וכולם מזוהים לפי ה-Magic Bytes ולא לפי השם:
 * ‏JPEG ו-PNG לתמונה מוכנה, PDF למודעה מעוצבת. הקובץ נשמר **כפי שהוא**
 * ‏— בלי כיווץ ובלי WebP כמו תמונות הנכסים — כי לדפוס צריך את המקור.
 */
export const MEDIA_CREATIVE_MAX_BYTES = 25 * 1024 * 1024;
export const MEDIA_CREATIVE_MIMES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type MediaCreativeMime = (typeof MEDIA_CREATIVE_MIMES)[number];
export const MEDIA_CREATIVE_EXT: Record<MediaCreativeMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};
/** ‏הערת הפרסום של בעל הפלטפורמה — „גיליון 412, עמ׳ 7”. */
export const MEDIA_PUBLISHED_NOTE_MAX = 300;

/** ‏סוג הקובץ לפי הבייטים הראשונים; `null` = לא אחד משלושת הסוגים. */
export function mediaCreativeMime(bytes: Uint8Array): MediaCreativeMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  return null;
}

/**
 * ‏מתי אפשר להעלות (או להחליף) את קובץ המודעה: כל עוד ההזמנה חיה
 * ‏והמודעה טרם פורסמה. אחרי הפרסום הקובץ הוא תיעוד, לא טיוטה.
 */
export function mediaCanUploadCreative(status: MediaOrderStatus, publishedAt: Date | string | null): boolean {
  return (status === "pending_payment" || status === "paid" || status === "referred") && publishedAt === null;
}

/* ==================== ציר הזמן של ההזמנה ==================== */

export type MediaTimelineState = "done" | "current" | "pending" | "failed";

export interface MediaTimelineStep {
  key: "created" | "paid" | "sent" | "creative" | "published";
  label: string;
  at: Date | null;
  state: MediaTimelineState;
}

/**
 * ‏ציר הזמן שעמוד ההזמנה מציג — מה כבר קרה, מה עכשיו, ומה עוד לפנינו.
 *
 * ‏הפניה אינה עוברת תשלום, ולכן שלב „שולם” אינו מופיע בה כלל. הזמנה
 * ‏שנכשלה או בוטלה מסתיימת בשלב שבו עצרה, בלי להבטיח המשך.
 */
export function mediaOrderTimeline(order: {
  kind: MediaProductKind;
  status: MediaOrderStatus;
  createdAt: Date;
  paidAt: Date | null;
  notifiedAt: Date | null;
  creativeUploadedAt: Date | null;
  publishedAt: Date | null;
}): MediaTimelineStep[] {
  const steps: MediaTimelineStep[] = [{ key: "created", label: "ההזמנה נפתחה", at: order.createdAt, state: "done" }];
  const stopped = order.status === "failed" || order.status === "cancelled";
  if (order.kind === "paid") {
    steps.push({
      key: "paid",
      label: order.status === "failed" ? "התשלום נכשל" : order.status === "cancelled" ? "ההזמנה בוטלה" : "שולם",
      at: order.paidAt,
      state: stopped ? "failed" : order.paidAt !== null ? "done" : "current",
    });
  }
  const sentDone = order.notifiedAt !== null;
  const published = order.publishedAt !== null;
  const atOutlet = order.status === "paid" || order.status === "referred";
  steps.push({
    key: "sent",
    label: order.kind === "paid" ? "נשלח למדיה" : "נשלח לנציג",
    at: order.notifiedAt,
    state: stopped ? "pending" : sentDone ? "done" : atOutlet ? "current" : "pending",
  });
  steps.push({
    key: "creative",
    label: "קובץ המודעה",
    at: order.creativeUploadedAt,
    state: order.creativeUploadedAt !== null ? "done" : stopped ? "pending" : atOutlet && sentDone ? "current" : "pending",
  });
  steps.push({
    key: "published",
    label: "פורסם",
    at: order.publishedAt,
    state: published ? "done" : "pending",
  });
  if (published) {
    // ‏מה שקדם לפרסום בהכרח קרה — גם כשלא נרשם מועד (למשל נציג שקיבל בטלפון)
    for (const step of steps) if (step.state !== "done" && step.key !== "creative") step.state = "done";
  }
  return steps;
}

/** ‏תמונות של מדיה: `cover` — לוגו/שער אחד; `sample` — דוגמאות מודעה. */
export const MEDIA_IMAGE_KINDS = ["cover", "sample"] as const;
export type MediaImageKind = (typeof MEDIA_IMAGE_KINDS)[number];

/** כמה דוגמאות מודעה למדיה — מספיק להראות, לא גלריה. */
export const MEDIA_IMAGES_MAX = 8;

/** ‏כמה זמן לפני סגירת הגיליון נשלחת התזכורת למשרד עם הזמנה ממתינה. */
export const MEDIA_CLOSING_REMINDER_HOURS = 24;

/**
 * ‏מצב סגירת הגיליון לתצוגה — מה שהכרטיס והעמוד אומרים ליד המועד.
 *
 * - `none` — אין מועד ידוע.
 * - `open` — יש זמן.
 * - `soon` — פחות מ-48 שעות: הכרטיס מזהיר, והתזכורת יוצאת ב-24.
 * - `closed` — המועד עבר ובעל הפלטפורמה טרם עדכן לגיליון הבא.
 */
export type MediaClosingState = "none" | "open" | "soon" | "closed";

export function mediaClosingState(nextClosingAt: Date | null, now: Date): MediaClosingState {
  if (nextClosingAt === null) return "none";
  const msLeft = nextClosingAt.getTime() - now.getTime();
  if (msLeft <= 0) return "closed";
  if (msLeft <= 48 * 60 * 60 * 1000) return "soon";
  return "open";
}

/**
 * ‏האם הגיע הזמן לתזכורת על הגיליון הזה: המועד בעתיד, בתוך חלון
 * ‏התזכורת, ועדיין לא נשלחה תזכורת **למועד הזה** (מועד שהתעדכן
 * ‏לגיליון הבא מקבל תזכורת חדשה).
 */
export function mediaClosingReminderDue(input: {
  nextClosingAt: Date | null;
  remindedForClosingAt: Date | null;
  now: Date;
}): boolean {
  if (input.nextClosingAt === null) return false;
  const msLeft = input.nextClosingAt.getTime() - input.now.getTime();
  if (msLeft <= 0 || msLeft > MEDIA_CLOSING_REMINDER_HOURS * 60 * 60 * 1000) return false;
  return input.remindedForClosingAt?.getTime() !== input.nextClosingAt.getTime();
}

/** ברירת המחדל לעמלת התיווך של הפלטפורמה על הזמנת מדיה, באחוזים. */
export const DEFAULT_MEDIA_COMMISSION_PERCENT = 10;

/** תקרת שפיות — מעבר לזה המוצר מפסיק להיות כדאי למדיה. */
export const MAX_MEDIA_COMMISSION_PERCENT = 50;

/** כמה יחידות אפשר להזמין בהזמנה אחת (מודעות באותו גיליון, למשל). */
export const MEDIA_ORDER_MAX_QUANTITY = 20;

/** אורך התדריך/הערות שהמשרד מצרף להזמנה. */
export const MEDIA_ORDER_BRIEF_MAX = 2000;

/** ‏תקרת מחיר ליחידה — 100,000 ₪ נטו. תקרת שפיות, לא תמחור. */
export const MEDIA_PRODUCT_PRICE_MAX_AGOROT = 10_000_000;

/**
 * ‏תקרת הזמנה אחת — שני מיליון ₪ נטו: המחיר המרבי כפול הכמות המרבית.
 *
 * ‏הסכום נשמר ב-`INTEGER` (עד ~21.4 מיליון ₪), והמע"מ נוסף עליו.
 * ‏התקרה כפול מע"מ חייבת להישאר מתחת לגבול הזה — אחרת ההזמנה
 * ‏נכתבת ושורת התשלום נופלת אחריה (ביקורת Codex). השרת בודק את
 * ‏התקרה לפני שהוא כותב דבר.
 */
export const MEDIA_ORDER_MAX_AMOUNT_AGOROT = MEDIA_PRODUCT_PRICE_MAX_AGOROT * MEDIA_ORDER_MAX_QUANTITY;

/**
 * ‏slug-ים שאינם מדיה: `/media/orders` הוא מסך ההזמנות, ומדיה בשם
 * ‏הזה הייתה בולעת אותו — הנתיב הסטטי נבדק לפני הדינמי.
 */
export const MEDIA_RESERVED_SLUGS = ["orders", "new"] as const;

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
  return (
    value.length >= 2 &&
    value.length <= 60 &&
    MEDIA_SLUG_PATTERN.test(value) &&
    !(MEDIA_RESERVED_SLUGS as readonly string[]).includes(value)
  );
}
