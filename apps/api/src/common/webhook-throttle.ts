import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { createHash } from "node:crypto";

import type { WebhookHitSource } from "../modules/webhook-log/webhook-log.service";

/**
 * ‎**מי שולט בקצב של וובהוק — המשרד, לא כתובת ה-IP.**
 *
 * ‏המונה של `@nestjs/throttler` סופר לפי `req.ip`, וזה נכון למסך
 * ‏שמשתמש פותח. וובהוק הוא ההפך: כל המרכזיות שיושבות על אותה
 * ‏מרכזיית ענן מגיעות מאותן כתובות, וכך גם כל טופסי הלידים של אותה
 * ‏פלטפורמת שיווק. התקרה של „שישים לדקה” **חולקה בין כל המשרדים**
 * ‏ולא ניתנה לכל אחד — כלומר משרד עמוס אחד השתיק את השאר, ואף אחד
 * ‏מהם לא עשה דבר רע.
 *
 * ‏המפתח שבנתיב הוא בדיוק זהות המשרד, והוא מה שנספר כאן.
 *
 * ‎**וזה גם מגן טוב יותר.** תקרה לפי IP נשברת בהחלפת כתובת; תקרה
 * ‏לפי מפתח מחזיקה גם מול מי שמפזר את הבקשות על פני רשת שלמה.
 */
export const WEBHOOK_THROTTLE = "webhook:throttle";

/** ‏שם המונה השני. הראשון (`default`) נשאר לפי IP ולא משתנה. */
export const WEBHOOK_THROTTLER = "webhook";

export interface WebhookThrottleTarget {
  /** ‏לאיזה יומן נרשמת דחייה — אותם מקורות של `WebhookLogService`. */
  source: WebhookHitSource;
  /** ‏שם הפרמטר בנתיב שנושא את מפתח המשרד. */
  param: string;
}

/** ‏היעד המוצהר על הנתיב, או `undefined` לנתיב שאינו וובהוק. */
export function webhookThrottleTarget(context: ExecutionContext): WebhookThrottleTarget | undefined {
  return Reflect.getMetadata(WEBHOOK_THROTTLE, context.getHandler()) as
    | WebhookThrottleTarget
    | undefined;
}

/**
 * ‎**המפתח נספר מגובב, ולא כפי שהוא.**
 *
 * ‏המחרוזת הזו נוסעת אל `ThrottlerLimitDetail` ומשם אל הודעות
 * ‏שגיאה ולוגים. מפתח וובהוק הוא סוד שמאפשר לזייף אירועים בשם
 * ‏המשרד, ואין סיבה שיישב בשורת לוג רק כדי לשמש מונה.
 */
export function webhookTracker(req: { params?: Record<string, string>; ip?: string }, param: string): string {
  const key = req.params?.[param];
  /*
   * ‎**בלי מפתח — נופלים ל-IP, ולא למחרוזת ריקה.**
   *
   * ‏מחרוזת קבועה לכולם הייתה מאחדת את כל הפניות לדלי אחד: פנייה
   * ‏אחת ללא מפתח הייתה יכולה למלא אותו ולנעול את כל המשרדים
   * ‏בבת אחת — גרוע בהרבה ממה שהיה כאן קודם.
   */
  if (key === undefined || key === "") return `ip:${req.ip ?? "unknown"}`;
  return `key:${createHash("sha256").update(key).digest("base64url").slice(0, 32)}`;
}

/**
 * ‎**תקרה לכל משרד — ובנוסף לתקרה שלפי IP, לא במקומה.**
 *
 * ‏מונה לפי מפתח לבדו היה מסיר את ההגנה מפני מי שמפזר מפתחות
 * ‏אקראיים מכתובת אחת: כל מפתח מקבל דלי חדש. שני המונים רצים יחד —
 * ‏`default` לפי IP, וזה לפי משרד — ושניהם חייבים לאשר.
 *
 * ‏ההצהרה אחת ומחזיקה את שתי העובדות, כדי שנתיב לא יוכל לקבל מונה
 * ‏לפי מפתח בלי שדחייה שלו תגיע ליומן, או להפך.
 */
export function ThrottleWebhook(
  target: WebhookThrottleTarget,
  perMinute: number,
): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(WEBHOOK_THROTTLE, target),
    Throttle({
      [WEBHOOK_THROTTLER]: {
        ttl: 60_000,
        limit: perMinute,
        getTracker: (req: Record<string, unknown>) =>
          webhookTracker(req as { params?: Record<string, string>; ip?: string }, target.param),
      },
    }),
  );
}
