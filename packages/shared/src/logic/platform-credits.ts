/**
 * חשבון הקרדיטים של הפלטפורמה — **מאיפה ההכנסה מהפניות מגיעה בפועל.**
 *
 * ## הבעיה שהקובץ הזה פותר
 *
 * עמלת ההפניה חושבה, נשמרה על שורת ההפניה, ולא נזקפה לשום מקום. היא
 * הייתה **ההפרש** בין מה שהמשרד הקולט חויב לבין מה שהמשרד המפנה זוכה
 * — כלומר קרדיטים שנעלמו מהמחזור בלי שאיש רשם אותם. אי אפשר היה לדעת
 * כמה הפלטפורמה הרוויחה מהפניות, כי לא היה מקום להסתכל בו.
 *
 * ## למה מחיקת קרדיט היא הכנסה
 *
 * קרדיט נמכר בכסף, ולכן כל קרדיט שבמחזור הוא **התחייבות**: הפלטפורמה
 * כבר קיבלה עליו תשלום וחייבת עליו שירות. כשהפלטפורמה גובה עמלה
 * בקרדיטים היא מחזיקה התחייבות של עצמה, ומחיקתה מבטלת את החוב בלי
 * לשלם דבר — וזו בדיוק ההכרה בהכנסה.
 *
 * הפלטפורמה היא המנפיק היחיד, ולכן היא היחידה שיכולה למחוק: אצל משרד
 * מחיקת קרדיט היא הפסד, ואצל המנפיק היא סגירת מעגל.
 *
 * ## למה ההכרה אינה אוטומטית
 *
 * ההכרה נקשרת לרגע ולמחיר, ולכן היא **פעולה** ולא תופעת לוואי: מחיר
 * הקרדיט משתנה מהמסך, והכרה שקטה בכל גבייה הייתה קובעת את סכום
 * ההכנסה לפי המחיר שבמקרה היה בתוקף באותו רגע. פעולה מפורשת מייצרת
 * שורה עם תאריך, כמות ומחיר — כלומר משהו שאפשר לדווח עליו.
 *
 * ## שני המסלולים, אותה גבייה
 *
 * העמלה נזקפת בשני המסלולים. ההבדל הוא רק בנטו: במסלול הקרדיטים הוא
 * מונפק מחדש למפנה עם בונוס, ובמסלול הכסף הוא מומר למזומן ומשולם.
 * לכן הרווח האמיתי אינו „העמלה” לבדה אלא העמלה **פחות** הבונוס
 * שהונפק — ראו `platformCreditsNet`.
 */

/** סוגי התנועה בספר הפלטפורמה. */
export type PlatformCreditKind = "referral_fee" | "burn" | "adjustment";

export const PLATFORM_CREDIT_KIND_LABELS: Record<PlatformCreditKind, string> = {
  referral_fee: "עמלת הפניה",
  burn: "מחיקה והכרה בהכנסה",
  adjustment: "התאמה ידנית",
};

export function platformCreditKindLabel(kind: string): string {
  return PLATFORM_CREDIT_KIND_LABELS[kind as PlatformCreditKind] ?? kind;
}

/** שורה בספר, כפי שהיא מגיעה מהמסד. */
export interface PlatformCreditEntry {
  kind: string;
  /** חיובי = נזקף לפלטפורמה, שלילי = נמחק ממנה. */
  amount: number;
  /** ההכנסה שהוכרה בשורה הזו. אפס בכל שורה שאינה מחיקה. */
  recognizedAgorot: number;
  /**
   * הצד היקר של אותה הפניה — מצולם על אותה שורה.
   *
   * הם יושבים על ההפניה עצמה, ב-`shared_leads`, שהיא טבלה תחת RLS
   * שאין לפלטפורמה דרך חוקית לקרוא ממנה חוצה-דיירים. קריאה כזו
   * מחזירה אפס שורות **בשקט**, ולכן צילום ולא קריאה.
   */
  bonusCredits?: number;
  cashPaidAgorot?: number;
}

/** התמונה הכספית של חשבון הפלטפורמה. */
export interface PlatformCreditSummary {
  /** קרדיטים שנזקפו ועדיין לא נמחקו — התחייבות שהפלטפורמה מחזיקה כלפי עצמה. */
  balanceCredits: number;
  /** כל מה שנזקף אי-פעם. */
  accruedCredits: number;
  /** כל מה שנמחק אי-פעם. */
  burnedCredits: number;
  /** ההכנסה שהוכרה בפועל, באגורות. */
  recognizedAgorot: number;
  /** שווי היתרה במחיר הקרדיט הנוכחי — **הערכה**, לא הכנסה. */
  balanceValueAgorot: number;
}

/**
 * סיכום הספר.
 *
 * `balanceValueAgorot` מחושב במחיר **הנוכחי** ומסומן כהערכה, בעוד
 * `recognizedAgorot` נקרא מהשורות. זה לא קישוט: המחיר משתנה מהמסך,
 * והצגת היתרה כאילו היא הכנסה שכבר נרשמה הייתה מייצרת מספר שקופץ
 * בכל שינוי תמחור — כולל אחורה.
 */
export function summarizePlatformCredits(
  entries: readonly PlatformCreditEntry[],
  unitPriceAgorot: number,
): PlatformCreditSummary {
  let balanceCredits = 0;
  let accruedCredits = 0;
  let burnedCredits = 0;
  let recognizedAgorot = 0;

  for (const entry of entries) {
    balanceCredits += entry.amount;
    if (entry.amount > 0) accruedCredits += entry.amount;
    else burnedCredits += -entry.amount;
    recognizedAgorot += entry.recognizedAgorot;
  }

  return {
    balanceCredits,
    accruedCredits,
    burnedCredits,
    recognizedAgorot,
    balanceValueAgorot: Math.max(0, balanceCredits) * unitPriceAgorot,
  };
}

/**
 * הבונוס שהונפק על הפניה — קרדיטים חדשים שנוצרו יש מאין.
 *
 * הוא **אינו** נגרע מחשבון הפלטפורמה, כי הוא לא יצא ממנו: הוא הרחבה
 * של המחזור. אבל הוא התחייבות חדשה, ובלעדיו „הרווח מהפניות” הוא
 * מספר שמתעלם מהצד היקר של העסקה.
 */
export function referralBonusCredits(row: {
  priceCredits: number;
  platformFeeCredits: number;
  payoutCredits: number;
}): number {
  if (row.payoutCredits <= 0) return 0; // מסלול כסף — אין בונוס
  const net = Math.max(0, row.priceCredits - row.platformFeeCredits);
  return Math.max(0, row.payoutCredits - net);
}

/**
 * השורה התחתונה מהפניות: מה שהוכר בפועל, פחות הבונוס שהונפק.
 *
 * ## למה המזומן ששולם אינו נגרע כאן
 *
 * במסלול הכסף המפנה מקבל מזומן, אבל הקרדיטים שכנגדו **נמחקו
 * מהמחזור** — והם כבר שולמו לפלטפורמה ביום שנקנו. הדחייה שהשתחררה
 * שווה בדיוק לתשלום, ולכן גריעה שלו הייתה ספירה כפולה של אותו כסף.
 *
 * דוגמה במחיר 5 ₪ לקרדיט, הפניה ב-20 קרדיט, עמלת מזומן 25%:
 * הקולט שילם בשעתו 100 ₪ על הקרדיטים, המפנה מקבל 75 ₪, והפלטפורמה
 * מוחקת 5 קרדיט ומכירה ב-25 ₪. זה בדיוק ההפרש.
 *
 * ## למה הבונוס כן נגרע
 *
 * הבונוס הוא קרדיטים **חדשים שנוצרו יש מאין** — אין מאחוריהם מזומן
 * שהתקבל אי-פעם, והם התחייבות לכל דבר. באותה הפניה במסלול קרדיטים:
 * עמלה 2 קרדיט (10 ₪ שיוכרו במחיקה) מול בונוס 4 קרדיט (20 ₪
 * התחייבות חדשה) — כלומר **מינוס 10 ₪**.
 *
 * ## המספר הזה יכול לצאת שלילי, וזה לא באג
 *
 * כשאחוז הבונוס גבוה מאחוז העמלה — וזו ברירת המחדל (20% מול 10%) —
 * מסלול הקרדיטים מנפיק יותר ממה שהוא גובה, תמיד. זה מכוון כשרוצים
 * להזרים נזילות לרשת הצעירה, וזו טעות כשלא שמים לב. לכן המספר מוצג
 * במסך ולא נשאר בקוד.
 */
export function platformCreditsNet(input: {
  recognizedAgorot: number;
  bonusCreditsIssued: number;
  unitPriceAgorot: number;
}): number {
  return input.recognizedAgorot - input.bonusCreditsIssued * input.unitPriceAgorot;
}

/** הגבול העליון למחיקה בפעולה אחת — הגנה מפני טעות הקלדה, לא מדיניות. */
export const MAX_BURN_CREDITS = 1_000_000;
