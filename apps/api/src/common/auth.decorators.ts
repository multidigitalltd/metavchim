import { SetMetadata } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";

export const IS_PUBLIC_KEY = "isPublic";
/** Endpoint ציבורי — ללא Session. שמור למינימום ההכרחי (login, health, דפי הצעה). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CAPABILITY_KEY = "requiredCapability";
/**
 * הצהרת היכולת הנדרשת — נאכפת ב-AuthGuard על כל Handler לא-ציבורי.
 *
 * אפשר להצהיר על **כמה יכולות, ואז מספיקה אחת מהן**. זה נדרש למסך
 * אחד שנכנסים אליו משני כיוונים: חדר העסקה נפתח גם למי שפרסם נכס
 * (`collaboration.share`) וגם למי שהציע עליו (`collaboration.offer`),
 * ושתי היכולות ניתנות בנפרד. יכולת שלישית ייעודית הייתה כבויה
 * בברירת המחדל אצל כל משרד קיים — כלומר החדר היה נסגר בפני כולם
 * ביום שהוא נולד.
 *
 * זו הקלה בהיקף ולא בעיקרון: כל נתיב עדיין מצהיר במפורש מי רשאי
 * להגיע אליו, ובדיקת auth-coverage ממשיכה לאכוף שההצהרה קיימת.
 */
export const RequireCapability = (
  ...capabilities: readonly [Capability, ...Capability[]]
) => SetMetadata(CAPABILITY_KEY, capabilities);

const ANY_AUTHENTICATED_KEY = "anyAuthenticated";
/**
 * "כל מי שמחובר, בלי יכולת מסוימת" — הצהרה מפורשת, לא השמטה.
 *
 * ה-AuthGuard כבר דורש Session מכל נתיב שאינו @Public, ולכן נתיב בלי
 * @RequireCapability *עובד* — וזו בדיוק הבעיה: אי אפשר להבדיל בין
 * "פתוח בכוונה לכל סוכן" לבין "נשכח". הסימון הזה עושה את ההבחנה,
 * ובדיקת auth-coverage.test.ts נופלת על נתיב שאין לו אף אחד מהשלושה.
 *
 * מיועד לנתיבים שכל תוכנם נגזר מהמשתמש עצמו (הפרופיל שלו, ההתראות
 * שלו, מוני הניווט שלו) — לא לנתיב שמחזיר נתוני משרד.
 */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);

export const PLATFORM_ADMIN_KEY = "platformAdmin";
/**
 * מסך הפלטפורמה — מעל כל הדיירים (הקמת משרדים, הגדרות מערכת, גיבויים
 * ועדכון גרסה על המכונה). ההרשאה נאכפת ב-PlatformAdminGuard.
 */
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

export const BILLING_ALLOWED_KEY = "billingAllowed";
/**
 * נתיב שנשאר פתוח גם למשרד שתקופתו נגמרה.
 *
 * משרד כזה מתחבר אבל אינו רשאי לעבוד — הוא רואה את מסך המנוי בלבד.
 * הסימון הזה הוא רשימת ההיתר: מה שהוא צריך כדי לשלם ולצאת מהמצב.
 * הכול חוץ ממנו מוחזר עם 402, וה-web מפנה למסך המנוי.
 *
 * להוסיף כאן רק מה שנדרש כדי **לשלם** או **לצאת** — לא נתיב שמחזיר
 * נתוני עבודה. משרד שתקופתו נגמרה לא אמור לקרוא את רשימת הנכסים
 * שלו דרך נתיב שנשאר פתוח בהיסח הדעת.
 */
export const BillingAllowed = () => SetMetadata(BILLING_ALLOWED_KEY, true);
