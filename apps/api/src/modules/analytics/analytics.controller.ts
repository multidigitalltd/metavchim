import { Controller, Get, Query } from "@nestjs/common";
import { z } from "zod";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { BOARD_PERIODS } from "@metavchim/shared";
import {
  AnalyticsService,
  type AgentPerformance,
  type OfficeBoard,
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

/**
 * דוחות — פיצ'ר של המסלול, נאכף בשרת.
 *
 * היה `@RequirePlan("agency", "enterprise")`. ההבדל אינו סגנוני:
 * רשימת מסלולים בקוד פירושה שפתיחת הדוחות למסלול מקצועי מחייבת
 * שינוי קוד ועליית גרסה, במקום סימון תיבה במסך הפלטפורמה.
 */
const BoardQuerySchema = z
  .object({ period: z.enum(BOARD_PERIODS).default("month") })
  .strict();

@Controller("analytics")
@RequireFeature("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("office")
  @RequireCapability("analytics.view")
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

  /**
   * ‎**„המשרד שלנו” — טבלת התחרות.**
   *
   * ‎`users.manage` כמו הדוח: המסך מציג את הביצועים של **כל
   * ‏הסוכנים בשמם**, וזו בדיוק ההרשאה שמגדירה מי אחראי על הצוות.
   * ‎`analytics.view` הייתה חלשה מדי — היא מספיקה לראות את המשרד
   * ‏במצטבר, ולא כל סוכן בנפרד.
   */
  @Get("board")
  @RequireCapability("users.manage")
  async board(
    @Query(new ZodValidationPipe(BoardQuerySchema)) query: z.infer<typeof BoardQuerySchema>,
  ): Promise<OfficeBoard> {
    return this.analytics.board(query.period);
  }
}
