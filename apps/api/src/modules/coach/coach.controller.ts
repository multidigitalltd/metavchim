import { Controller, Get } from "@nestjs/common";
import type { CoachRecommendation } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { CoachService } from "./coach.service";

@Controller("coach")
export class CoachController {
  constructor(private readonly coach: CoachService) {}

  /** המלצות "מה כדאי לעשות" לדשבורד (אפיון §14). */
  @Get("recommendations")
  @RequireCapability("matches.view")
  async recommendations(): Promise<CoachRecommendation[]> {
    return this.coach.recommendations();
  }
}
