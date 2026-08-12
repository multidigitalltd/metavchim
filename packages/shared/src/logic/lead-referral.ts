import { coopOfferCost, type LeadSourcePrice } from "./collaboration-cost.js";

/**
 * הפניית לקוח בין משרדים.
 *
 * **המילים כאן אינן קישוט.** משרד תיווך אינו "מוכר לידים" — הוא מפנה
 * לקוח שאינו מתאים לו למשרד שכן יכול לשרת אותו, ומקבל על ההפניה
 * תמורה. זו הבחנה מקצועית ורגולטורית כאחת, ולכן היא נאכפת בשפה של
 * כל המערכת: **הפניית לקוח**, **המשרד המפנה**, **המשרד הקולט** —
 * ולא "מכירה", "קונה" או "מוכר". `REFERRAL_TERMS` הוא המילון המחייב.
 *
 * שלושה כללים מרכיבים את המנגנון:
 *
 * 1. **המשרד המפנה קובע את התמורה** — לא הפלטפורמה. הוא זה שיודע מה
 *    שווה הלקוח שהוא מוותר עליו. מתוך התמורה יורדת עמלת פלטפורמה.
 * 2. **התמורה משולמת על ההפניה, לא על התוצאה** — המשרד הקולט משלם
 *    ברגע הקליטה, גם אם בסוף לא ייסגר דבר. חשוב שזה ייאמר לפני
 *    הלחיצה ולא אחריה.
 * 3. **שני הצדדים מדרגים** — ומכיוון שהתשלום אינו מותנה בתוצאה,
 *    הדירוג הוא המנגנון היחיד שמייקר הפניית זבל.
 */

/** אורך ההערה שהמשרד המפנה מצרף — מוצגת בלוח, לכן קצרה ואנונימית. */
export const MAX_REFERRAL_NOTE = 300;

/** אורך שם העיר (ללידים אין עמודת עיר — זה קלט חופשי). */
export const MAX_REFERRAL_CITY = 120;

/* ============================================================
   תמורה ועמלת פלטפורמה
   ============================================================ */

/** התמורה המינימלית. הפניה בחינם משאירה את המפנה בלי סיבה להפנות. */
export const MIN_REFERRAL_PRICE = 1;

/**
 * תקרת שפיות. אינה מדיניות מחיר אלא הגנה מפני טעות הקלדה — משרד
 * שהתכוון ל-15 והקליד 1500 מפרסם הפניה שאיש לא ייגע בה, ומחכה.
 */
export const MAX_REFERRAL_PRICE = 500;

/**
 * אחוז העמלה שהפלטפורמה גובה מתמורת ההפניה.
 *
 * הפלטפורמה מתחזקת את הלוח, את הזהות של שני הצדדים ואת ההעברה
 * עצמה — ולכן היא צד לעסקה ולא צינור. האחוז אחיד ומוצג לשני הצדדים
 * לפני כל החלטה: עמלה שמתגלה אחרי התשלום היא בדיוק מה שהורס אמון
 * בלוח הפניות.
 */
export const PLATFORM_REFERRAL_FEE_PERCENT = 15;

/** תקרת שפיות לעמלה — מעבר לזה ההפניה מפסיקה להיות כדאית למפנה. */
export const MAX_PLATFORM_FEE_PERCENT = 50;

/**
 * האחוז שנקבע במסך הפלטפורמה, עם נפילה לברירת המחדל.
 *
 * מקור אמת אחד לשרת ולמסך: השרת גובה לפי זה, והמסך מציג לפי זה.
 * ערך פסול — טקסט, שלילי, מעל התקרה — נופל לברירת המחדל במקום
 * לייצר עמלה חסרת משמעות: הגדרה שבורה לא אמורה לגרום למשרד לשלם
 * 300% על הפניה, ולא לפלטפורמה לגבות אפס בלי שאיש ישים לב.
 */
export function resolveReferralFeePercent(stored: unknown): number {
  /*
   * ריק אינו אפס. `Number("")` הוא 0, ולכן הגדרה שנמחקה הייתה
   * נקראת כ"אפס אחוז" והפלטפורמה הייתה מפסיקה לגבות בשקט. אפס הוא
   * החלטה שמקלידים במפורש; ריק הוא "לא הוגדר".
   */
  if (stored === null || stored === undefined) return PLATFORM_REFERRAL_FEE_PERCENT;
  if (typeof stored === "string" && stored.trim() === "") return PLATFORM_REFERRAL_FEE_PERCENT;
  const value = typeof stored === "string" ? Number(stored.trim()) : Number(stored);
  if (!Number.isFinite(value)) return PLATFORM_REFERRAL_FEE_PERCENT;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > MAX_PLATFORM_FEE_PERCENT) return PLATFORM_REFERRAL_FEE_PERCENT;
  return rounded;
}

/**
 * עמלת הפלטפורמה בקרדיטים.
 *
 * **עיגול לטובת המפנה.** בתמורה נמוכה האחוז נופל מתחת לחצי קרדיט,
 * והעיגול מוריד אותו לאפס — הפלטפורמה מוותרת על השבר במקום לעגל
 * כלפי מעלה על חשבון מי שהפנה. ההפך היה גובה קרדיט שלם (100%)
 * מהפניה שתומחרה בקרדיט אחד.
 */
export function platformReferralFee(
  priceCredits: number,
  percent: number = PLATFORM_REFERRAL_FEE_PERCENT,
): number {
  if (!Number.isFinite(priceCredits) || priceCredits <= 0) return 0;
  const fee = Math.round((priceCredits * percent) / 100);
  // גם עמלה מנופחת בטעות לא תשאיר את המפנה עם כלום
  return Math.max(0, Math.min(fee, priceCredits - 1));
}

/** פירוק התמורה לשלושת החלקים שהמסכים מציגים. */
export interface ReferralPayout {
  /** מה שהמשרד הקולט משלם */
  priceCredits: number;
  /** מה שיורד לפלטפורמה */
  platformFeeCredits: number;
  /** מה שנכנס ליתרת המשרד המפנה */
  payoutCredits: number;
}

/**
 * החישוב המלא. **מקור אמת אחד** לשרת ולמסך: המסך מציג את הפירוק לפני
 * הפרסום, השרת רושם אותו ביומן הקרדיטים, ושניהם חייבים להסכים.
 */
export function referralPayout(
  priceCredits: number,
  percent: number = PLATFORM_REFERRAL_FEE_PERCENT,
): ReferralPayout {
  const platformFeeCredits = platformReferralFee(priceCredits, percent);
  return {
    priceCredits,
    platformFeeCredits,
    payoutCredits: priceCredits - platformFeeCredits,
  };
}

/**
 * הצעת מחיר פתיחה לפי מקור הליד — **הצעה בלבד.**
 *
 * עד כה זה היה המחיר עצמו; היום המשרד המפנה קובע, וזו רק הנקודה
 * שהטופס נפתח בה כדי שלא יתחיל מדף ריק. רצפה של קרדיט אחד: מקור
 * שהפלטפורמה תמחרה כחינם בביקושים אינו חינם כאן, כי מאחורי הפניה
 * עומד לקוח אמיתי שמישהו מוותר עליו.
 */
export function suggestedReferralPrice(
  source: string,
  prices: readonly LeadSourcePrice[],
): number {
  return Math.max(MIN_REFERRAL_PRICE, coopOfferCost(source, prices));
}

/** תקינות התמורה — הודעה בעברית או `null`. */
export function referralPriceRejectionReason(priceCredits: number): string | null {
  if (!Number.isInteger(priceCredits)) return "התמורה חייבת להיות מספר שלם של קרדיטים";
  if (priceCredits < MIN_REFERRAL_PRICE || priceCredits > MAX_REFERRAL_PRICE) {
    return `התמורה חייבת להיות בין ${MIN_REFERRAL_PRICE} ל-${MAX_REFERRAL_PRICE} קרדיטים`;
  }
  return null;
}

/* ============================================================
   סיבת ההפניה
   ============================================================
   משרד שמפנה לקוח חייב לומר למה. זה מה שמבדיל בין הפניה מקצועית
   ("לא באזור הפעילות שלנו") לבין היפטרות מלקוח, וזה גם המידע שהמשרד
   הקולט הכי צריך לפני שהוא משלם: ליד שהמפנה עצמו לא הצליח לתפוס
   שווה פחות מליד שפשוט נמצא בעיר הלא נכונה.
   ============================================================ */

export interface ReferralReasonOption {
  value: string;
  label: string;
  /** הסבר קצר — מוצג בבורר, כדי שלא ייבחר הראשון מתוך חוסר סבלנות */
  hint: string;
}

export const REFERRAL_REASONS: readonly ReferralReasonOption[] = [
  {
    value: "out_of_area",
    label: "מחוץ לאזור הפעילות שלנו",
    hint: "הלקוח מחפש באזור שאנחנו לא עובדים בו",
  },
  {
    value: "wrong_segment",
    label: "לא בתחום שלנו",
    hint: "סוג הנכס או סוג העסקה אינם מה שהמשרד עוסק בו",
  },
  {
    value: "budget_mismatch",
    label: "התקציב לא תואם למלאי שלנו",
    hint: "אין ולא צפוי להיות לנו נכס בטווח הזה",
  },
  {
    value: "no_capacity",
    label: "אין לנו כרגע פנאי לטפל",
    hint: "הלקוח רלוונטי, אבל יישאר בלי מענה אצלנו",
  },
  {
    value: "client_stalled",
    label: "הלקוח לא התקדם איתנו",
    hint: "ניסינו, ולא נוצרה התקדמות — שווה לומר את זה מראש",
  },
  {
    value: "other",
    label: "סיבה אחרת",
    hint: "חובה לפרט במילים",
  },
];

/**
 * סיבה של הפניות שפורסמו לפני שהשדה נוסף. אינה נבחרת בטופס ואינה
 * מוצגת כאילו נבחרה — הפניה ישנה תאמר בגלוי שלא צוינה סיבה.
 */
export const UNSPECIFIED_REFERRAL_REASON = "unspecified";

/** אורך הפירוט החופשי לצד הסיבה. */
export const MAX_REFERRAL_REASON_DETAIL = 200;

export function referralReasonLabel(value: string): string {
  if (value === UNSPECIFIED_REFERRAL_REASON) return "לא צוינה סיבה";
  return REFERRAL_REASONS.find((r) => r.value === value)?.label ?? value;
}

/**
 * תקינות הסיבה — הודעה בעברית או `null`.
 *
 * `other` בלי פירוט נדחה: סיבה שאומרת "אחר" ותו לא אינה סיבה, והיא
 * בדיוק המקום שאליו תזלוג היפטרות מלקוחות אם לא נחסום אותה.
 */
export function referralReasonRejectionReason(
  reason: string,
  detail?: string,
): string | null {
  const known = REFERRAL_REASONS.some((r) => r.value === reason);
  if (!known) return "יש לבחור סיבה להפניה";
  const trimmed = detail?.trim() ?? "";
  if (reason === "other" && trimmed.length < 3) {
    return "בחרתם „סיבה אחרת” — פרטו במילים";
  }
  if (trimmed.length > MAX_REFERRAL_REASON_DETAIL) {
    return `הפירוט ארוך מדי (עד ${MAX_REFERRAL_REASON_DETAIL} תווים)`;
  }
  return null;
}

/* ============================================================
   דירוג הדדי
   ============================================================
   התמורה משולמת על ההפניה ולא על התוצאה, ולכן אין בעסקה הזו מנגנון
   החזר. מה שכן יש הוא מוניטין: משרד שמפנה זבל מדורג נמוך, והמחיר
   שהוא יכול לבקש יורד. הדירוג מוצג לצד כל הפניה שלו — לפני התשלום.
   ============================================================ */

export const MIN_REFERRAL_RATING = 1;
export const MAX_REFERRAL_RATING = 5;
export const MAX_REFERRAL_RATING_COMMENT = 300;

/** מה כל ציון אומר — כדי ששני משרדים ידרגו באותה סקאלה. */
export const REFERRAL_RATING_LABELS: Readonly<Record<number, string>> = {
  1: "לא היה מה לעבוד איתו",
  2: "חלש",
  3: "סביר",
  4: "טוב",
  5: "לקוח אמיתי, שווה כל קרדיט",
};

/** תקינות דירוג — הודעה בעברית או `null`. */
export function referralRatingRejectionReason(
  score: number,
  comment?: string,
): string | null {
  if (!Number.isInteger(score) || score < MIN_REFERRAL_RATING || score > MAX_REFERRAL_RATING) {
    return `דירוג הוא מספר שלם בין ${MIN_REFERRAL_RATING} ל-${MAX_REFERRAL_RATING}`;
  }
  if ((comment?.trim().length ?? 0) > MAX_REFERRAL_RATING_COMMENT) {
    return `ההערה ארוכה מדי (עד ${MAX_REFERRAL_RATING_COMMENT} תווים)`;
  }
  return null;
}

/** ממוצע הדירוגים של משרד — `null` כשעדיין אין על מה לדבר. */
export function referralRatingAverage(sum: number, count: number): number | null {
  if (!Number.isFinite(sum) || !Number.isFinite(count) || count <= 0) return null;
  return Math.round((sum / count) * 10) / 10;
}

/**
 * הניסוח שמוצג ליד שם המשרד המפנה.
 *
 * מקבל **ממוצע** ולא סכום: המסך מקבל מהשרת ממוצע מוכן, והחישוב עצמו
 * (`referralRatingAverage`) שייך לצד שקורא את המונים. משרד בלי
 * דירוגים אינו "0 מתוך 5" — הוא משרד חדש בלוח, וזו אמירה אחרת לגמרי.
 */
export function describeReferralRating(average: number | null, count: number): string {
  if (average === null || count <= 0) return "טרם דורג";
  return `${average} מתוך ${MAX_REFERRAL_RATING} (${count} דירוגים)`;
}
