import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../../common/auth.decorators";
import { PrismaService } from "../../core/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** בדיקת חיים לתשתית (LB/healthcheck של docker) — ציבורי, ללא דאטה. */
  @Public()
  @Get()
  health(): { status: "ok"; ts: string } {
    return { status: "ok", ts: new Date().toISOString() };
  }

  /**
   * בדיקת עומק לניטור חיצוני (UptimeRobot וכו') — מוודאת שגם מסד
   * הנתונים עונה, לא רק שהתהליך חי. 503 = המערכת לא באמת מתפקדת.
   */
  @Public()
  @Get("deep")
  async deep(): Promise<{ status: "ok"; db: "ok"; ts: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException("database unreachable");
    }
    return { status: "ok", db: "ok", ts: new Date().toISOString() };
  }
}
