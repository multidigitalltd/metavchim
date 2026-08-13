/**
 * כלכלת הקרדיטים — **כל מספר כאן ניתן לעריכה מהפלטפורמה.**
 *
 * הקובץ הזה אינו קובע מחירים אלא מגדיר מה חוקי ומה נגזר ממה. המחירים
 * עצמם יושבים בהגדרות הפלטפורמה ומשתנים בלי פריסה — זו הייתה הדרישה,
 * והיא נכונה: תמחור של רשת דו-צדדית מתכייל תוך כדי תנועה, ומספר
 * שקבוע בקוד הופך כל שינוי מסחרי לגרסה חדשה.
 *
 * ברירות המחדל כאן הן **רשת ביטחון בלבד** — מה שהמערכת עושה לפני
 * שמישהו נגע במסך, וכשערך שמור התגלה כפסול. הן לעולם לא "המחיר".
 *
 * ## למה קרדיט וכסף אינם אותו דבר
 *
 * הקרדיט עושה שתי עבודות: הוא אמצעי תשלום בתוך המערכת, והוא שכר על
 * ליד שנמכר. מי שמוכר הרבה ואינו קונה נתקע עם יתרה חסרת שימוש, וכל
 * פדיון אוטומטי הופך את הפלטפורמה למנפיק שמתחייב לפדות — התחייבות
 * שגדלה ככל שהרשת מצליחה.
 *
 * הפתרון כאן: **התמורה נבחרת ברגע המכירה, והנזילות מתומחרת.** מי
 * שבוחר קרדיטים מקבל בונוס, כי הערך נשאר במערכת ואינו עולה מזומן;
 * מי שבוחר כסף מקבל פחות, כי הפלטפורמה משלמת בפועל. הקונה משלם אותו
 * דבר בשני המסלולים — ההפרש הוא בין מה שהמוכר מקבל לבין מה שהפלטפורמה
 * שומרת.
 */

/** חבילת קרדיטים למכירה. המחיר באגורות, כמו כל כסף במערכת. */
export interface CreditPackage {
  credits: number;
  priceAgorot: number;
}

/**
 * ההגדרות שהפלטפורמה שולטת בהן.
 *
 * הכל אופציונלי בקריאה מהמסד — ערך חסר או פסול נופל לברירת המחדל
 * במקום להפיל מסך או לגבות מספר אקראי.
 */
export interface CreditEconomy {
  /** מחיר קרדיט בודד, כשקונים בלי חבילה. */
  unitPriceAgorot: number;
  /** חבילות — כמות מול מחיר; ריק = מכירה ביחידות בלבד. */
  packages: CreditPackage[];
  /** תוספת למי שבוחר לקבל את התמורה בקרדיטים ולא בכסף. */
  creditBonusPercent: number;
  /**
   * עמלת הפלטפורמה כשהמוכר בחר קרדיטים.
   *
   * זו **אותה** עמלת הפניות שכבר קיימת (`referralFeePercent`) ולא
   * הגדרה שנייה לאותו דבר: שני מספרים שחולשים על אותה גבייה נפרדים
   * ביום שמישהו משנה אחד מהם, וזה בדיוק סוג הבאג שמתגלה בכסף.
   */
  feeCreditsPercent: number;
  /** עמלת הפלטפורמה כשהמוכר בחר כסף — גבוהה יותר, זה מחיר הנזילות. */
  feeCashPercent: number;
  /** מתחת לסכום הזה לא מושכים — העברה בין עוסקים היא אירוע חשבונאי. */
  payoutMinimumAgorot: number;
  /**
   * תוקף קרדיט בחודשים. 0 = ללא תפוגה.
   *
   * **טרם נאכף.** ההגדרה נשמרת, אבל אין עדיין קוד שמפקיע קרדיטים:
   * הפקעה נכונה היא הנהלת חשבונות של מנות (איזה קרדיט פג ראשון, מה
   * נוצל ממנו) ועבודה בפני עצמה. עד שתיבנה, המסך אומר זאת במפורש —
   * הגדרה שנראית פעילה ואינה היא בדיוק מה שגורם לבעל הפלטפורמה
   * להאמין שהוא קבע מדיניות.
   */
  expiryMonths: number;
  /** מענק פתיחה חד-פעמי למשרד חדש. */
  initialGrantCredits: number;
}

export const DEFAULT_CREDIT_ECONOMY: CreditEconomy = {
  unitPriceAgorot: 500,
  packages: [],
  creditBonusPercent: 20,
  feeCreditsPercent: 10,
  feeCashPercent: 25,
  payoutMinimumAgorot: 50_000,
  expiryMonths: 12,
  initialGrantCredits: 20,
};

/* גבולות שפיות — לא מדיניות מחירים, אלא הגנה מפני טעות הקלדה. */
export const MAX_CREDIT_UNIT_PRICE_AGOROT = 100_000;
export const MAX_CREDITS_PER_PACKAGE = 100_000;
export const MAX_CREDIT_PACKAGES = 8;
export const MAX_CREDIT_BONUS_PERCENT = 100;
export const MAX_ECONOMY_FEE_PERCENT = 90;
export const MAX_PAYOUT_MINIMUM_AGOROT = 1_000_000;
export const MAX_CREDIT_EXPIRY_MONTHS = 120;
export const MAX_INITIAL_GRANT_CREDITS = 10_000;

/**
 * מספר מתוך הגדרה שמורה.
 *
 * ההגדרות נשמרות כטקסט, ולכן `""` הוא "לא נקבע" ולא אפס — ההבדל
 * מהותי: `Number("")` הוא 0, וקריאה תמימה שלו הייתה מאפסת מחיר בשקט
 * ברגע שמישהו מנקה שדה.
 */
export function resolveNumericSetting(
  raw: unknown,
  fallback: number,
  { min = 0, max, integer = true }: { min?: number; max: number; integer?: boolean },
): number {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "string" && raw.trim() === "") return fallback;
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return fallback;
  if (integer && !Number.isInteger(value)) return fallback;
  if (value < min || value > max) return fallback;
  return value;
}

/** למה החבילה נדחית, או `null` כשהיא תקינה. */
export function creditPackageRejectionReason(pkg: CreditPackage): string | null {
  if (!Number.isInteger(pkg.credits) || pkg.credits < 1) {
    return "כמות הקרדיטים בחבילה חייבת להיות מספר שלם חיובי";
  }
  if (pkg.credits > MAX_CREDITS_PER_PACKAGE) {
    return `כמות הקרדיטים בחבילה אינה יכולה לעלות על ${MAX_CREDITS_PER_PACKAGE}`;
  }
  if (!Number.isInteger(pkg.priceAgorot) || pkg.priceAgorot < 1) {
    return "מחיר החבילה חייב להיות מספר שלם חיובי";
  }
  if (pkg.priceAgorot > MAX_CREDIT_UNIT_PRICE_AGOROT * MAX_CREDITS_PER_PACKAGE) {
    return "מחיר החבילה גבוה מהסביר";
  }
  return null;
}

/** מחיר לקרדיט בחבילה — הבסיס להצגת ההנחה. */
export function packageUnitPriceAgorot(pkg: CreditPackage): number {
  return pkg.priceAgorot / pkg.credits;
}

/**
 * כמה חוסכים בחבילה מול מחיר היחידה, באחוזים שלמים.
 *
 * שלילי אפשרי ומוצג ככזה: חבילה שיקרה ממחיר היחידה היא כנראה טעות
 * הקלדה, ועדיף שהיא תיראה במסך ולא תימכר בשקט.
 */
export function packageDiscountPercent(pkg: CreditPackage, unitPriceAgorot: number): number {
  if (unitPriceAgorot <= 0) return 0;
  return Math.round((1 - packageUnitPriceAgorot(pkg) / unitPriceAgorot) * 100);
}

/** מסלול התמורה שהמשרד המפנה בוחר בפרסום. */
export type PayoutMode = "credits" | "cash";

export interface ReferralSettlement {
  /** מה שהמשרד הקולט משלם, בקרדיטים. */
  priceCredits: number;
  /** מה שהפלטפורמה שומרת, בקרדיטים. */
  platformFeeCredits: number;
  /** מה שנכנס למשרד המפנה — קרדיטים במסלול קרדיטים. */
  payoutCredits: number;
  /** מה שנכנס למשרד המפנה — אגורות במסלול כסף. */
  payoutAgorot: number;
}

/**
 * חלוקת התמורה על הפניה, לפי המסלול שנבחר.
 *
 * הקונה משלם אותו מחיר בשני המסלולים — זו הנקודה. מה שמשתנה הוא
 * כמה נשאר אצל הפלטפורמה וכמה מגיע למוכר, ובאיזה מטבע.
 *
 * העיגול תמיד **לטובת המשרד המפנה**: שבר שנעלם לטובת הפלטפורמה בכל
 * עסקה הוא גבייה שקטה שאיש לא הסכים לה.
 */
export function settleReferral(
  priceCredits: number,
  mode: PayoutMode,
  economy: CreditEconomy,
): ReferralSettlement {
  const feePercent = mode === "credits" ? economy.feeCreditsPercent : economy.feeCashPercent;
  const platformFeeCredits = Math.floor((priceCredits * feePercent) / 100);
  const netCredits = Math.max(0, priceCredits - platformFeeCredits);

  if (mode === "credits") {
    /*
     * `ceil` ולא `floor`: הכלל הוא שהשבר הולך למשרד המפנה, וכאן הוא
     * היה הולך לאיבוד. 14 נטו עם בונוס 20% נותנים 2.8 — כלומר 3,
     * לא 2. עיגול כלפי מטה בכל עסקה עם שארית הוא תשלום חסר שיטתי.
     */
    const bonus = Math.ceil((netCredits * economy.creditBonusPercent) / 100);
    return {
      priceCredits,
      platformFeeCredits,
      payoutCredits: netCredits + bonus,
      payoutAgorot: 0,
    };
  }
  return {
    priceCredits,
    platformFeeCredits,
    payoutCredits: 0,
    payoutAgorot: netCredits * economy.unitPriceAgorot,
  };
}
