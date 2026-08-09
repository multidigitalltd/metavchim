/**
 * כמה עולה להציע נכס על ביקוש משותף.
 *
 * ההפרדה היא לפי **מקור הליד**, ולא לפי המסלול:
 *
 * - **ביקוש של משרד תיווך אחר** (`network`) — חינם, בכל המסלולים.
 *   שיתוף פעולה בין משרדים הוא מה שהופך את הרשת לשווה משהו, ורשת
 *   שרק המסלולים הגבוהים נמצאים בה אינה רשת. משרד שמשלם על הזכות
 *   להציע נכס לעמית פשוט לא יציע.
 *
 * - **ליד ממקור חיצוני** — עולה קרדיטים. הליד הזה נקנה בכסף אמיתי
 *   מהספק, וזה המוצר שנמכר.
 *
 * **המחיר הוא נתון ולא קבוע בקוד.** לכל מקור מחיר משלו, כי המחיר
 * שמשלמים לספק שונה בין ספק לספק ומשתנה בזמן; מחיר אחד לכולם היה
 * מחייב שינוי קוד בכל משא ומתן. ברירות המחדל כאן הן נקודת הפתיחה,
 * ובעל הפלטפורמה עורך מעליהן — אותו דפוס בדיוק כמו המסלולים.
 */

/** מחיר ליד לפי מקור. */
export interface LeadSourcePrice {
  /** מזהה המקור כפי שהוא נשמר על הביקוש. */
  source: string;
  /** שם לתצוגה — מוצג למשרד ליד הביקוש. */
  label: string;
  /** עלות בקרדיטים. 0 = חינם. */
  creditsCost: number;
}

/**
 * ברירות המחדל.
 *
 * `network` בעלות אפס אינו "מקור שטרם תומחר" — הוא הצהרה: שיתוף
 * פעולה בין משרדים חינם, וזה לא משתנה עם המסלול.
 */
export const DEFAULT_LEAD_SOURCES: readonly LeadSourcePrice[] = [
  { source: "network", label: "משרד תיווך ברשת", creditsCost: 0 },
  { source: "kanko", label: "Kanko", creditsCost: 1 },
];

/**
 * העלות של מקור שאינו מתומחר.
 *
 * ברירת המחדל היא **בתשלום** ולא חינם: מקור חדש שנוסף ושכחו לתמחר
 * אותו עדיף שייחסם על ידי יתרה מאשר שיחולק בחינם בלי שאיש ישים לב.
 */
export const UNPRICED_SOURCE_COST = 1;

export function coopOfferCost(
  source: string,
  prices: readonly LeadSourcePrice[] = DEFAULT_LEAD_SOURCES,
): number {
  const match = prices.find((p) => p.source === source);
  if (match === undefined) return UNPRICED_SOURCE_COST;
  // מחיר שלילי או לא-מספר הוא נתון פגום, ולא הנחה
  return Number.isFinite(match.creditsCost) && match.creditsCost > 0
    ? Math.round(match.creditsCost)
    : 0;
}

/** האם הביקוש עולה קרדיטים — לתצוגה, מאותו כלל. */
export function demandCostsCredits(
  source: string,
  prices: readonly LeadSourcePrice[] = DEFAULT_LEAD_SOURCES,
): boolean {
  return coopOfferCost(source, prices) > 0;
}

/** שם המקור לתצוגה; המזהה עצמו כשאין. */
export function leadSourceLabel(
  source: string,
  prices: readonly LeadSourcePrice[] = DEFAULT_LEAD_SOURCES,
): string {
  return prices.find((p) => p.source === source)?.label ?? source;
}

/** תקינות שורת תמחור לפני שמירה — הודעה בעברית או `null`. */
export function leadPriceRejectionReason(price: LeadSourcePrice): string | null {
  if (!/^[a-z0-9_]{2,20}$/u.test(price.source)) {
    return "מזהה מקור באותיות לטיניות קטנות, ספרות וקו תחתון";
  }
  if (price.label.trim().length < 2) return "שם המקור קצר מדי";
  if (!Number.isInteger(price.creditsCost) || price.creditsCost < 0 || price.creditsCost > 1000) {
    return "עלות בקרדיטים חייבת להיות מספר שלם בין 0 ל-1000";
  }
  return null;
}

/* ============================================================
   חלוקת עמלה
   ============================================================
   שיתוף פעולה הוא עסקה בין שני משרדים: הלקוח משלם עמלה אחת, והיא
   מתחלקת. החלוקה נקבעת **ברגע השיתוף** ולא בסופו — מו"מ על אחוזים
   אחרי שהקונה כבר התעניין הוא בדיוק המקום שבו שיתופי פעולה נשברים.
   ============================================================ */

/** ברירת המחדל, וגם מה שרוב העסקאות נסגרות בו. */
export const DEFAULT_COMMISSION_SPLIT = 50;

/**
 * המינימום שכל צד מקבל.
 *
 * 33% ולא פחות: מתחת לזה הצד השני עובד כמעט בחינם, וזה כבר לא
 * שיתוף פעולה אלא דמי תיווך משנה. המגבלה דו-כיוונית מעצם ההגדרה —
 * מי שלוקח 67% משאיר בדיוק 33%.
 */
export const MIN_COMMISSION_SHARE = 33;

/** התקרה נגזרת מהמינימום ולא נכתבת בנפרד, כדי שלא ייפרדו. */
export const MAX_COMMISSION_SHARE = 100 - MIN_COMMISSION_SHARE;

/**
 * תקינות החלוקה — הודעה בעברית או `null`.
 *
 * `share` הוא האחוז שהמשרד **המשתף** לוקח; לצד השני נשאר המשלים.
 */
export function commissionSplitRejectionReason(share: number): string | null {
  if (!Number.isInteger(share)) return "אחוז החלוקה חייב להיות מספר שלם";
  if (share < MIN_COMMISSION_SHARE || share > MAX_COMMISSION_SHARE) {
    return `כל צד חייב לקבל לפחות ${MIN_COMMISSION_SHARE}% — בחרו בין ${MIN_COMMISSION_SHARE} ל-${MAX_COMMISSION_SHARE}`;
  }
  return null;
}

/** הניסוח שמוצג: "‎50% / 50%". */
export function describeCommissionSplit(share: number): string {
  return `${share}% / ${100 - share}%`;
}

/**
 * האפשרויות שמוצגות בבורר.
 *
 * נגזרות מהגבולות ולא נכתבות ביד: רשימה קבועה הייתה מציגה ערך שהשרת
 * דוחה ביום שמישהו משנה את המינימום.
 *
 * **העוגן הוא 50 ולא המינימום.** רשימה שנבנית מלמטה בקפיצות של 5
 * מדלגת בדיוק על 50 — ברירת המחדל, ומה שרוב העסקאות נסגרות בו —
 * ומשאירה בורר שאי אפשר לבחור בו את הערך שהוא כבר מציג.
 */
export const COMMISSION_SPLIT_OPTIONS: readonly number[] = (() => {
  const values = new Set<number>([MIN_COMMISSION_SHARE, MAX_COMMISSION_SHARE]);
  for (
    let share = DEFAULT_COMMISSION_SPLIT;
    share >= MIN_COMMISSION_SHARE;
    share -= 5
  ) {
    values.add(share);
  }
  for (
    let share = DEFAULT_COMMISSION_SPLIT;
    share <= MAX_COMMISSION_SHARE;
    share += 5
  ) {
    values.add(share);
  }
  return [...values].sort((a, b) => a - b);
})();
