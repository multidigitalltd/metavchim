/**
 * חשבונית מס קבלה — **המסמך שחייב לצאת על כל שקל שנכנס.**
 *
 * הפלטפורמה גובה מהמשרדים דרך קארדקום, וכל גבייה כזו מחייבת מסמך.
 * עד היום המסמכים הופקו ידנית במערכת החשבונות; מכאן והלאה הם נוצרים
 * אוטומטית בלינט על כל תשלום שנקלט.
 *
 * **סוג מסמך אחד בלבד: חשבונית מס קבלה.** אצלנו התשלום והמסמך הם
 * אותו אירוע — הכסף כבר נגבה בכרטיס האשראי כשהמסמך נוצר — ולכן אין
 * "חשבונית" שממתינה ל"קבלה" נפרדת. כל הלקוחות עוסקים החייבים במע"מ,
 * ולכן גם אין מסלול של מסמך פטור.
 *
 * ## למה החישוב כאן ולא אצל הספק
 *
 * הסכום שקארדקום גבה הוא **הסכום הסופי**, כולל מע"מ. מסמך שסכומו
 * שונה מהסכום שנגבה הוא מסמך שגוי — ולכן אנחנו מפרקים את הסכום
 * שנגבה למרכיביו במקום לתת לספק להוסיף מע"מ מעליו. הפירוק כאן,
 * בקוד משותף עם בדיקות, ולא בשדה שממלאים בטופס.
 */

/** שיעור המע"מ בישראל מינואר 2025. ניתן לשינוי בהגדרות הפלטפורמה. */
export const DEFAULT_VAT_PERCENT = 18;

export interface VatSplit {
  /** מה שנגבה בפועל — סכום המסמך. */
  grossAgorot: number;
  /** לפני מע"מ. */
  netAgorot: number;
  /** המע"מ שבתוך הסכום. */
  vatAgorot: number;
}

/**
 * פירוק סכום שנגבה למרכיביו.
 *
 * **העיגול על הנטו, והמע"מ הוא ההפרש** — ולא להפך. כך
 * `net + vat === gross` תמיד, בלי אגורה שנעלמת או נולדת בעיגול.
 * מסמך שסכום שורותיו אינו מסתכם בסכום שנגבה נדחה בבדיקת ההתאמה של
 * רואה החשבון, וזה בדיוק סוג הפער שמתגלה שנה אחרי.
 *
 * שיעור 0 מותר ומחזיר מע"מ אפס — לא שגיאה: הוא מה שיאפשר להתמודד
 * עם שינוי חקיקה בלי פריסה.
 */
export function vatSplitFromGross(grossAgorot: number, vatPercent: number): VatSplit {
  if (!Number.isFinite(grossAgorot) || grossAgorot < 0) {
    throw new Error("סכום לא תקין לחשבונית");
  }
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) {
    throw new Error("שיעור מע\"מ לא תקין");
  }
  const gross = Math.round(grossAgorot);
  const netAgorot = Math.round(gross / (1 + vatPercent / 100));
  return { grossAgorot: gross, netAgorot, vatAgorot: gross - netAgorot };
}

/** מה נקנה — הבסיס לשורת המסמך. */
export type InvoicePurpose = "subscription" | "credits" | "number_rental";

/**
 * תיאור השורה במסמך.
 *
 * זה מה שהמשרד יראה בחשבונית שלו, וגם מה שרואה החשבון שלו יראה.
 * לכן הוא מפרט **מה** ו**לאיזו תקופה** — "מנוי" לבדו אינו אומר דבר
 * שנה אחרי, כשמישהו מנסה להתאים תשלום למסמך.
 */
export function invoiceLineDescription(input: {
  purpose: InvoicePurpose;
  /** שם המסלול בעברית ("מקצועי"), לא הקוד. */
  planLabel?: string | undefined;
  billingCycle?: "monthly" | "yearly" | undefined;
  credits?: number | undefined;
  /** המספר שהושכר, בהשכרת מספר וירטואלי. */
  phone?: string | undefined;
}): string {
  if (input.purpose === "credits") {
    const credits = input.credits ?? 0;
    return `רכישת ${credits} קרדיטים — רשת שיתופי הפעולה`;
  }
  if (input.purpose === "number_rental") {
    return input.phone
      ? `השכרת מספר טלפון ${input.phone} — חודש`
      : "השכרת מספר טלפון — חודש";
  }
  const cycle = input.billingCycle === "yearly" ? "מנוי שנתי" : "מנוי חודשי";
  return input.planLabel ? `${cycle} — מסלול ${input.planLabel}` : cycle;
}

/**
 * כמה פעמים מנסים להפיק מסמך שנכשל.
 *
 * שש בהפרשים גדלים = כיסוי של יממה. תקלה אצל הספק נפתרת בדרך כלל
 * בתוך דקות, ומה שלא נפתר ביממה דורש אדם — ולכן אחרי המכסה המסמך
 * נשאר "נכשל" ומופיע במסך הפלטפורמה במקום להמשיך לנסות לנצח.
 */
export const INVOICE_MAX_ATTEMPTS = 6;

/** השהיה לפני הניסיון הבא, לפי מספר הניסיונות שכבר נעשו. */
export function invoiceRetryDelayMs(attempts: number): number {
  const minutes = [1, 5, 20, 60, 240, 720];
  const index = Math.min(Math.max(attempts, 0), minutes.length - 1);
  return (minutes[index] ?? 720) * 60 * 1000;
}

/**
 * מה חוסם הפקת מסמך — הודעה בעברית, או `null` כשמותר.
 *
 * שני החסמים הם אותו עיקרון: **מסמך יוצא רק על כסף שבאמת נכנס.**
 * תשלום שלא שולם אינו מסמך שממתין, והוא לא ינוסה שוב; תשלום בסכום
 * אפס (מסלול חינמי, קופון של 100%) אינו גבייה, ומסמך על אפס שקלים
 * רק מבלבל את המשרד ואת הספרים.
 */
export function invoiceRejectionReason(payment: {
  status: string;
  amountAgorot: number;
}): string | null {
  if (payment.status !== "paid") return "תשלום שטרם נגבה אינו מזכה במסמך";
  if (payment.amountAgorot <= 0) return "אין מסמך על סכום אפס";
  return null;
}
