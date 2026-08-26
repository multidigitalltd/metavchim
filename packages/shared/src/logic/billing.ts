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
import { formatIsraeliNumber } from "./israel-time.js";

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

const DAY_MS = 86_400_000;

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

/** מחיר מוסכם למשרד יחיד. `null` בשדה = אין חריגה, כלומר מחיר המסלול. */
export interface TenantPriceOverride {
  monthlyAgorot: number | null;
  yearlyAgorot: number | null;
}

/**
 * המחיר שהמשרד הזה משלם בפועל.
 *
 * **חייבת להיקרא בכל מקום שגובה כסף** — פתיחת תשלום *וגם* חידוש
 * אוטומטי. מחיר מוסכם שחל רק באחד מהם הוא הבטחה שנשברת בחודש
 * השני, וזו תקלת חיוב שמגיעה ללקוח ולא אלינו.
 *
 * `null` בחריגה = אין חריגה ⇒ מחיר המסלול. הבדיקה היא על `null`
 * מפורש ולא על „falsy”, כי אחרת כל סכום היה נבלע.
 *
 * **מחיר מוסכם פותח גם מחזור שהמסלול אינו נמכר בו.** משרד שסוכם
 * איתו על מחיר שנתי במסלול שנמכר חודשית הוא בדיוק המקרה שהחריגה
 * נועדה לו, ובלי זה הוא היה נדחה בשער למרות שהמחיר קיים.
 */
export function effectiveCyclePriceAgorot(
  plan: PlanDefinition,
  cycle: BillingCycle,
  override?: TenantPriceOverride,
): number | null {
  const agreed = cycle === "yearly" ? override?.yearlyAgorot : override?.monthlyAgorot;
  if (agreed !== undefined && agreed !== null) return agreed;
  return cyclePriceAgorot(plan, cycle);
}

/** מספר הימים בחודש — לטיפול ב-31 בחודש קצר. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * סוף התקופה אחרי תשלום.
 *
 * שלושה דברים שקל לפספס:
 *
 * 1. **ההארכה היא מהמאוחר מבין "עכשיו" לבין הסוף הנוכחי.** משרד
 *    שמשלם שבוע לפני שהמנוי נגמר לא מוותר על השבוע ההוא. חישוב
 *    מ"עכשיו" בלבד היה גובה תשלום מלא ומקצר את התקופה בפועל.
 *
 * 2. **31 בינואר ועוד חודש הוא 28/29 בפברואר, לא 3 במרץ.** הוספה
 *    נאיבית של חודש גולשת לחודש הבא ומזיזה את יום החיוב לתמיד: כל
 *    חידוש דוחף אותו עוד קצת.
 *
 * 3. **`anchorDay` הוא יום החיוב המקורי, ובלעדיו הקיצור של סעיף 2
 *    הופך לקבוע.** מנוי שנפתח ב-31 בינואר נגמר ב-28 בפברואר —
 *    ומכאן, בלי עוגן, החישוב הבא יוצא מ-28 ומגיע ל-28 במרץ במקום
 *    ל-31. שלושה ימים בכל חודש, לתמיד. העוגן נקבע פעם אחת ביצירת
 *    המנוי ואינו נגזר מהתאריך המקוצר (ביקורת Codex).
 */
export function nextPeriodEnd(
  currentEnd: Date | null | undefined,
  now: Date,
  cycle: BillingCycle,
  anchorDay?: number | null,
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

  const wanted =
    typeof anchorDay === "number" && Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
      ? anchorDay
      : base.getUTCDate();
  const day = Math.min(wanted, daysInMonth(targetYear, targetMonth));

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
 * יום החיוב שנקבע למנוי — נשמר פעם אחת ואינו מחושב מחדש.
 *
 * נגזר מרגע התשלום הראשון, כי זה מה שהמשרד מצפה לו: "שילמתי ב-31,
 * החיוב שלי ב-31".
 */
export function billingAnchorDay(firstPeriodStart: Date): number {
  return firstPeriodStart.getUTCDate();
}

/**
 * חלון החסד בין סוף התקופה לבין סגירת הגישה.
 *
 * הוא קיים בגלל סדר הפעולות: החיוב החוזר נבדק **אחרי** שהתקופה
 * נגמרה, ובמרווח שבין הרגע הזה לבין הריצה הבאה של הסורק המשרד היה
 * נעול בחוץ — כלומר כל משרד משלם, בכל מחזור, למשך עד שעה. חלון החסד
 * הופך את סוף התקופה לרגע שבו **מנסים לחייב**, ולא לרגע שבו נועלים.
 *
 * הוא גם מה שמאפשר לכרטיס שפג תוקפו להיפתר בעדכון פרטים במקום
 * בהשבתה.
 */
export const BILLING_GRACE_DAYS = 3;

/**
 * עד מתי הגישה פתוחה בפועל, בהינתן סוף תקופה ששולמה.
 *
 * פונקציה אחת ולא חישוב בשני מקומות: התשלום הראשון והחידוש כתבו
 * ערכים שונים ל-`paid_until`, ורק אחד מהם כלל את חלון החסד.
 */
export function accessUntil(periodEnd: Date): Date {
  return new Date(periodEnd.getTime() + BILLING_GRACE_DAYS * DAY_MS);
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
  return `${formatIsraeliNumber(rounded)} ₪ ${cycle === "yearly" ? "לשנה" : "לחודש"}`;
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
  /*
   * המחיר המוסכם נכנס **גם לשער ולא רק לחישוב**. משרד שסוכם איתו
   * מחיר במחזור שהמסלול אינו נמכר בו, או במסלול שאינו ציבורי, הוא
   * בדיוק המקרה שהחריגה נועדה לו — ובלי זה הוא היה נדחה כאן למרות
   * שהמחיר קיים ומוסכם.
   */
  override?: TenantPriceOverride,
): string | null {
  if (!plan) return "המסלול אינו קיים";
  if (!isBillingCycle(cycle)) return "מחזור חיוב לא מוכר";
  const agorot = effectiveCyclePriceAgorot(plan, cycle, override);
  const agreed = cycle === "yearly" ? override?.yearlyAgorot : override?.monthlyAgorot;
  if (!plan.isPublic && (agreed === undefined || agreed === null)) {
    return "המסלול אינו נמכר באופן עצמאי — פנו אלינו";
  }
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
