import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { loadEnv } from "../config/env";

/**
 * בדיקת מקור על בקשות שמשנות מצב — **שכבה שנייה מול CSRF.**
 *
 * ההגנה הראשונה היא `SameSite=Lax` על עוגיית ה-Session: דפדפן לא
 * ישלח אותה ב-POST חוצה-אתרים. זו הגנה טובה, והיא גם ההגנה **היחידה**
 * שהייתה כאן — וזה בדיוק סוג המצב שביקורת אבטחה מסמנת. `Lax` נסמך
 * על התנהגות הדפדפן, ויש לו חורים ידועים: תת-דומיין שנפרץ נחשב
 * same-site, ודפדפנים ישנים אוכפים אחרת.
 *
 * הבדיקה כאן אינה נסמכת על אף אחד מהם: השרת מכיר את המקור החוקי
 * שלו, ובקשה משנה-מצב שמצהירה על מקור אחר נדחית. זו בדיקה בעלות
 * אפס שאינה יכולה להיכשל פתוח.
 *
 * ## מה **לא** נבדק כאן, ולמה
 *
 * בקשות בלי `Origin` ובלי `Referer` עוברות. אלה בקשות שאינן מגיעות
 * מדפדפן — כלי שורת פקודה, קליינט מובייל, בדיקה — ואין להן עוגייה
 * אלא אם מישהו שם אותה שם במפורש, כלומר הן אינן CSRF. חסימתן הייתה
 * שוברת כל אינטגרציה לגיטימית בלי להוסיף ביטחון.
 *
 * נתיבים ציבוריים (וובהוקים, חתימה על הסכם, צפייה בהצעה) אינם
 * נסמכים על עוגיית Session ולכן אינם חשופים ל-CSRF; הם מזוהים
 * מראש ומדולגים.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * נתיבים שמקבלים קריאות מצד שלישי מטבעם, ואינם משתמשים בעוגייה.
 *
 * ספקי סליקה, וואטסאפ ומרכזיות טלפון שולחים POST משרת משלהם ובלי
 * `Origin` — אבל דווקא אלה שמזדהים בחתימה או בטוקן בנתיב, ולכן
 * אין להם מה להרוויח מהבדיקה הזו. הם מאומתים בדרך משלהם.
 */
const EXEMPT_PREFIXES = [
  "/api/v1/webhooks/",
  "/api/v1/billing/cardcom/",
  "/api/v1/telephony/webhook/",
  "/api/v1/offers/public/",
  "/api/v1/agreements/public/",
];

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!STATE_CHANGING.has(request.method)) return true;

    const path = request.originalUrl.split("?")[0] ?? "";
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

    const declared = this.declaredOrigin(request);
    if (declared === null) return true; // לא דפדפן — ראו ההסבר למעלה

    const allowed = loadEnv().WEB_ORIGIN;
    if (declared !== allowed) {
      throw new ForbiddenException("בקשה ממקור שאינו מורשה");
    }
    return true;
  }

  /**
   * ה-Origin כפי שהדפדפן הצהיר עליו — מ-`Origin`, ואם אין, מתוך
   * `Referer`. שניהם נכתבים ע"י הדפדפן ואינם ניתנים לזיוף מדף זר,
   * וזה כל מה שנדרש כאן.
   *
   * `Origin: null` (iframe ב-sandbox, דף `data:`, חלק משרשורי הפניה)
   * הוא הצהרה על מקור זר — לא היעדר דפדפן — ולכן חוזר כמות שהוא
   * ונכשל מול המקור המורשה, במקום ליפול ל-Referer ולעבור.
   */
  private declaredOrigin(request: Request): string | null {
    const origin = request.headers.origin;
    if (typeof origin === "string" && origin !== "") return origin;

    const referer = request.headers.referer;
    if (typeof referer === "string" && referer !== "") {
      try {
        return new URL(referer).origin;
      } catch {
        return null;
      }
    }
    return null;
  }
}
