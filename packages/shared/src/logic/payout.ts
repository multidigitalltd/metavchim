/**
 * משיכת כסף — **הצד שבו הפלטפורמה משלמת, ולא נגבית.**
 *
 * עד כה מסלול הכסף היה מספרים במסך ההגדרות שלא היה מאחוריהם דבר:
 * `settleReferral` ידע לחשב אותו, ו-`shareLead` העביר `"credits"`
 * קשיח כי "יתרה כספית ומשיכה עדיין לא קיימות". כאן הן קיימות.
 *
 * ## למה יתרה שנייה ולא המרה לקרדיטים
 *
 * קרדיט הוא אמצעי תשלום בתוך המערכת; שקל הוא התחייבות של הפלטפורמה
 * כלפי המשרד. ערבוב השניים באותו מספר היה אומר שכל קרדיט ניתן לפדיון
 * — כלומר שכל בונוס שהפלטפורמה מחלקת הוא חוב כספי. שני ספרים נפרדים
 * שומרים על ההבחנה: מי שבחר קרדיטים קיבל ערך פנימי, ומי שבחר כסף
 * קיבל חוב.
 *
 * ## הכסף יורד מהיתרה ברגע הבקשה
 *
 * ולא ברגע האישור. משרד שמבקש למשוך פעמיים את אותה יתרה לפני שהראשונה
 * טופלה היה מקבל אותה פעמיים, ואת זה מגלים אחרי ההעברה. דחייה מחזירה
 * את הסכום — היא תנועה משלה בספר, לא מחיקה של הקודמת.
 */

import type { PayoutMode } from "./credit-economy.js";

/**
 * מסלול תמורה על הפניה — הבחירה שנעשית ברגע הפרסום.
 *
 * הטיפוס עצמו חי ב-`credit-economy`, לצד `settleReferral` שמחשב את
 * החלוקה. כאן רק הרשימה והתוויות, כדי שלא ייווצרו שתי הגדרות
 * למסלולים שצריכות להישאר מסונכרנות.
 */
export const PAYOUT_MODES: readonly PayoutMode[] = ["credits", "cash"];

export const PAYOUT_MODE_LABEL: Record<PayoutMode, string> = {
  credits: "קרדיטים",
  cash: "כסף",
};

/**
 * מצבי בקשת משיכה.
 *
 * `approved` ו-`paid` נפרדים: אישור הוא החלטה, והעברה היא פעולה
 * בבנק שקורית אחר כך ועשויה להיכשל. מיזוגם היה אומר שהמסך מציג
 * "שולם" על כסף שטרם יצא.
 */
export const PAYOUT_STATUSES = ["pending", "approved", "paid", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  pending: "ממתינה לאישור",
  approved: "אושרה — ממתינה להעברה",
  paid: "שולמה",
  rejected: "נדחתה",
};

/** תנועות בספר הכספי. */
export const PAYOUT_LEDGER_KINDS = ["lead_sale", "withdrawal", "withdrawal_reversed"] as const;

export const MAX_PAYOUT_NOTE = 300;
export const MAX_PAYOUT_REFERENCE = 120;

/** תקרת שפיות לבקשה בודדת — הגנה מפני טעות הקלדה, לא מדיניות. */
export const MAX_PAYOUT_REQUEST_AGOROT = 10_000_000;

export interface BankDetails {
  /** שם בעל החשבון כפי שהוא מופיע בבנק. */
  holderName: string;
  /** קוד הבנק (10 = לאומי, 12 = הפועלים…). */
  bankCode: string;
  branch: string;
  accountNumber: string;
  /** ח.פ. או ע.מ. — ההעברה היא בין עוסקים, וכנגדה נדרשת חשבונית. */
  businessId: string;
}

/**
 * ספרת ביקורת של מספר זהות/ח.פ. ישראלי.
 *
 * לא פורמליות לשם פורמליות: ספרה שהוקלדה לא נכון בח.פ. מתגלה אצל
 * רואה החשבון חודשיים אחרי ההעברה, וההעברה עצמה כבר יצאה.
 */
export function isValidIsraeliBusinessId(raw: string): boolean {
  const digits = raw.replace(/\D/gu, "");
  if (digits.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const doubled = Number(digits[i]) * ((i % 2) + 1);
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** למה פרטי הבנק נדחים, או `null` כשהם תקינים. */
export function bankDetailsRejectionReason(details: BankDetails): string | null {
  if (details.holderName.trim().length < 2) return "שם בעל החשבון חסר";
  if (details.holderName.trim().length > 120) return "שם בעל החשבון ארוך מדי";
  if (!/^\d{1,3}$/u.test(details.bankCode.trim())) return "קוד הבנק אינו תקין";
  if (!/^\d{1,4}$/u.test(details.branch.trim())) return "מספר הסניף אינו תקין";
  if (!/^\d{4,12}$/u.test(details.accountNumber.trim())) return "מספר החשבון אינו תקין";
  if (!isValidIsraeliBusinessId(details.businessId)) {
    return "מספר ח.פ./ע.מ. אינו תקין — בדקו את הספרות";
  }
  return null;
}

/**
 * למה בקשת המשיכה נדחית, או `null` כשהיא תקינה.
 *
 * הסף המינימלי נאכף כאן ולא רק במסך: העברה בין עוסקים היא אירוע
 * חשבונאי עם עלות קבועה, והסף הוא מה שהופך אותה לכדאית. בקשה
 * שנשלחה בעקיפת המסך היא בדיוק המקרה שבו הוא חייב להיאכף.
 */
export function payoutRequestRejectionReason(
  amountAgorot: number,
  availableAgorot: number,
  minimumAgorot: number,
): string | null {
  if (!Number.isInteger(amountAgorot) || amountAgorot <= 0) {
    return "סכום המשיכה חייב להיות מספר חיובי";
  }
  if (amountAgorot > MAX_PAYOUT_REQUEST_AGOROT) return "סכום המשיכה גבוה מהסביר";
  if (amountAgorot > availableAgorot) {
    return `היתרה הזמינה למשיכה היא ${shekels(availableAgorot)} ₪`;
  }
  if (amountAgorot < minimumAgorot) {
    return `הסכום המינימלי למשיכה הוא ${shekels(minimumAgorot)} ₪`;
  }
  return null;
}

/** אגורות → שקלים מנוקדים, לטקסט שמוצג למשתמש. */
export function shekels(agorot: number): string {
  return (agorot / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

/**
 * מעברי המצב המותרים בבקשה.
 *
 * טבלה ולא `if`ים בשירות: המעבר האסור שאני הכי חושש ממנו הוא
 * `paid → paid` — אישור חוזר שמסמן העברה שנייה. כאן הוא פשוט אינו
 * ברשימה, וכל נתיב שמנסה אותו נעצר באותו מקום.
 */
const ALLOWED_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  pending: ["approved", "rejected"],
  approved: ["paid", "rejected"],
  paid: [],
  rejected: [],
};

export function payoutTransitionRejectionReason(from: PayoutStatus, to: PayoutStatus): string | null {
  if (ALLOWED_TRANSITIONS[from].includes(to)) return null;
  if (from === "paid") return "הבקשה כבר שולמה — אין לשנות אותה";
  if (from === "rejected") return "הבקשה נדחתה — אין לשנות אותה";
  return `אי אפשר לעבור מ"${PAYOUT_STATUS_LABEL[from]}" ל"${PAYOUT_STATUS_LABEL[to]}"`;
}

/**
 * מסכת מספר החשבון לתצוגה.
 *
 * מסך הפלטפורמה מציג רשימת בקשות, ואין סיבה שמספר חשבון מלא יישב
 * על המסך של מי שרק סוקר את התור. הוא נחשף רק בפתיחת הבקשה, ברגע
 * שבו מבצעים את ההעברה בפועל.
 */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/gu, "");
  if (digits.length <= 4) return "••••";
  return `••••${digits.slice(-4)}`;
}
