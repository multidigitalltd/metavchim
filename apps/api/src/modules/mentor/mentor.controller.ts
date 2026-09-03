import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from "@nestjs/common";
import { z } from "zod";
import {
  FEEDBACK_MAX_LENGTH,
  GOAL_HORIZONS,
  GOAL_UNITS,
  LEAD_MEASURES,
  QUOTE_AUTHOR_MAX_LENGTH,
  QUOTE_MAX_LENGTH,
  type MentorQuote,
} from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  MentorService,
  type AchievementDto,
  type MentorOverviewDto,
} from "./mentor.service";

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

/** ‏משפט מוטבציה של המשרד. הגבולות הם אורכי העמודות במסד. */
const QuoteSchema = z
  .object({
    text: z.string().trim().min(1).max(QUOTE_MAX_LENGTH),
    /* ‏„מי אמר” ריק הוא תשובה — מנהל שחיבר משפט אינו חייב לייחסו */
    author: z.string().trim().max(QUOTE_AUTHOR_MAX_LENGTH).default(""),
  })
  .strict();

/** ‏הפידבק שהמנהל כותב. הגבול הוא אורך העמודה במסד. */
const FeedbackSchema = z
  .object({ text: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH) })
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

  /**
   * ‎**מי סגר את היעד השבועי — מסך ההנהלה.**
   *
   * ‏`analytics.view` ולא `AnyAuthenticated`: כאן, בניגוד לשאר הבקר,
   * המידע הוא **על סוכן אחר**. היעד עצמו נשאר פרטי; מה שנחשף הוא
   * שסוכן עמד בו — וזה מה שהמנהל אמור לראות כדי להגיב עליו.
   */
  @RequireCapability("analytics.view")
  @Get("achievements")
  async achievements(): Promise<AchievementDto[]> {
    return this.mentor.achievements();
  }

  @RequireCapability("analytics.view")
  @Post("achievements/:id/feedback")
  @HttpCode(200)
  async sendFeedback(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(FeedbackSchema)) body: z.infer<typeof FeedbackSchema>,
  ): Promise<{ ok: true }> {
    await this.mentor.sendFeedback(id, body.text);
    return { ok: true };
  }

  /* ====================================================================
   * ‏משפטי המוטבציה של המשרד
   * ==================================================================== */

  /**
   * ‎**‏`settings.manage` ולא `@AnyAuthenticated`, וזו הפעם היחידה
   * שיכולת מגינה על משהו שאינו של אדם אחר.**
   *
   * ‏משפטי המוטבציה הם רשימה **משותפת לכל המשרד**: מה שסוכן אחד
   * יכתוב בה יופיע בפני כל הצוות. זה הגדרת משרד, ולכן אותה יכולת
   * ששומרת על שאר ההגדרות. היעד עצמו נשאר בדיוק כפי שהיה — אישי
   * ובלי יכולת.
   */
  @RequireCapability("settings.manage")
  @Get("quotes")
  async quotes(): Promise<MentorQuote[]> {
    return this.mentor.officeQuotes();
  }

  @RequireCapability("settings.manage")
  @Post("quotes")
  @HttpCode(200)
  async addQuote(
    @Body(new ZodValidationPipe(QuoteSchema)) body: z.infer<typeof QuoteSchema>,
  ): Promise<{ ok: true; quote: MentorQuote }> {
    return { ok: true, quote: await this.mentor.addOfficeQuote(body.text, body.author) };
  }

  @RequireCapability("settings.manage")
  @Delete("quotes/:id")
  @HttpCode(200)
  async removeQuote(@Param("id") id: string): Promise<{ ok: true }> {
    await this.mentor.deleteOfficeQuote(id);
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
