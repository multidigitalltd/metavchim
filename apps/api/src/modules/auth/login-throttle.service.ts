import { HttpException, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";

/**
 * הגנת Brute-Force על ההתחברות (docs/04 §6): מוני כשלים ב-Redis עם חלון
 * גולש — 5 כשלונות לאימייל או 20 ל-IP (משרד שלם מאחורי NAT אחד) בתוך
 * 15 דקות ⇒ 429 עם Retry-After. הצלחה מאפסת את מונה האימייל.
 *
 * Redis לא זמין ⇒ Fail-Open עם אזהרה ביומן: זמינות ההתחברות גוברת על
 * הנעילה, ו-argon2id ממילא מאט כל ניסיון (הגנה-לעומק, סיכון שיורי מתועד).
 */

const WINDOW_SECONDS = 15 * 60;
const EMAIL_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 20;

@Injectable()
export class LoginThrottleService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly redis: IORedis;

  constructor() {
    this.redis = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
    this.redis.on("error", () => {
      /* נרשם באזהרות הפעולה — אין קריסת תהליך על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  private emailKey(email: string): string {
    return `login:fail:email:${email.toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `login:fail:ip:${ip}`;
  }

  /** נזרק 429 אם האימייל או ה-IP חצו את סף הכשלונות בחלון הנוכחי. */
  async assertAllowed(email: string, ip: string | undefined): Promise<void> {
    try {
      const [emailFails, ipFails, ttl] = await Promise.all([
        this.redis.get(this.emailKey(email)),
        ip ? this.redis.get(this.ipKey(ip)) : Promise.resolve(null),
        this.redis.ttl(this.emailKey(email)),
      ]);
      const blocked =
        Number(emailFails ?? 0) >= EMAIL_MAX_FAILURES || Number(ipFails ?? 0) >= IP_MAX_FAILURES;
      if (blocked) {
        const retryAfter = ttl > 0 ? ttl : WINDOW_SECONDS;
        throw new HttpException(
          {
            message: "יותר מדי ניסיונות התחברות — נסו שוב מאוחר יותר",
            retryAfterSeconds: retryAfter,
          },
          429,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`בדיקת Throttle נכשלה (Redis?) — ממשיכים בזהירות: ${String(error)}`);
    }
  }

  /** כשל אימות: מגדילים את שני המונים; ה-TTL נקבע בכשל הראשון בחלון. */
  async recordFailure(email: string, ip: string | undefined): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.incr(this.emailKey(email));
      pipeline.expire(this.emailKey(email), WINDOW_SECONDS, "NX");
      if (ip) {
        pipeline.incr(this.ipKey(ip));
        pipeline.expire(this.ipKey(ip), WINDOW_SECONDS, "NX");
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(`רישום כשל התחברות נכשל: ${String(error)}`);
    }
  }

  /** התחברות מוצלחת מאפסת את מונה האימייל (לא את ה-IP — הגנה רוחבית). */
  async recordSuccess(email: string): Promise<void> {
    try {
      await this.redis.del(this.emailKey(email));
    } catch {
      /* לא קריטי */
    }
  }
}
