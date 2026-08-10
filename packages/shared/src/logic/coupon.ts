/**
 * קודי קופון — הנחה או תקופה חינם בהצטרפות משרד חדש.
 *
 * שני סוגים בלבד, ובכוונה:
 *
 * - **`free_days`** — ימי ניסיון נוספים. נצרך **בהרשמה עצמה**, כי אין
 *   שם תשלום בכלל: המשרד נפתח כניסיון, וכל מה שהקופון עושה הוא להאריך
 *   אותו.
 * - **`percent`** — אחוז הנחה על התשלום. הוא **אינו** נצרך בהרשמה אלא
 *   בתשלום הראשון, שקורה מאוחר יותר ממסך המנוי. לכן התנאים נשמרים על
 *   הדייר ברגע המימוש, ולא נקראים מחדש מהקופון בזמן התשלום: קופון
 *   שנערך או בוטל בינתיים לא אמור לשנות את מה שכבר הובטח למי שנרשם.
 *
 * הקובץ הזה לא מדבר עם מסד ולא עם רשת — הוא רק מחליט. כל החלטה כאן
 * היא כזו שקל לטעות בה בשקט ולגלות אותה בחשבונית של לקוח.
 */

export type CouponKind = "percent" | "free_days";

export interface CouponDefinition {
  code: string;
  description: string;
  kind: CouponKind;
  /** ל-`percent`: 1–100. */
  percentOff: number | null;
  /** ל-`free_days`: מספר הימים שנוספים לניסיון. */
  freeDays: number | null;
  /** null = כל המסלולים. */
  planCode: string | null;
  /** null = בלי הגבלת כמות. */
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: Date | null;
  isActive: boolean;
}

/**
 * הצורה הקנונית של קוד.
 *
 * המשתמש מקליד "welcome 20", " Welcome-20 " או "WELCOME20", ומתכוון
 * לאותו דבר. בלי נרמול, קופון תקין נדחה בגלל רווח שנדבק בהדבקה —
 * והמשתמש מסיק שהקוד לא בתוקף. רק אותיות וספרות נשארות.
 */
export function normalizeCouponCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

/** למה הקופון לא חל — כל סיבה וההודעה שלה. */
export type CouponRejection =
  | "not_found"
  | "inactive"
  | "expired"
  | "exhausted"
  | "wrong_plan";

/**
 * האם הקופון חל, ואם לא — למה.
 *
 * `null` = חל. הבדיקה כאן היא **הבדיקה היחידה**: היא רצה גם כשהמסך
 * שואל "האם הקוד תקין" וגם ברגע המימוש עצמו, כדי ששתי התשובות לא
 * יוכלו להיפרד. קוד שנאמר למשתמש כתקין ונדחה בהרשמה גרוע מקוד
 * שנדחה מיד.
 */
export function couponRejection(
  coupon: CouponDefinition | null,
  input: { planCode: string; now: Date },
): CouponRejection | null {
  if (!coupon) return "not_found";
  if (!coupon.isActive) return "inactive";
  if (coupon.expiresAt !== null && coupon.expiresAt.getTime() <= input.now.getTime()) {
    return "expired";
  }
  if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions) {
    return "exhausted";
  }
  if (coupon.planCode !== null && coupon.planCode !== input.planCode) return "wrong_plan";
  return null;
}

/**
 * הודעות הדחייה — **כולן זהות חוץ מ"לא למסלול הזה"**.
 *
 * "הקוד אינו קיים", "פג תוקף" ו"נוצל במלואו" מוחלפות בהודעה אחת: מי
 * שמנחש קודים לא אמור ללמוד מהתשובה אם הקוד קיים בכלל. "לא למסלול
 * הזה" כן נאמר במפורש, כי הוא הסיבה היחידה שהמשתמש יכול לתקן בעצמו
 * — ובלעדיה הוא היה מנסה שוב ושוב את אותו קוד תקין.
 */
export function couponRejectionMessage(rejection: CouponRejection): string {
  if (rejection === "wrong_plan") return "הקוד אינו חל על המסלול שנבחר";
  return "הקוד אינו תקף";
}

/** מה הקופון נותן, בעברית — למסך ההרשמה ולמסך הניהול. */
export function describeCoupon(coupon: CouponDefinition): string {
  if (coupon.kind === "percent") {
    return `${coupon.percentOff}% הנחה על התשלום הראשון`;
  }
  const days = coupon.freeDays ?? 0;
  if (days % 30 === 0 && days >= 30) {
    const months = days / 30;
    return months === 1 ? "חודש נוסף חינם" : `${months} חודשים נוספים חינם`;
  }
  return `${days} ימי ניסיון נוספים`;
}

/**
 * המחיר אחרי ההנחה, באגורות.
 *
 * **עיגול כלפי מטה ורצפה של אפס.** עיגול כלפי מעלה גובה אגורה אחת
 * יותר ממה שהובטח, ומחיר שלילי היה הופך זיכוי לחיוב אצל הסולק.
 * 100% מייצר 0 — וזה מצב תקין שהקורא חייב לטפל בו: אין מה לשלוח
 * לסליקה, וצריך להפעיל את המנוי ישירות.
 */
export function discountedAgorot(fullAgorot: number, percentOff: number | null): number {
  if (percentOff === null || percentOff <= 0) return fullAgorot;
  const capped = Math.min(100, percentOff);
  return Math.max(0, Math.floor((fullAgorot * (100 - capped)) / 100));
}

/**
 * האם הגדרת הקופון עצמה תקינה — לפני שהיא נשמרת.
 *
 * `null` = תקינה. הבדיקה כאן ולא רק ב-zod, כי חלק מהכללים הם יחסים
 * בין שדות: קופון `percent` בלי אחוז הוא קופון שלא נותן דבר, ומי
 * שיצר אותו יגלה את זה רק כשלקוח יתלונן.
 */
export function couponDefinitionRejection(input: {
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  freeDays: number | null;
  maxRedemptions: number | null;
}): string | null {
  if (normalizeCouponCode(input.code).length < 3) {
    return "הקוד חייב לכלול לפחות שלוש אותיות או ספרות";
  }
  if (input.kind === "percent") {
    if (input.percentOff === null || input.percentOff < 1 || input.percentOff > 100) {
      return "אחוז ההנחה חייב להיות בין 1 ל-100";
    }
  } else {
    if (input.freeDays === null || input.freeDays < 1 || input.freeDays > 730) {
      return "מספר ימי החינם חייב להיות בין 1 ל-730";
    }
  }
  if (input.maxRedemptions !== null && input.maxRedemptions < 1) {
    return "מגבלת השימושים חייבת להיות לפחות 1";
  }
  return null;
}
