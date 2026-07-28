import { HttpException, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createHmac } from "node:crypto";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";

/**
 * הגנת Brute-Force על ההתחברות (docs/04 §6) — מודל הזמנה אטומית:
 * כל ניסיון "מזמין" מקום ב-INCR לפני בדיקת הסיסמה, כך שגם 100 בקשות
 * במקביל לא עוקפות את הסף (אין TOCTOU בין בדיקה לרישום). הצלחה משחררת
 * את ההזמנה; כשל תשתית (לא-אימות) משחרר גם הוא — נעילה נוצרת רק
 * מכשלונות אימות אמיתיים.
 *
 * המפתחות ב-Redis הם HMAC של האימייל/IP — לא PII גלוי בגיבויים/ניטור
 * (docs/04 §4). Redis לא זמין ⇒ Fail-Open עם אזהרה: זמינות ההתחברות
 * גוברת, ו-argon2id ממילא מאט כל ניסיון (סיכון שיורי מתועד).
 */

const WINDOW_SECONDS = 15 * 60;
const EMAIL_MAX_ATTEMPTS = 5;
const IP_MAX_ATTEMPTS = 20;

@Injectable()
export class LoginThrottleService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly redis: IORedis;
  private readonly hashKey: string;

  constructor() {
    const env = loadEnv();
    this.redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    this.hashKey = env.PHONE_HASH_KEY;
    this.redis.on("error", () => {
      /* נרשם באזהרות הפעולה — אין קריסת תהליך על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  /** HMAC קצר — מזהה יציב בלי לחשוף אימייל/IP במפתחות Redis. */
  private hashed(value: string): string {
    return createHmac("sha256", this.hashKey).update(value).digest("hex").slice(0, 32);
  }

  private emailKey(email: string): string {
    return `login:attempt:email:${this.hashed(email.toLowerCase())}`;
  }

  private ipKey(ip: string): string {
    return `login:attempt:ip:${this.hashed(ip)}`;
  }

  /**
   * הזמנה אטומית של ניסיון: INCR לפני כל עבודת סיסמה; חצייה של הסף
   * (כולל ההזמנה הנוכחית) ⇒ 429. חסימה נשארת עד פקיעת החלון.
   */
  async reserveAttempt(email: string, ip: string | undefined): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(this.emailKey(email));
      pipeline.expire(this.emailKey(email), WINDOW_SECONDS, "NX");
      pipeline.ttl(this.emailKey(email));
      if (ip) {
        pipeline.incr(this.ipKey(ip));
        pipeline.expire(this.ipKey(ip), WINDOW_SECONDS, "NX");
      }
      const results = await pipeline.exec();
      const emailCount = Number(results?.[0]?.[1] ?? 0);
      const ttl = Number(results?.[2]?.[1] ?? WINDOW_SECONDS);
      const ipCount = ip ? Number(results?.[3]?.[1] ?? 0) : 0;

      if (emailCount > EMAIL_MAX_ATTEMPTS || ipCount > IP_MAX_ATTEMPTS) {
        throw new HttpException(
          {
            message: "יותר מדי ניסיונות התחברות — נסו שוב מאוחר יותר",
            retryAfterSeconds: ttl > 0 ? ttl : WINDOW_SECONDS,
          },
          429,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`הזמנת Throttle נכשלה (Redis?) — ממשיכים בזהירות: ${String(error)}`);
    }
  }

  /** התחברות מוצלחת: מונה האימייל נמחק וההזמנה ב-IP מוחזרת (DECR). */
  async releaseOnSuccess(email: string, ip: string | undefined): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.del(this.emailKey(email));
      if (ip) pipeline.decr(this.ipKey(ip));
      await pipeline.exec();
    } catch {
      /* לא קריטי */
    }
  }

  /**
   * כשל תשתית (DB למטה וכד'): ההזמנה מוחזרת בשני המונים — תקלה זמנית
   * לא נועלת חשבון ל-15 דקות (ביקורת Codex, PR #15).
   */
  async releaseOnInfraError(email: string, ip: string | undefined): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.decr(this.emailKey(email));
      if (ip) pipeline.decr(this.ipKey(ip));
      await pipeline.exec();
    } catch {
      /* לא קריטי */
    }
  }
}
