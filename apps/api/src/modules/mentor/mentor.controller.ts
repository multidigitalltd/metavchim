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
  MentorGoalInputSchema,
  MentorGoalPeriodSchema,
  type MentorGoalInput,
  type ProcessGoalSuggestion,
} from "@metavchim/shared";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  MentorService,
  type MentorGoalDto,
  type MentorOverview,
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
const ReflectionSchema = z
  .object({ answer: z.string().trim().min(1).max(1000) })
  .strict();
const AskSchema = z
  .object({ text: z.string().trim().min(2).max(1000) })
  .strict();
const IdParam = new ZodValidationPipe(IdSchema);

/**
 * המנטור האישי (docs/13).
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
  constructor(private readonly mentor: MentorService) {}

  @Get("overview")
  @AnyAuthenticated()
  overview(): Promise<MentorOverview> {
    return this.mentor.overview();
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

  @Get("messages")
  @AnyAuthenticated()
  messages(): Promise<{ turns: MentorTurnDto[] }> {
    return this.mentor.turns();
  }

  @Post("messages")
  @AnyAuthenticated()
  ask(
    @Body(new ZodValidationPipe(AskSchema)) body: z.infer<typeof AskSchema>,
  ): Promise<{ turn: MentorTurnDto; source: "model" | "fallback" }> {
    return this.mentor.ask(body.text);
  }
}
