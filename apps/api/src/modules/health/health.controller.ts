import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  /** בדיקת חיים לתשתית (LB/Uptime) — ציבורי, ללא דאטה. */
  @Get()
  health(): { status: "ok"; ts: string } {
    return { status: "ok", ts: new Date().toISOString() };
  }
}
