import { Controller, Get, UseGuards } from "@nestjs/common";
import { RequireCapability } from "../../common/auth.decorators";
import { PlanGuard, RequirePlan } from "../../common/plan.guard";
import {
  AnalyticsService,
  type AgentPerformance,
  type OfficeStats,
} from "./analytics.service";

/** דוחות — פיצ'ר מסלול Agency ומעלה, נאכף בשרת (PlanGuard). */
@Controller("analytics")
@UseGuards(PlanGuard)
@RequirePlan("agency", "enterprise")
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
