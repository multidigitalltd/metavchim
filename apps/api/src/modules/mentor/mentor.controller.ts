import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  MENTOR_MESSAGE_VERDICTS,
  MENTOR_SUBJECT_KINDS,
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
  type MentorSubjectRef,
  type MentorThreadDto,
  type MentorTurnDto,
} from "./mentor.service";
import type { MentorSubjectOption } from "./mentor-signals.service";

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
/* ‏מזהה שיחה הוא מזהה ההודעה הפותחת שלה — ULID, כמו כל מזהה כאן */
const ThreadIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/u);

const MessageFeedbackSchema = z
  .object({ verdict: z.enum(MENTOR_MESSAGE_VERDICTS).nullable() })
  .strict();
const MessagePinSchema = z.object({ pinned: z.boolean() }).strict();

const SubjectsQuerySchema = z
  .object({
    kind: z.enum(MENTOR_SUBJECT_KINDS),
    q: z.string().trim().max(80).optional(),
  })
  .strict();

const AskSchema = z
  .object({
    text: z.string().trim().min(2).max(1000),
    /*
     * ‏לאיזו שיחה: `"new"` הוא „שיחה חדשה” מפורש, ומזהה הוא המשך
     * ‏שיחה שנפתחה מההיסטוריה. בהיעדרו מכריע השקט.
     */
    into: z.union([z.literal("new"), ThreadIdSchema]).optional(),
    /*
     * ‏הכרטיס שצורף לשאלה — קונה או נכס של המתווך עצמו (§7.7).
     * ‎`null` מנתק את מה שצורף קודם בשיחה; היעדרו ממשיך אותו.
     */
    attach: z
      .object({
        kind: z.enum(MENTOR_SUBJECT_KINDS),
        id: ThreadIdSchema,
      })
      .strict()
      .nullish(),
  })
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

  /**
   * ‏השיחה שעל המסך. בלי `thread` — הנוכחית; עם `thread` — זו
   * שנבחרה מההיסטוריה.
   */
  @Get("messages")
  @AnyAuthenticated()
  messages(
    @Query("thread") thread?: string,
    /** ‏הודעה שחייבת להיות במסך — פתיחה מרשימת הנעוצים */
    @Query("from") from?: string,
  ): Promise<{
    turns: MentorTurnDto[];
    threadId: string | null;
    subject: MentorSubjectRef | null;
  }> {
    const parsed = thread === undefined ? undefined : ThreadIdSchema.safeParse(thread);
    if (parsed !== undefined && !parsed.success) {
      throw new BadRequestException("מזהה שיחה לא תקין");
    }
    const anchor = from === undefined ? undefined : ThreadIdSchema.safeParse(from);
    if (anchor !== undefined && !anchor.success) {
      throw new BadRequestException("מזהה הודעה לא תקין");
    }
    /* ‏הודעה יודעת לאיזו שיחה היא שייכת, ולכן היא גוברת על `thread` */
    return this.mentor.turns(40, parsed?.data, new Date(), anchor?.data);
  }

  /**
   * ‏דירוג תשובה של המנטור. `verdict: null` מנקה — לחיצה שנייה על
   * ‏אותו כפתור, כפי ש-`nextMentorVerdict` מכריע במסך.
   */
  @Post("messages/:id/feedback")
  @AnyAuthenticated()
  @HttpCode(200)
  rateMessage(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(MessageFeedbackSchema))
    body: z.infer<typeof MessageFeedbackSchema>,
  ): Promise<{ ok: true }> {
    return this.mentor.rateMessage(id, body.verdict);
  }

  /** ‏נעיצה וביטולה — משפט שרוצים למצוא שוב, על פני כל השיחות. */
  @Post("messages/:id/pin")
  @AnyAuthenticated()
  @HttpCode(200)
  pinMessage(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(MessagePinSchema))
    body: z.infer<typeof MessagePinSchema>,
  ): Promise<{ ok: true }> {
    return this.mentor.pinMessage(id, body.pinned);
  }

  @Get("messages/pinned")
  @AnyAuthenticated()
  pinned(
    /** ‏סמן העמוד הבא — ה-`pinnedAt` של השורה האחרונה שהוצגה */
    @Query("before") before?: string,
  ): Promise<{ turns: MentorTurnDto[]; nextBefore: string | null }> {
    if (before === undefined) return this.mentor.pinned();
    const at = new Date(before);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException("סמן לא תקין");
    }
    return this.mentor.pinned(undefined, at);
  }

  /**
   * ‎**מה מותר לצרף לשיחה** — הקונים והנכסים של המתווך עצמו (§7.7).
   *
   * ‏מזהה וכותרת בלבד. עובדות אינן מוחזרות כאן: מסך בחירה אינו
   * ‏צריך אותן, והנתיב הזה נפתח בכל הקלדה.
   */
  @Get("subjects")
  @AnyAuthenticated()
  subjects(
    @Query(new ZodValidationPipe(SubjectsQuerySchema))
    query: z.infer<typeof SubjectsQuerySchema>,
  ): Promise<{ subjects: MentorSubjectOption[] }> {
    return this.mentor.subjects(query.kind, query.q ?? "");
  }

  /** ‏רשימת השיחות הקודמות — הכותרת נגזרת מהשאלה הראשונה שבכל אחת. */
  @Get("threads")
  @AnyAuthenticated()
  threads(): Promise<{ threads: MentorThreadDto[] }> {
    return this.mentor.threads();
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
    return this.mentor.ask(
      body.text,
      new Date(),
      "web",
      body.into,
      body.attach,
    );
  }
}
