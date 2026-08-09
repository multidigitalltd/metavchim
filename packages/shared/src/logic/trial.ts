/**
 * תקופת הניסיון — מתי היא נגמרת, ומתי להזהיר.
 *
 * החישוב כאן ולא במסך, כי אותו כלל צריך לחול בשלושה מקומות: הבאנר
 * שמזהיר, אימות ה-Session שנועל, והמייל שנשלח. שלוש גרסאות של "כמה
 * ימים נשארו" היו נפרדות ביום שהאחת מעגלת כלפי מעלה והשנייה כלפי
 * מטה.
 */

/** ברירת המחדל של החלון שבו מזהירים לפני הנעילה. */
export const TRIAL_WARN_WITHIN_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * כמה ימים נותרו לניסיון.
 *
 * מעוגל **כלפי מעלה**: מי שנשארו לו שעתיים צריך לראות "נשאר יום"
 * ולא "נשארו 0 ימים", שנקרא כאילו זה כבר נגמר. ערך שלילי או אפס
 * פירושו שהתקופה חלפה.
 *
 * `null` = אין תפוגה, וזה המצב של כל משרד משלם.
 */
export function trialDaysLeft(trialEndsAt: Date | string | null | undefined, now: Date): number | null {
  if (trialEndsAt === null || trialEndsAt === undefined) return null;
  const end = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  if (Number.isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
}

/** האם התקופה חלפה — התשובה שמובילה לנעילה. */
export function isTrialExpired(
  trialEndsAt: Date | string | null | undefined,
  now: Date,
): boolean {
  const days = trialDaysLeft(trialEndsAt, now);
  return days !== null && days <= 0;
}

/** האם להציג את האזהרה — רק בחלון האחרון, אחרת הבאנר הופך לרעש. */
export function shouldWarnAboutTrial(
  trialEndsAt: Date | string | null | undefined,
  now: Date,
  withinDays: number = TRIAL_WARN_WITHIN_DAYS,
): boolean {
  const days = trialDaysLeft(trialEndsAt, now);
  return days !== null && days <= withinDays;
}

/** הניסוח שמוצג — כולל הצורה המיוחדת של יום אחד. */
export function describeTrialLeft(days: number): string {
  if (days <= 0) return "תקופת הניסיון הסתיימה";
  if (days === 1) return "נשאר יום אחד לתקופת הניסיון";
  return `נשארו ${days} ימים לתקופת הניסיון`;
}
