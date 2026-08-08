import { SetMetadata } from "@nestjs/common";
import type { Capability } from "@metavchim/shared";

export const IS_PUBLIC_KEY = "isPublic";
/** Endpoint ציבורי — ללא Session. שמור למינימום ההכרחי (login, health, דפי הצעה). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CAPABILITY_KEY = "requiredCapability";
/** הצהרת היכולת הנדרשת — נאכפת ב-CapabilityGuard על כל Handler לא-ציבורי. */
export const RequireCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);

export const ANY_AUTHENTICATED_KEY = "anyAuthenticated";
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
