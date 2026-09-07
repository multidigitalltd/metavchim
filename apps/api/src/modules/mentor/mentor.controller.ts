import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";
import {
  IdSchema,
  MENTOR_GOAL_TARGET_MAX,
  MENTOR_INTENTION_MAX,
  type MentorGoalInput,
  MentorGoalInputSchema,
  MentorGoalPeriodSchema,
  MentorIdeaFeedbackSchema,
  type MentorIdeaFeedbackInput,
  PRACTICE_SCENARIOS,
  PRACTICE_TEXT_MAX,
  type ProcessGoalSuggestion,
  type MentorGoalProposal,
} from "@metavchim/shared";
import {
  AnyAuthenticated,
  RequireCapability,
} from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  MentorPracticeService,
  type MentorPracticeDto,
  type MentorPracticeOverview,
} from "./mentor-practice.service";
import {
  MentorService,
  type MentorGoalDto,
  type MentorMonthlyDto,
  type MentorOfficeDto,
  type MentorOverview,
  type MentorPulse,
  type MentorReviewDto,
  type MentorTurnDto,
} from "./mentor.service";

const SuggestionsQuerySchema = z
  .object({
    target: z.coerce.number().int().min(1).max(MENTOR_GOAL_TARGET_MAX),
    period: MentorGoalPeriodSchema,
  })
  .strict();

const CommitmentSchema = z
  .object({
    decision: z.enum(["accepted", "declined"]),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
const PlanSchema = z
  /*
   * 200 ולא 300: התוכנית נכנסת ל-`MentorGoal.intention` (VARCHAR(200)),
   * וקלט שה-API מקבל וה-DB דוחה הוא שגיאה שנראית כתקלה (ביקורת Codex).
   */
  .object({ plan: z.string().trim().min(3).max(MENTOR_INTENTION_MAX) })
  .strict();
const ReflectionSchema = z
  .object({ answer: z.string().trim().min(1).max(1000) })
  .strict();
const AskSchema = z
  .object({ text: z.string().trim().min(2).max(1000) })
  .strict();
const PracticeStartSchema = z
  .object({ scenario: z.enum(PRACTICE_SCENARIOS) })
  .strict();
const PracticeReplySchema = z
  .object({ text: z.string().trim().min(1).max(PRACTICE_TEXT_MAX) })
  .strict();
const IdParam = new ZodValidationPipe(IdSchema);

/**
 * המנטור האישי (docs/14).
 *
 * ‎`AnyAuthenticated` ולא יכולת, כמו ברישום לפיצ'רים: אין כאן נתוני
 * משרד. הכול נקרא ונכתב לפי `tenantId` ו-`userId` מההקשר, ויכולת
 * הייתה חוסמת דווקא את הסוכן הרגיל — הקהל שהמסך נכתב בשבילו.
 * הפיצ'ר המסחרי הוא `ai_coach`: המנטור הוא הרחבה של אותו ליווי,
 * וכך גם הכרטיס בדשבורד מסונן.
 */
@RequireFeature("ai_coach")
@Controller("mentor")
export class MentorController {
  constructor(
    private readonly mentor: MentorService,
    private readonly practice: MentorPracticeService,
  ) {}

  @Get("overview")
  @AnyAuthenticated()
  overview(): Promise<MentorOverview> {
    return this.mentor.overview();
  }

  @Get("pulse")
  @AnyAuthenticated()
  pulse(): Promise<MentorPulse> {
    return this.mentor.pulse();
  }

  @Post("goals")
  @AnyAuthenticated()
  createGoal(
    @Body(new ZodValidationPipe(MentorGoalInputSchema)) body: MentorGoalInput,
  ): Promise<MentorGoalDto> {
    return this.mentor.createGoal(body);
  }

  @Delete("goals/:id")
  @AnyAuthenticated()
  endGoal(@Param("id", IdParam) id: string): Promise<void> {
    return this.mentor.endGoal(id);
  }

  @Get("suggestions")
  @AnyAuthenticated()
  suggestions(
    @Query(new ZodValidationPipe(SuggestionsQuerySchema))
    query: z.infer<typeof SuggestionsQuerySchema>,
  ): Promise<ProcessGoalSuggestion[]> {
    return this.mentor.suggestions(query.target, query.period);
  }

  @Get("reviews")
  @AnyAuthenticated()
  reviews(): Promise<MentorReviewDto[]> {
    return this.mentor.reviews();
  }

  /**
   * מה עובד אצלנו — למי שרואה ניתוחים של המשרד (docs/14 §7.4). ספירות
   * בלבד: הרעיונות שהוכיחו את עצמם, בלי שמות.
   */
  @Get("office")
  @RequireCapability("analytics.view")
  office(): Promise<MentorOfficeDto> {
    return this.mentor.office();
  }

  /** הסיכומים החודשיים — מה עבד ומה לא (docs/14 §3) */
  @Get("monthly")
  @AnyAuthenticated()
  monthly(): Promise<MentorMonthlyDto[]> {
    return this.mentor.monthly();
  }

  @Post("reviews/:id/reflection")
  @AnyAuthenticated()
  reflection(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ReflectionSchema))
    body: z.infer<typeof ReflectionSchema>,
  ): Promise<MentorReviewDto> {
    return this.mentor.answerReflection(id, body.answer);
  }

  @Post("reviews/:id/commitment")
  @AnyAuthenticated()
  commitment(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(CommitmentSchema))
    body: z.infer<typeof CommitmentSchema>,
  ): Promise<MentorReviewDto> {
    return this.mentor.commit(id, body.decision, body.note);
  }

  @Post("reviews/:id/plan")
  @AnyAuthenticated()
  plan(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(PlanSchema)) body: z.infer<typeof PlanSchema>,
  ): Promise<MentorReviewDto> {
    return this.mentor.setPlan(id, body.plan);
  }

  @Get("messages")
  @AnyAuthenticated()
  messages(): Promise<{ turns: MentorTurnDto[] }> {
    return this.mentor.turns();
  }

  /** משוב על רעיון — „עזר לי” / „לא בשבילי” (docs/14 §7.2) */
  @Post("ideas/feedback")
  @AnyAuthenticated()
  ideaFeedback(
    @Body(new ZodValidationPipe(MentorIdeaFeedbackSchema))
    body: MentorIdeaFeedbackInput,
  ): Promise<{ ok: true; text: string }> {
    return this.mentor.ideaFeedback(body);
  }

  /* ---------------- תרגול שיחה (docs/14 §7.3) ---------------- */

  @Get("practice")
  @AnyAuthenticated()
  practiceOverview(): Promise<MentorPracticeOverview> {
    return this.practice.overview();
  }

  @Post("practice")
  @AnyAuthenticated()
  practiceStart(
    @Body(new ZodValidationPipe(PracticeStartSchema))
    body: z.infer<typeof PracticeStartSchema>,
  ): Promise<MentorPracticeDto> {
    return this.practice.start(body.scenario);
  }

  @Post("practice/:id/reply")
  @AnyAuthenticated()
  practiceReply(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(PracticeReplySchema))
    body: z.infer<typeof PracticeReplySchema>,
  ): Promise<{
    turn: { role: "agent" | "counterpart"; text: string };
    closing: boolean;
    source: "model" | "fallback";
    agentTurns: number;
  }> {
    return this.practice.reply(id, body.text);
  }

  @Post("practice/:id/finish")
  @AnyAuthenticated()
  practiceFinish(@Param("id", IdParam) id: string): Promise<MentorPracticeDto> {
    return this.practice.finish(id);
  }

  @Post("messages")
  @AnyAuthenticated()
  ask(
    @Body(new ZodValidationPipe(AskSchema)) body: z.infer<typeof AskSchema>,
  ): Promise<{
    turn: MentorTurnDto;
    source: "model" | "fallback";
    proposedGoal?: MentorGoalProposal;
  }> {
    return this.mentor.ask(body.text);
  }
}
