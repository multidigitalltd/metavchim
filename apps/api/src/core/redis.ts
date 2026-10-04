import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import IORedis from "ioredis";
import { loadEnv } from "../config/env";

/**
 * ‎**חיבור אחד ל-Redis לשירותים של ה-API.**
 *
 * ‏שמונה שירותים פתחו כל אחד חיבור משלו — מגבלת ניסיונות, קודי OTP,
 * ‏איפוס סיסמה, קישורי וואטסאפ, בדיקת `/health` ועוד — כלומר שמונה
 * ‏חיבורים לכל מופע, שמונה מאזיני שגיאה ושמונה סגירות בכיבוי. כולם
 * ‏פקודות קצרות (GET/SET/INCR/MULTI), אף אחת אינה חוסמת, ולכן חיבור
 * ‏אחד משרת את כולם בלי שאחד יעכב את חברו.
 *
 * ‏שירות מקבל אותו כך: `@Inject(REDIS) private readonly redis: IORedis`.
 *
 * ‏‎`maxRetriesPerRequest: 1`, כמו שהיה בכל השמונה: Redis שנפל מחזיר
 * ‏שגיאה מהר, וכל שירות מחליט מה עושים בלעדיו (מגבלת הניסיונות נכשלת
 * ‏סגורה, הבדיקה מדווחת). שגיאת חיבור אינה מפילה את התהליך: כל פקודה
 * ‏מחזירה את הכישלון שלה למי ששלח אותה, ושם הוא נרשם.
 *
 * ‏**ה-outbox נשאר עם חיבור משלו, בכוונה.** הוא ממתין ל-Redis שנפל
 * ‏(`maxRetriesPerRequest: null`) במקום להיכשל מהר: אצלו כל כישלון
 * ‏נספר כניסיון, ואירוע נזנח אחרי עשרה — על החיבור המשותף, נפילה של
 * ‏חצי דקה הייתה מוחקת אירועים.
 */
export const REDIS = Symbol("REDIS");

function connectRedis(): IORedis {
  const redis = new IORedis(loadEnv().REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: false });
  redis.on("error", () => {
    /* ‏כל פקודה מדווחת על הכישלון שלה — ראו למעלה */
  });
  return redis;
}

/**
 * ‏סגירת החיבור — בשלב האחרון של הכיבוי, אחרי ש-`onModuleDestroy` של
 * ‏כל השירותים כבר רץ, כך שאף אחד מהם אינו נשאר עם חיבור סגור באמצע.
 */
@Injectable()
export class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

export const REDIS_PROVIDERS = [
  { provide: REDIS, useFactory: (): IORedis => connectRedis() },
  RedisShutdown,
];
