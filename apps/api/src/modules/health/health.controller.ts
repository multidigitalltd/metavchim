import { Controller, Get, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import IORedis from "ioredis";
import { loadEnv } from "../../config/env";
import { Public } from "../../common/auth.decorators";
import { PrismaService } from "../../core/prisma.service";

interface DeepHealth {
  status: "ok";
  db: "ok";
  redis: "ok";
  ts: string;
}

@Controller("health")
export class HealthController implements OnModuleDestroy {
  private readonly logger = new Logger(HealthController.name);
  private readonly redis: IORedis;

  constructor(private readonly prisma: PrismaService) {
    this.redis = new IORedis(loadEnv().REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: false,
    });
    this.redis.on("error", () => {
      /* מדווח דרך /health/deep — אין קריסה על ניתוק Redis */
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  /** בדיקת חיים לתשתית (LB/healthcheck של docker) — ציבורי, ללא דאטה. */
  @Public()
  @Get()
  health(): { status: "ok"; ts: string } {
    return { status: "ok", ts: new Date().toISOString() };
  }

  /**
   * בדיקת עומק לניטור חיצוני (UptimeRobot וכו') — 503 = המערכת לא
   * באמת מתפקדת, גם אם התהליך חי.
   *
   * Redis נבדק לצד מסד הנתונים ולא בגללו: בלעדיו אין תורים, אין
   * התראות, אין תזכורות ואין קוד כניסה לאימייל — כלומר המערכת נראית
   * תקינה למי שפותח מסך, ובשקט מפסיקה לעשות את העבודה שבגללה קנו
   * אותה. בדיקה שמחזירה "תקין" במצב הזה גרועה מהיעדר בדיקה.
   *
   * שני הבדיקות רצות במקביל ומדווחות יחד, כדי שההתראה תגיד מה נפל
   * ולא רק ש"משהו" נפל.
   */
  @Public()
  @Get("deep")
  async deep(): Promise<DeepHealth> {
    const [db, redis] = await Promise.all([
      this.prisma
        .$queryRaw`SELECT 1`.then(() => true)
        .catch(() => false),
      this.redis
        .ping()
        .then((res) => res === "PONG")
        .catch(() => false),
    ]);

    if (!db || !redis) {
      const down = [!db ? "database" : null, !redis ? "redis" : null].filter(Boolean).join(", ");
      this.logger.error(`בדיקת עומק נכשלה: ${down}`);
      throw new ServiceUnavailableException(`unhealthy: ${down}`);
    }
    return { status: "ok", db: "ok", redis: "ok", ts: new Date().toISOString() };
  }
}
