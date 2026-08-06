import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { RequireCapability } from "../../common/auth.decorators";
import { PlanGuard, RequirePlan } from "../../common/plan.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  AnalyticsService,
  type AgentPerformance,
  type OfficeStats,
  type ReportWindowDays,
} from "./analytics.service";

/**
 * חלון הדיווח. ברירת המחדל 30 יום — מנהל משרד שואל "מה קרה החודש",
 * ולא "כמה הצעות שלחנו אי פעם".
 */
const WindowSchema = z
  .object({ days: z.enum(["30", "90", "365", "all"]).default("30") })
  .strict();

function toWindow(days: string): ReportWindowDays {
  return days === "all" ? null : (Number(days) as 30 | 90 | 365);
}

/** דוחות — פיצ'ר מסלול Agency ומעלה, נאכף בשרת (PlanGuard). */
@Controller("analytics")
@UseGuards(PlanGuard)
@RequirePlan("agency", "enterprise")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("office")
  @RequireCapability("matches.view")
  async office(
    @Query(new ZodValidationPipe(WindowSchema)) query: z.infer<typeof WindowSchema>,
  ): Promise<OfficeStats> {
    return this.analytics.officeStats(toWindow(query.days));
  }

  @Get("agents")
  @RequireCapability("users.manage")
  async agents(
    @Query(new ZodValidationPipe(WindowSchema)) query: z.infer<typeof WindowSchema>,
  ): Promise<AgentPerformance[]> {
    return this.analytics.agentPerformance(toWindow(query.days));
  }
}
