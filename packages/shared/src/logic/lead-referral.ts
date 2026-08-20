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

/* ============================================================
   המילון המחייב
   ============================================================ */

/**
 * המונחים של מנגנון ההפניות — **מקור אחד לכל טקסט במערכת.**
 *
 * התיעוד למעלה הבטיח את `REFERRAL_TERMS` מהיום הראשון, והוא מעולם
 * לא נבנה: הכלל היה כתוב ולא היה לו מקום להיאכף בו, ולכן כל מסך
 * ניסח מחדש והשפה נסחפה חזרה למסחר.
 *
 * ההבחנה אינה סמנטית. משרד תיווך שמוכר לקוחות ומשרד תיווך שמפנה
 * לקוח לעמית הם שני דברים שונים — מקצועית ורגולטורית. התמורה כאן
 * משולמת על **ההפניה**: על כך שמשרד טרח, זיהה שהלקוח אינו מתאים
 * לו, ומסר אותו למי שכן יכול לשרת אותו. אין עמלה בסגירה, ואין
 * החזר אם לא נסגר.
 *
 * לכן גם `FORBIDDEN_REFERRAL_WORDS` ובדיקה מבנית שסורקת את המסכים:
 * מילון בלי אכיפה הוא בדיוק ההבטחה שלא קוימה כאן פעם אחת.
 */
export const REFERRAL_TERMS = Object.freeze({
  /** הפעולה עצמה. */
  referral: "הפניה",
  referrals: "הפניות",
  /** התמורה. **לא** "מחיר" ולא "עלות" — אלה מילים של מכירה. */
  fee: "עמלת הפניה",
  /** מי מפנה ומי קולט. לא "מוכר" ולא "קונה". */
  referrer: "המשרד המפנה",
  receiver: "המשרד הקולט",
  /** הפעולה של הצד הקולט. לא "רכישה" ולא "קנייה". */
  accept: "קליטת הפניה",
  /** מה שהמפנה עושה. */
  refer: "הפניית לקוח",
} as const);

/**
 * מילים שאסור שיופיעו בטקסט שמתאר הפניות.
 *
 * הרשימה קצרה בכוונה ומכוונת ל**מסחר בלקוחות** בלבד. "תשלום",
 * "קרדיטים" ו"תמורה" מותרים — כסף באמת עובר, ולהסתיר את זה היה
 * גרוע יותר מלנסח אותו נכון.
 *
 * ‎"מחיר ליד"‎ נעדר מהרשימה בכוונה: בעברית ‎"ליד"‎ הוא גם מילת יחס,
 * ו"תווית מחיר ליד הכפתור" הוא משפט תקין לחלוטין. שער שמסמן טקסט
 * כשר מלמד להתעלם ממנו — וזה הסוף של כל שער. ‎"מחיר הליד"‎ ו‎"עלות
 * הליד"‎ חד-משמעיים ונשארים.
 */
export const FORBIDDEN_REFERRAL_WORDS: readonly string[] = [
  "מכירת ליד",
  "מכירת לידים",
  "קניית ליד",
  "קניית לידים",
  "רכישת ליד",
  "רכישת לידים",
  "מחיר הליד",
  "עלות הליד",
  "לקנות ליד",
  "מוכר הליד",
  "קונה הליד",
  "סחר בלידים",
  "מסחר בלידים",
];

/**
 * המילה האסורה הראשונה בטקסט, או `null` כשהוא נקי.
 *
 * מחזיר את המילה ולא רק בוליאני: הבדיקה המבנית מדווחת **מה** נמצא
 * ואיפה, ודיווח "יש בעיה" בלי לומר מה שולח לחפש בעיניים.
 */
export function forbiddenReferralWord(text: string): string | null {
  return FORBIDDEN_REFERRAL_WORDS.find((word) => text.includes(word)) ?? null;
}

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
/*
 * **25% ולא 15%.**
 *
 * במסלול הקרדיטים המפנה מקבל בונוס על הנטו, ולכן העמלה חייבת להיות
 * גבוהה ממנו: בעמלה 10% מול בונוס 20% הפלטפורמה מנפיקה יותר קרדיטים
 * ממה שהיא גובה, וכל הפניה מגדילה את ההתחייבות שלה במקום את ההכנסה.
 * ראו `platformCreditsNet` — נקודת האיזון היא ‎bonus / (1 + bonus)‎,
 * כלומר ~17% מול בונוס של 20%.
 *
 * 25% ולא 18%: העיגול לטובת המפנה (רצפה על העמלה, תקרה על הבונוס)
 * אוכל את המרווח בתמורות קטנות, ובעמלה של 22% הפניה של 20 קרדיט
 * יוצאת בדיוק אפס. 25% משאיר מרווח אמיתי, והוא גם המספר שכבר קיים
 * במסלול הכסף — עמלה אחת שקל להסביר לשני הצדדים.
 *
 * המפנה עדיין מרוויח יותר בקרדיטים: על הפניה של 20 קרדיט הוא מקבל
 * 18 קרדיט (שווי 90 ₪) מול 75 ₪ במסלול הכסף. תמריץ הנזילות שנשמר
 * כאן מלכתחילה נשאר בעינו.
 */
export const PLATFORM_REFERRAL_FEE_PERCENT = 25;

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
 * **עיגול לטובת המפנה.** בתמורה נמוכה האחוז נופל מתחת לקרדיט שלם,
 * והרצפה מורידה אותו לאפס — הפלטפורמה מוותרת על השבר במקום לגבות
 * אותו ממי שהפנה. ההפך היה גובה קרדיט שלם (100%) מהפניה שתומחרה
 * בקרדיט אחד.
 *
 * ## למה רצפה ולא `Math.round`
 *
 * שתי סיבות. הראשונה: `Math.round(0.5)` מעגל **כלפי מעלה**, כלומר
 * בדיוק נגד הכלל שההערה הזו מצהירה עליו.
 *
 * השנייה חמורה יותר — `settleReferral` (מה שגובה בפועל) משתמש
 * ב-`Math.floor`, והפונקציה הזו (מה שהמסך מציג למפרסם לפני שהוא
 * מאשר) השתמשה ב-`Math.round`. בתמורה של 10 קרדיטים המסך הראה
 * עמלה 3 והשרת גבה 2: אותה עסקה, שני מספרים. עכשיו זו אותה פעולה.
 */
export function platformReferralFee(
  priceCredits: number,
  percent: number = PLATFORM_REFERRAL_FEE_PERCENT,
): number {
  if (!Number.isFinite(priceCredits) || priceCredits <= 0) return 0;
  const fee = Math.floor((priceCredits * percent) / 100);
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
   הצהרת המפנה ואישור הקולט
   ============================================================
   התמורה משולמת על ההפניה ולא על התוצאה, ולכן אין בעסקה הזו מנגנון
   החזר — ומה ששומר עליה הוא **הצהרה שנבדקת**.

   1. **המשרד המפנה מצהיר על איכות הלקוח** ברגע הפרסום: כמה הוא
      רציני, כמה התקציב שלו ריאלי, כמה זה דחוף וכמה הוא זמין.
      ההצהרה מוצגת בלוח **לפני התשלום** — היא בדיוק מה שהמשרד
      הקולט צריך כדי להחליט אם עמלת ההפניה שווה את זה.
   2. **המשרד הקולט מאשר** אחרי שעבד עם הלקוח: הוא מדרג את **אותם
      ממדים** מניסיון ישיר.
   3. **המוניטין הוא דיוק ההצהרה** — כמה ההצהרה קרבה למה שהתברר
      בפועל, ולא כמה הלקוח היה טוב.

   הנקודה בסעיף 3 היא כל המנגנון. מוניטין שנבנה מ"כמה הלקוח היה
   טוב" מעניש משרד שהצהיר ביושר על לקוח בינוני, ומתגמל את מי שהיה
   לו מזל — כלומר לא מודד דבר שבשליטתו. דיוק ההצהרה כן: משרד שמנפח
   מקבל ציון נמוך גם על לקוח מצוין שהצהיר עליו כמושלם, ומשרד שאומר
   "בינוני" ומקבל אישור "בינוני" מקבל חמישה כוכבים.
   ============================================================ */

export const MIN_REFERRAL_RATING = 1;
export const MAX_REFERRAL_RATING = 5;
export const MAX_REFERRAL_RATING_COMMENT = 300;

/** מה כל ציון אומר — כדי ששני משרדים ידרגו באותה סקאלה. */
export const REFERRAL_RATING_LABELS: Readonly<Record<number, string>> = {
  1: "גרוע",
  2: "חלש",
  3: "סביר",
  4: "טוב",
  5: "מצוין",
};

/* ------------------------------------------------------------
   ממדי איכות הלקוח
   ------------------------------------------------------------ */

export interface ReferralRatingDimension {
  key: string;
  /** התווית בשני הטפסים. */
  label: string;
  /** מה נשאל את **המפנה**, בזמן הפרסום. */
  declareHint: string;
  /** מה נשאל את **הקולט**, אחרי שעבד עם הלקוח. */
  confirmHint: string;
}

/**
 * ממדי איכות הלקוח — **קטלוג אחד לשני הצדדים.**
 *
 * שני הצדדים מדרגים את אותם ממדים בדיוק, ולא כל אחד את משנהו: זו
 * ההנחה שמאפשרת להשוות הצהרה לאישור ולגזור מהפער ציון דיוק. שני
 * קטלוגים נפרדים היו שני דירוגים שאין ביניהם שום יחס מספרי, וכל
 * "מוניטין" שהיה נבנה מהם היה ממוצע של דעות ולא מדידה.
 *
 * הממדים נבחרו לפי שני תנאים: המפנה **יודע** את התשובה בזמן
 * הפרסום, והקולט **יכול לבדוק** אותה מניסיון ישיר תוך ימים.
 * „האם נסגרה עסקה” נכשל בשניהם ואינו כאן — הוא תלוי בשוק, בלקוח
 * ובקולט עצמו, והתמורה ממילא אינה מותנית בתוצאה.
 */
export const CLIENT_RATING_DIMENSIONS: readonly ReferralRatingDimension[] = [
  {
    key: "seriousness",
    label: "רצינות",
    declareHint: "מחפש בפועל, או בודק מחירים?",
    confirmHint: "התברר כמחפש רציני?",
  },
  {
    key: "budget",
    label: "ריאליות התקציב",
    declareHint: "התקציב שהוא נוקב מתאים למה שהוא מחפש?",
    confirmHint: "התקציב שהוצהר החזיק מול השוק?",
  },
  {
    key: "urgency",
    label: "דחיפות",
    declareHint: "צריך לעבור בקרוב, או מסתכל לטווח ארוך?",
    confirmHint: "לוח הזמנים היה כפי שנמסר?",
  },
  {
    key: "reachability",
    label: "זמינות",
    declareHint: "עונה לטלפון וקובע פגישות?",
    confirmHint: "ענה לכם כשפניתם?",
  },
];

/** הממד לפי מפתח; `undefined` כשאינו בקטלוג. */
export function ratingDimension(key: string): ReferralRatingDimension | undefined {
  return CLIENT_RATING_DIMENSIONS.find((d) => d.key === key);
}

/**
 * הציון הכולל — ממוצע הממדים שדורגו.
 *
 * ממד שלא דורג פשוט אינו נספר: משרד שאינו יודע לשפוט את הדחיפות של
 * לקוח לא אמור להיות מחויב להמציא ציון, וציון מומצא הוא בדיוק מה
 * שהופך את כל המדידה לרעש.
 */
export function overallRatingScore(scores: Readonly<Record<string, number>>): number | null {
  const values = Object.values(scores).filter(
    (value) =>
      Number.isInteger(value) && value >= MIN_REFERRAL_RATING && value <= MAX_REFERRAL_RATING,
  );
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/**
 * תקינות דירוג רב-ממדי — הודעה בעברית או `null`.
 *
 * ממד שאינו בקטלוג נדחה ולא מתעלמים ממנו: ציון שנשמר תחת מפתח שאיש
 * אינו קורא הוא ציון שנעלם, והמדרג בטוח שהוא נספר.
 */
export function dimensionRatingRejectionReason(
  scores: Readonly<Record<string, number>>,
): string | null {
  const entries = Object.entries(scores);
  if (entries.length === 0) return "יש לדרג לפחות ממד אחד";
  for (const [key, value] of entries) {
    if (ratingDimension(key) === undefined) return `ממד לא מוכר: ${key}`;
    if (
      !Number.isInteger(value) ||
      value < MIN_REFERRAL_RATING ||
      value > MAX_REFERRAL_RATING
    ) {
      return `דירוג הוא מספר שלם בין ${MIN_REFERRAL_RATING} ל-${MAX_REFERRAL_RATING}`;
    }
  }
  return null;
}

/**
 * דיוק ההצהרה — **הציון שנכנס למוניטין המשרד המפנה.**
 *
 * מחושב מהפער הממוצע בין מה שהמפנה הצהיר לבין מה שהקולט אישר, על
 * הממדים ש**שני הצדדים** דירגו. ממד שרק צד אחד נגע בו אינו נספר:
 * אין ממה לגזור פער, וספירה שלו כאילו הפער אפס הייתה מתגמלת
 * הצהרה חלקית.
 *
 * הסקאלה 1..5, ולכן הפער המרבי הוא 4. הנוסחה `5 − פער ממוצע`
 * ממפה פער 0 לחמישה כוכבים ופער מרבי לכוכב אחד, כלומר לאותה
 * סקאלה שבה כל שאר הדירוגים במערכת — ואין צורך להסביר למשתמש
 * יחידה שנייה.
 *
 * `null` כשאין ולו ממד אחד משותף: זה אינו "ציון אפס" אלא היעדר
 * מדידה, והבחנה בין השניים היא ההבדל בין משרד גרוע למשרד חדש.
 */
export function declarationAccuracy(
  declared: Readonly<Record<string, number>>,
  confirmed: Readonly<Record<string, number>>,
): number | null {
  const perDimension = Object.values(dimensionAccuracies(declared, confirmed));
  if (perDimension.length === 0) return null;
  const sum = perDimension.reduce((total, value) => total + value, 0);
  return Math.round((sum / perDimension.length) * 10) / 10;
}

/**
 * דיוק ההצהרה **לכל ממד בנפרד** — הפירוט שמאחורי הציון האחד.
 *
 * ## למה זה נחוץ בנפרד מהממוצע
 *
 * ממוצע 3.5 יכול להיות משרד שסוטה מעט בכל ממד, ויכול להיות משרד
 * שמדייק לחלוטין ברצינות ובזמינות ומנפח בשיטתיות את התקציב. לקורא
 * זו אינה אותה עסקה: הראשון פשוט מעריך גס, והשני אומר משהו שאי
 * אפשר לסמוך עליו דווקא בשדה שקובע אם הליד שווה את המחיר.
 *
 * ## הנוסחה
 *
 * `5 − |הצהרה − אישור|` לכל ממד. שני הערכים שלמים בסקאלה 1..5,
 * ולכן התוצאה שלמה בין 1 ל-5 — אין כאן עיגול ואין אובדן דיוק,
 * וזו הסיבה שהיא נצברת כמו שהיא.
 *
 * ממד שרק צד אחד דירג אינו מופיע בתוצאה כלל. אין ממה לגזור פער,
 * וספירה שלו כאילו הפער אפס הייתה מתגמלת הצהרה חלקית.
 */
export function dimensionAccuracies(
  declared: Readonly<Record<string, number>>,
  confirmed: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const dimension of CLIENT_RATING_DIMENSIONS) {
    const a = declared[dimension.key];
    const b = confirmed[dimension.key];
    if (typeof a !== "number" || typeof b !== "number") continue;
    const accuracy = MAX_REFERRAL_RATING - Math.abs(a - b);
    // הפער המרבי הוא 4 ולכן התוצאה לעולם אינה יורדת מ-1; ההידוק הוא
    // הגנה על נתון פגום שנשמר לפני שהאימות היה קיים
    out[dimension.key] = Math.min(
      MAX_REFERRAL_RATING,
      Math.max(MIN_REFERRAL_RATING, accuracy),
    );
  }
  return out;
}

/**
 * תקינות ההערה בלבד.
 *
 * הציונים עצמם מאומתים ב-`dimensionRatingRejectionReason`. פיצול
 * ולא פונקציה אחת: ההערה נשלחת גם בלי ציונים חדשים.
 */
export function referralCommentRejectionReason(comment?: string): string | null {
  if ((comment?.trim().length ?? 0) > MAX_REFERRAL_RATING_COMMENT) {
    return `ההערה ארוכה מדי (עד ${MAX_REFERRAL_RATING_COMMENT} תווים)`;
  }
  return null;
}

/**
 * ממוצע דיוק ההצהרות של משרד — `null` כשעדיין אין על מה לדבר.
 *
 * הסכום מגיע **בעשיריות** (`referral_reputation.rating_sum`), ולכן
 * החלוקה במאה: `sum/count` נותן עשיריות, ועוד עשר מחזיר לכוכבים.
 * היחידה נשמרת שלמה לכל אורך הצבירה כדי שדלתאות לא יאבדו דיוק —
 * ראו `LeadReferralRating.scoreTenths`.
 */
export function referralRatingAverage(sumTenths: number, count: number): number | null {
  if (!Number.isFinite(sumTenths) || !Number.isFinite(count) || count <= 0) return null;
  return Math.round(sumTenths / count) / 10;
}

/**
 * הניסוח שמוצג ליד שם המשרד המפנה.
 *
 * **"דיוק ההצהרות" ולא "דירוג".** המספר אינו אומר כמה הלקוחות של
 * המשרד הזה טובים — הוא אומר כמה מה שהוא מצהיר עליהם התברר כנכון,
 * וזו השאלה היחידה שרלוונטית למי ששוקל לשלם עמלת הפניה על סמך
 * ההצהרה. ניסוח כללי היה נקרא כדירוג איכות ומוביל בדיוק למסקנה
 * ההפוכה על משרד שמצהיר ביושר על לקוח בינוני.
 *
 * מקבל **ממוצע** ולא סכום: המסך מקבל מהשרת ממוצע מוכן, והחישוב עצמו
 * (`referralRatingAverage`) שייך לצד שקורא את המונים. משרד בלי
 * אישורים אינו "0 מתוך 5" — הוא משרד חדש בלוח, וזו אמירה אחרת לגמרי.
 */
export function describeReferralRating(average: number | null, count: number): string {
  if (average === null || count <= 0) return "טרם אושרו הצהרות";
  return `דיוק ההצהרות ${average} מתוך ${MAX_REFERRAL_RATING} (${count} אישורים)`;
}
