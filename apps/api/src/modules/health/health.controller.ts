import { Controller, Get } from "@nestjs/common";
import { Public } from "../../common/auth.decorators";

@Controller("health")
export class HealthController {
  /** בדיקת חיים לתשתית (LB/Uptime) — ציבורי, ללא דאטה. */
  @Public()
  @Get()
  health(): { status: "ok"; ts: string } {
    return { status: "ok", ts: new Date().toISOString() };
  }
}
