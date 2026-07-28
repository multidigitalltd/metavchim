import { Controller, Get } from "@nestjs/common";
import { RequireCapability } from "../../common/auth.decorators";
import {
  AnalyticsService,
  type AgentPerformance,
  type OfficeStats,
} from "./analytics.service";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("office")
  @RequireCapability("matches.view")
  async office(): Promise<OfficeStats> {
    return this.analytics.officeStats();
  }

  @Get("agents")
  @RequireCapability("users.manage")
  async agents(): Promise<AgentPerformance[]> {
    return this.analytics.agentPerformance();
  }
}
