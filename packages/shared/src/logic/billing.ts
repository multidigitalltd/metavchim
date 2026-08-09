/**
 * מנוי בתשלום — מחיר, תקופה, וגישה.
 *
 * הקובץ הזה לא מדבר עם קארדקום ולא נוגע בבסיס נתונים. הוא עונה על
 * שלוש שאלות שחוזרות בשלושה מקומות שונים — הבקר שיוצר את התשלום,
 * הוובהוק שמאשר אותו, והמסך שמציג למשרד מה מצבו: **כמה זה עולה**,
 * **עד מתי זה בתוקף**, ו**האם מותר לעבוד**.
 *
 * שלוש גרסאות של "עד מתי" היו נפרדות ביום הראשון של החודש הקצר.
 */

import type { PlanDefinition } from "./plans.js";

/** מחזור החיוב. אין "שבועי" ואין "רבעוני" — לא נמכרים. */
export type BillingCycle = "monthly" | "yearly";

/**
 * מצב המנוי.
 *
 * `trial` הוא מצב אמיתי ולא היעדר מנוי: משרד בניסיון עובד במלוא
 * היכולות. `past_due` הוא תקופה ששולמה והסתיימה בלי חידוש — הוא נפרד
 * מ-`cancelled` כי המשרד לא ביקש לעזוב, והיחס אליו שונה.
 */
export type SubscriptionStatus = "trial" | "active" | "past_due" | "cancelled";

export const BILLING_CYCLES: readonly BillingCycle[] = ["monthly", "yearly"];

export function isBillingCycle(value: string): value is BillingCycle {
  return (BILLING_CYCLES as readonly string[]).includes(value);
}

/**
 * המחיר של המסלול במחזור הנבחר, באגורות.
 *
 * `null` פירושו **שהמסלול אינו נמכר במחזור הזה** — לא "חינם". מסלול
 * בלי מחיר שנתי הוא מסלול שרכישה שנתית שלו צריכה להידחות, ולא כזה
 * שתעבור בסכום 0.
 */
export function cyclePriceAgorot(plan: PlanDefinition, cycle: BillingCycle): number | null {
  if (cycle === "yearly") return plan.yearlyPriceAgorot;
  return plan.monthlyPriceAgorot > 0 ? plan.monthlyPriceAgorot : null;
}

/** מספר הימים בחודש — לטיפול ב-31 בחודש קצר. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * סוף התקופה אחרי תשלום.
 *
 * שני דברים שקל לפספס:
 *
 * 1. **ההארכה היא מהמאוחר מבין "עכשיו" לבין הסוף הנוכחי.** משרד
 *    שמשלם שבוע לפני שהמנוי נגמר לא מוותר על השבוע ההוא. חישוב
 *    מ"עכשיו" בלבד היה גובה תשלום מלא ומקצר את התקופה בפועל.
 *
 * 2. **31 בינואר ועוד חודש הוא 28/29 בפברואר, לא 3 במרץ.** הוספה
 *    נאיבית של חודש גולשת לחודש הבא ומזיזה את יום החיוב לתמיד: כל
 *    חידוש דוחף אותו עוד קצת.
 */
export function nextPeriodEnd(
  currentEnd: Date | null | undefined,
  now: Date,
  cycle: BillingCycle,
): Date {
  const base =
    currentEnd instanceof Date && !Number.isNaN(currentEnd.getTime()) && currentEnd > now
      ? currentEnd
      : now;

  const months = cycle === "yearly" ? 12 : 1;
  const year = base.getUTCFullYear();
  const monthIndex = base.getUTCMonth() + months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(base.getUTCDate(), daysInMonth(targetYear, targetMonth));

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/**
 * האם המנוי מקנה גישה כרגע.
 *
 * `cancelled` עדיין מקנה גישה עד סוף התקופה ששולמה — זו לא נדיבות
 * אלא מה שכתוב בתנאי השימוש, והמשרד שילם עליה.
 *
 * תאריך חסר במצב `active` נקרא כ"יש גישה" ולא כ"נעול": שדה שלא
 * התמלא הוא תקלה שלנו, ונעילת משרד משלם בגללה גרועה מהמשך עבודה של
 * משרד שתקופתו הסתיימה.
 */
export function subscriptionGrantsAccess(
  status: SubscriptionStatus,
  currentPeriodEnd: Date | string | null | undefined,
  now: Date,
): boolean {
  if (status === "trial") return true;
  if (status === "past_due") return false;
  if (currentPeriodEnd === null || currentPeriodEnd === undefined) return true;
  const end =
    currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return true;
  return end > now;
}

/** ברירת המחדל של החלון שבו מזכירים שהחידוש מתקרב. */
export const RENEWAL_WARN_WITHIN_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * כמה ימים נותרו לתקופה. מעוגל כלפי מעלה, מאותה סיבה כמו בניסיון:
 * "0 ימים" נקרא כאילו זה כבר נגמר.
 */
export function periodDaysLeft(
  currentPeriodEnd: Date | string | null | undefined,
  now: Date,
): number | null {
  if (currentPeriodEnd === null || currentPeriodEnd === undefined) return null;
  const end = currentPeriodEnd instanceof Date ? currentPeriodEnd : new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
}

/** האם להציג תזכורת חידוש — רק בחלון האחרון, אחרת זה רעש קבוע. */
export function shouldWarnAboutRenewal(
  status: SubscriptionStatus,
  currentPeriodEnd: Date | string | null | undefined,
  now: Date,
  withinDays: number = RENEWAL_WARN_WITHIN_DAYS,
): boolean {
  if (status !== "active") return false;
  const days = periodDaysLeft(currentPeriodEnd, now);
  return days !== null && days <= withinDays;
}

/** תיאור המחזור בעברית — לכפתור ולחשבונית. */
export function describeCycle(cycle: BillingCycle): string {
  return cycle === "yearly" ? "שנתי" : "חודשי";
}

/**
 * מה שכתוב על הכפתור: "‎199 ₪ לחודש".
 *
 * `null` כשהמסלול אינו נמכר במחזור הזה — הקורא אמור לא להציג כפתור
 * בכלל, ולא להציג כפתור בסכום ריק.
 */
export function describeCyclePrice(plan: PlanDefinition, cycle: BillingCycle): string | null {
  const agorot = cyclePriceAgorot(plan, cycle);
  if (agorot === null || agorot <= 0) return null;
  const shekels = agorot / 100;
  const rounded = Number.isInteger(shekels) ? shekels : Number(shekels.toFixed(2));
  return `${rounded.toLocaleString("he-IL")} ₪ ${cycle === "yearly" ? "לשנה" : "לחודש"}`;
}

/**
 * האם אפשר לפתוח תשלום על המסלול הזה — הודעה בעברית או `null`.
 *
 * הבדיקה כאן ולא רק במסך, כי קוד המסלול והמחזור מגיעים מהדפדפן.
 * "לא מוצג" אינו אכיפה: בלי הבדיקה הזו אפשר היה לשלוח את הקוד של
 * מסלול הרשת ולקבל עבורו דף תשלום.
 */
export function checkoutRejectionReason(
  plan: PlanDefinition | undefined,
  cycle: string,
): string | null {
  if (!plan) return "המסלול אינו קיים";
  if (!isBillingCycle(cycle)) return "מחזור חיוב לא מוכר";
  if (!plan.isPublic) return "המסלול אינו נמכר באופן עצמאי — פנו אלינו";
  const agorot = cyclePriceAgorot(plan, cycle);
  if (agorot === null) {
    return cycle === "yearly"
      ? "המסלול נמכר בחיוב חודשי בלבד"
      : "למסלול אין מחיר חודשי מוגדר";
  }
  // סכום אפס היה יוצר דף תשלום שנסגר מיד ומפעיל מנוי בלי תשלום
  if (agorot <= 0) return "למסלול אין מחיר — פנו אלינו";
  return null;
}

/** תיאור המצב למשתמש — מה שמופיע בראש מסך החיוב. */
export function describeSubscription(
  status: SubscriptionStatus,
  daysLeft: number | null,
): string {
  if (status === "trial") return "תקופת ניסיון";
  if (status === "cancelled") {
    if (daysLeft !== null && daysLeft > 0) return `בוטל — השירות זמין עוד ${daysLeft} ימים`;
    return "המנוי בוטל";
  }
  if (status === "past_due") return "המנוי הסתיים — נדרש חידוש";
  if (daysLeft === null) return "מנוי פעיל";
  if (daysLeft <= 0) return "המנוי הסתיים — נדרש חידוש";
  if (daysLeft === 1) return "מנוי פעיל — מתחדש מחר";
  return `מנוי פעיל — מתחדש בעוד ${daysLeft} ימים`;
}
