import { Body, Controller, Delete, Get, HttpCode, Param, Put } from "@nestjs/common";
import { z } from "zod";
import { GOAL_HORIZONS, GOAL_UNITS, LEAD_MEASURES } from "@metavchim/shared";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MentorService, type MentorOverviewDto } from "./mentor.service";

/**
 * ‎**המנטור האישי.**
 *
 * ‏אין כאן `@RequireCapability`: המנטור הוא של המשתמש, וכל שאילתה
 * בשירות מסננת לפי `ctx.userId`. יכולת נפרדת הייתה יוצרת מצב שבו
 * מנהל משרד „מפעיל את המנטור” לסוכן — וזה הופך ליווי לפיקוח.
 * אותו דגם בדיוק כמו `notifications`.
 */

const HorizonParam = new ZodValidationPipe(z.enum(GOAL_HORIZONS));

/** המחויבות השבועית — כמה מכל פעולה, לפעולות שהמערכת יודעת לספור. */
const CommitmentSchema = z
  .object(
    Object.fromEntries(
      LEAD_MEASURES.map((m) => [m, z.number().int().min(0).max(1000).optional()]),
    ) as Record<(typeof LEAD_MEASURES)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

const SaveGoalSchema = z
  .object({
    unit: z.enum(GOAL_UNITS),
    /*
     * ‏עמלות באגורות: יעד שנתי של מיליוני שקלים הוא מאות מיליוני
     * אגורות, ולכן הגבול גבוה. `int` כי אגורה היא היחידה הקטנה
     * ביותר — שבר אגורה אינו קיים.
     */
    target: z.number().int().min(1).max(1_000_000_000_000),
    averageCommissionAgorot: z.number().int().min(1).max(100_000_000).optional(),
    commitment: CommitmentSchema.optional(),
    /* אורך העמודות במסד — ולא מספר שנבחר כאן */
    obstacle: z.string().trim().max(400).optional(),
    ifThenPlan: z.string().trim().max(400).optional(),
  })
  .strict();

@Controller("mentor")
export class MentorController {
  constructor(private readonly mentor: MentorService) {}

  /** כל מה שהמסך צריך, בקריאה אחת. */
  @AnyAuthenticated()
  @Get("overview")
  async overview(): Promise<MentorOverviewDto> {
    return this.mentor.overview();
  }

  /**
   * קביעת יעד לרמה אחת, לתקופה הנוכחית.
   *
   * ‎`PUT` ולא `POST`: קביעה חוזרת לאותה רמה ולאותה תקופה מעדכנת,
   * ואינה מוסיפה יעד שני שאיש אינו יודע איזה מהם קובע.
   */
  @AnyAuthenticated()
  @Put("goals/:horizon")
  @HttpCode(200)
  async saveGoal(
    @Param("horizon", HorizonParam) horizon: (typeof GOAL_HORIZONS)[number],
    @Body(new ZodValidationPipe(SaveGoalSchema)) body: z.infer<typeof SaveGoalSchema>,
  ): Promise<{ ok: true }> {
    await this.mentor.saveGoal(horizon, body);
    return { ok: true };
  }

  @AnyAuthenticated()
  @Delete("goals/:horizon")
  @HttpCode(200)
  async deleteGoal(
    @Param("horizon", HorizonParam) horizon: (typeof GOAL_HORIZONS)[number],
  ): Promise<{ ok: true }> {
    await this.mentor.deleteGoal(horizon);
    return { ok: true };
  }
}
