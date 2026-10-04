import { Inject, Injectable, Logger } from "@nestjs/common";
import type IORedis from "ioredis";
import {
  WORKERS_VERSION_KEY,
  type ServiceKey,
  type ServiceVersion,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { REDIS } from "../../core/redis";

/**
 * הגרסה של כל שירות — לאיסוף במסך הפלטפורמה.
 *
 * ה-API יודע את שלו ממשתנה הסביבה. את ה-Workers הוא **שואל ולא
 * מניח**: הם כותבים פעימת גרסה ל-Redis, והיעדרה נאמר במפורש במקום
 * להיות מוצג כתקין. ה-web נשאל מהדפדפן ולא מכאן — ראו
 * `apps/web/src/app/version/route.ts`.
 */
@Injectable()
export class ServiceVersionsService {
  private readonly logger = new Logger(ServiceVersionsService.name);

  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  /** גרסת השירותים שה-API יכול לדעת עליהם: הוא עצמו וה-Workers. */
  async collect(): Promise<ServiceVersion[]> {
    return [
      { key: "api" as ServiceKey, version: loadEnv().APP_VERSION },
      { key: "workers" as ServiceKey, version: await this.workersVersion() },
    ];
  }

  private async workersVersion(): Promise<string | null> {
    try {
      const raw = await this.redis.get(WORKERS_VERSION_KEY);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "version" in parsed &&
        typeof (parsed as { version: unknown }).version === "string"
      ) {
        return (parsed as { version: string }).version;
      }
      return null;
    } catch (error: unknown) {
      /*
       * Redis למטה, או פעימה בפורמט שאינו מוכר. שתיקה היא תשובה
       * לגיטימית כאן — המסך יאמר "אינו מדווח", וזה מדויק.
       */
      this.logger.warn(`workers version unavailable: ${String(error)}`);
      return null;
    }
  }
}
