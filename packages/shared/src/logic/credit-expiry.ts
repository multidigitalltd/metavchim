/**
 * תפוגת קרדיטים — **הנהלת חשבונות של מנות, לא חיסור מהיתרה.**
 *
 * ההגדרה "תוקף קרדיט בחודשים" הייתה קיימת במסך הפלטפורמה מהיום
 * הראשון, ומעולם לא נאכפה. הסיבה לא הייתה עצלות: הפקעה נכונה דורשת
 * לדעת **איזה** קרדיט פג, ו-`credit_ledger` הוא ספר תנועות שהיתרה
 * בו נגזרת מסכום — אין בו "מנות".
 *
 * הפתרון כאן הוא לשחזר את המנות מהספר עצמו, בלי לשנות את המבנה:
 * כל תנועה חיובית היא **מנה** עם תאריך תפוגה משלה, וכל תנועה שלילית
 * צורכת מהמנות לפי סדר. הספר נשאר Append-Only, וההפקעה עצמה נכתבת
 * כתנועה שלילית רגילה עם `kind = "expiry"` — כלומר גם היא מבוקרת,
 * הפיכה בקריאה, ומופיעה בהיסטוריה של המשרד.
 *
 * ## שני כללים שמגנים על המשרד
 *
 * **1. מה שנקנה בכסף אינו פג.** קרדיט שמשרד שילם עליו הוא ערך שנרכש
 * מראש; הפקעתו היא חילוט. פגים רק מענק פתיחה ותמורה על הפניות —
 * ערך שהמשרד קיבל ולא שילם עליו. ההגדרה במסך אומרת זאת במפורש.
 *
 * **2. הפקעה לעולם אינה רטרואקטיבית.** אילו היינו "מפקיעים" מנה
 * ברגע שפג תוקפה בזמן השחזור, קנייה שהמערכת אישרה בעבר הייתה
 * הופכת בדיעבד ליתרה שלילית. לכן החיוב צורך את מה שהיה זמין **בזמנו**,
 * וההפקעה חלה רק על מה שנשאר ברגע הסריקה.
 *
 * ## סדר הצריכה
 *
 * הקרוב לפוג נצרך ראשון. זה הכלל שמפקיע הכי מעט: צריכת מנה שלא
 * הייתה פגה, בזמן שמנה קרובה לפוג יושבת בצד, היא בזבוז של ערך
 * שהמשרד היה יכול לנצל.
 */

/** תנועה בספר, כפי שהיא נקראת מהמסד. */
export interface CreditLedgerEntry {
  id: string;
  kind: string;
  amount: number;
  refId: string | null;
  createdAt: Date;
}

/** ה-`kind` של תנועת ההפקעה. שלילית, ומצביעה על המנה שפגה ב-`refId`. */
export const EXPIRY_KIND = "expiry";

/**
 * הזיכויים שפגים.
 *
 * `purchase` ו-`refund` אינם ברשימה בכוונה — ראו הכלל הראשון למעלה.
 */
export const EXPIRING_CREDIT_KINDS: readonly string[] = ["initial_grant", "lead_sale"];

/** כמה ימים לפני התפוגה מתריעים. */
export const EXPIRY_WARNING_DAYS = 30;

/** מנה משוחזרת — זיכוי אחד ומה שנותר ממנו. */
export interface CreditBatch {
  /** מזהה התנועה שיצרה את המנה. */
  id: string;
  kind: string;
  createdAt: Date;
  /** `null` = אינה פגה לעולם (נרכשה בכסף, או שהתפוגה כבויה). */
  expiresAt: Date | null;
  /** הזיכוי המקורי. */
  amount: number;
  remaining: number;
}

/** מנה שיש לגביה מה לעשות — להפקיע עכשיו, או להתריע עליה. */
export interface BatchAction {
  batchId: string;
  amount: number;
  expiresAt: Date;
}

export interface ExpiryPlan {
  /** המנות אחרי השחזור, לפי סדר יצירה. */
  batches: CreditBatch[];
  /** היתרה הנגזרת — זהה לסכום הספר. */
  balance: number;
  /** מה להפקיע עכשיו. ריק = אין מה לעשות. */
  expire: BatchAction[];
  /** מה עומד לפוג בתוך חלון האזהרה, ועדיין לא פג. */
  expiringSoon: BatchAction[];
}

/**
 * הוספת חודשים לתאריך, עם קיצוץ לסוף החודש.
 *
 * 31 בינואר ועוד חודש הוא 28 בפברואר ולא 3 במרץ. `setMonth` בג׳אווה
 * סקריפט גולש קדימה בשקט, וגלישה כזו הייתה מאריכה תוקף בימים בודדים
 * בכל שנה — מספיק כדי שהמספרים לא יסתדרו עם מה שהמסך הבטיח.
 */
export function addMonths(from: Date, months: number): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const day = from.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/** סדר הצריכה: הקרוב לפוג ראשון, ומה שאינו פג — אחרון. */
function consumptionOrder(a: CreditBatch, b: CreditBatch): number {
  if (a.expiresAt === null && b.expiresAt === null) {
    return a.createdAt.getTime() - b.createdAt.getTime();
  }
  if (a.expiresAt === null) return 1;
  if (b.expiresAt === null) return -1;
  const diff = a.expiresAt.getTime() - b.expiresAt.getTime();
  return diff !== 0 ? diff : a.createdAt.getTime() - b.createdAt.getTime();
}

/**
 * שחזור המנות מהספר, ומה שצריך להיכתב עכשיו.
 *
 * `expiryMonths === 0` = ללא תפוגה. במקרה הזה שום מנה אינה מקבלת
 * תאריך, והתוכנית תמיד ריקה — כולל למשרדים שכבר צברו יתרה. כיבוי
 * ההגדרה חייב להיות מיידי ומלא, אחרת "ביטלתי את התפוגה" אינו נכון.
 */
export function planCreditExpiry(
  entries: readonly CreditLedgerEntry[],
  expiryMonths: number,
  now: Date,
): ExpiryPlan {
  const sorted = [...entries].sort((a, b) => {
    const diff = a.createdAt.getTime() - b.createdAt.getTime();
    // ULID עולה עם הזמן — שובר שוויון יציב כששתי תנועות חולקות חותמת
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  const batches: CreditBatch[] = [];
  const byId = new Map<string, CreditBatch>();

  for (const entry of sorted) {
    if (entry.kind === EXPIRY_KIND) {
      /*
       * הפקעה שכבר נכתבה מבטלת מנה מסוימת ואינה צורכת FIFO — היא
       * לא "הוצאה" של המשרד. בלי הטיפול הנפרד הזה היא הייתה נוגסת
       * במנה הקרובה לפוג, כלומר מפקיעה פעמיים.
       */
      const target = entry.refId === null ? undefined : byId.get(entry.refId);
      if (target) target.remaining = Math.max(0, target.remaining + entry.amount);
      continue;
    }
    if (entry.amount > 0) {
      const expires =
        expiryMonths > 0 && EXPIRING_CREDIT_KINDS.includes(entry.kind)
          ? addMonths(entry.createdAt, expiryMonths)
          : null;
      const batch: CreditBatch = {
        id: entry.id,
        kind: entry.kind,
        createdAt: entry.createdAt,
        expiresAt: expires,
        amount: entry.amount,
        remaining: entry.amount,
      };
      batches.push(batch);
      byId.set(batch.id, batch);
      continue;
    }
    /*
     * חיוב. נצרך מהמנות לפי סדר התפוגה — כולל ממנות שכבר פגו
     * ברגע החיוב, אם טרם הופקעו: המערכת אישרה את הקנייה, ואין
     * להפוך אותה בדיעבד לחוב.
     */
    let left = -entry.amount;
    for (const batch of [...batches].sort(consumptionOrder)) {
      if (left === 0) break;
      const take = Math.min(batch.remaining, left);
      batch.remaining -= take;
      left -= take;
    }
    /*
     * `left > 0` = חיוב שירד מתחת לאפס. אין מנה לחייב, והיתרה
     * הכוללת תשקף את החוסר — בדיוק כמו לפני השינוי הזה.
     */
  }

  const balance = sorted.reduce((sum, e) => sum + e.amount, 0);
  const warnFrom = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

  const expire: BatchAction[] = [];
  const expiringSoon: BatchAction[] = [];
  for (const batch of batches) {
    if (batch.expiresAt === null || batch.remaining <= 0) continue;
    if (batch.expiresAt <= now) {
      expire.push({ batchId: batch.id, amount: batch.remaining, expiresAt: batch.expiresAt });
    } else if (batch.expiresAt <= warnFrom) {
      expiringSoon.push({ batchId: batch.id, amount: batch.remaining, expiresAt: batch.expiresAt });
    }
  }

  return { batches, balance, expire, expiringSoon };
}

/** ניסוח ההתראה על קרדיטים שעומדים לפוג. */
export function expiryWarningText(
  actions: readonly BatchAction[],
  now: Date,
): { title: string; body: string } {
  const total = actions.reduce((sum, a) => sum + a.amount, 0);
  const soonest = actions.reduce(
    (min, a) => (a.expiresAt < min ? a.expiresAt : min),
    actions[0]!.expiresAt,
  );
  const days = Math.max(1, Math.ceil((soonest.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  return {
    title: `${total} קרדיטים עומדים לפוג`,
    body:
      days === 1
        ? `${total} קרדיטים פגים מחר. אפשר לנצל אותם לרכישת ליד או להצעת נכס בלוח השת"פ.`
        : `${total} קרדיטים פגים בעוד ${days} ימים. אפשר לנצל אותם לרכישת ליד או להצעת נכס בלוח השת"פ.`,
  };
}
