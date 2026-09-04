import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import {
  buildMentorPrompt,
  jerusalemDayRange,
  jerusalemWeekStart,
  MENTOR_REPLY_JSON_SCHEMA,
  mentorFallbackReply,
  mentorGoalLabel,
  mentorPatterns,
  mentorPeriodRange,
  PATTERN_LOOKBACK,
  obstaclePlanSuggestions,
  selectWins,
  suggestProcessGoals,
  formatJerusalemDate,
  type MentorActivity,
  type MentorAsk,
  type MentorChatContext,
  type MentorGoalInput,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  type MentorMood,
  type MentorPastReview,
  type MentorPattern,
  type MentorReviewBody,
  type MentorWin,
  type ProcessGoalSuggestion,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { GeminiService } from "../../core/gemini.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import {
  MentorSignalsService,
  type GoalWithProgress,
} from "./mentor-signals.service";

/** כמה שבועות אחורה נספרים לצורך משפך ההמרה של המתווך. */
const HISTORY_WEEKS = 13;
/** כמה תורים אחרונים המודל רואה. */
const CHAT_HISTORY_TURNS = 12;
/** הודעות למודל ביום — מכסה, לא מגבלת מוצר: מעליה המנטור עונה מהיעדים. */
const CHAT_DAILY_CAP = 40;
const CHAT_TIMEOUT_MS = 20_000;

export interface MentorGoalDto {
  id: string;
  metric: string;
  period: string;
  target: number;
  why: string | null;
  intention: string | null;
  createdAt: Date;
  progress: MentorGoalProgress;
}

export interface MentorReviewDto {
  id: string;
  weekStart: Date;
  mood: MentorMood;
  headline: string;
  /** הפתיח בשם — `null` בסיכומים ישנים */
  greeting: string | null;
  paragraphs: string[];
  askNextWeek: string | null;
  reflection: string | null;
  reflectionAnswer: string | null;
  /** היעד שהבקשה לשבוע הבא מדברת עליו */
  ask: MentorAsk | null;
  /** accepted | declined | null (טרם ענה) */
  commitment: MentorCommitment | null;
  committedAt: Date | null;
  commitmentNote: string | null;
  /** התוכנית „אם… אז…” שנולדה מהרפלקציה — נכנסה ליעד ככוונת יישום */
  plan: string | null;
  /** הצעות ל„כש… אז…” לפי המדד של השאלה — ריק כשאין שאלה */
  planSuggestions: readonly string[];
  allGoalsMet: boolean;
  wins: MentorWin[];
  createdAt: Date;
}

export type MentorCommitment = "accepted" | "declined";

export interface MentorOverview {
  weekStart: Date;
  weekEnd: Date;
  activity: MentorActivity;
  /** השבוע הקודם — `null` למתווך שהצטרף השבוע */
  previousActivity: MentorActivity | null;
  wins: MentorWin[];
  goals: MentorGoalDto[];
  latestReview: MentorReviewDto | null;
  /** כמה שבועות רצופים כל היעדים הושגו — לפי הסיכומים */
  streakWeeks: number;
  /** האם השיחה החופשית פעילה (מודל מוגדר) */
  chatAvailable: boolean;
  /** מה המנטור זוכר — דפוסים מהסיכומים של החודשיים האחרונים */
  patterns: MentorPattern[];
}

/**
 * הדופק — מה שיש לחגוג השבוע, ותו לא. לכרטיס בדשבורד, שאינו צריך
 * את כל הסקירה כדי לומר „יעד הושג השבוע”.
 */
export interface MentorPulse {
  weekStart: Date;
  goalsDone: {
    id: string;
    label: string;
    period: MentorGoalPeriod;
    /** תחילת התקופה שהושגה — הזהות של החגיגה */
    periodStart: Date;
  }[];
  wins: MentorWin[];
}

export interface MentorTurnDto {
  id: string;
  role: "user" | "mentor";
  text: string;
  createdAt: Date;
}

const ReplySchema = z.object({ reply: z.string().trim().min(1).max(1500) });

/**
 * המנטור האישי — מה שהמסך צריך (docs/13).
 *
 * הכול של **המשתמש הנוכחי**: כל שאילתה נושאת `userId` מההקשר, ואין
 * נתיב שבו מנהל קורא את היעדים או הסיכום של סוכן. הוא רואה מספרים
 * בדוח הסוכנים, לא את הליווי.
 */
@Injectable()
export class MentorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gemini: GeminiService,
    private readonly signals: MentorSignalsService,
  ) {}

  async overview(now: Date = new Date()): Promise<MentorOverview> {
    const { tenantId, userId } = TenantContext.current();
    const chatAvailable = await this.gemini.isConfigured();
    return this.prisma.withTenant(async (tx) => {
      const week = mentorPeriodRange("week", now);
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { createdAt: true },
      });
      const activity = await this.signals.activity(
        tx,
        tenantId,
        userId,
        week,
        now,
      );
      const previousActivity =
        user !== null && user.createdAt < week.start
          ? await this.signals.activity(
              tx,
              tenantId,
              userId,
              { start: jerusalemWeekStart(now, -1), end: week.start },
              week.start,
            )
          : null;
      const goalRows = await tx.mentorGoal.findMany({
        where: { tenantId, userId, endedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          metric: true,
          period: true,
          target: true,
          why: true,
          intention: true,
          createdAt: true,
          endedAt: true,
        },
      });
      const goals = await this.signals.progress(
        tx,
        tenantId,
        userId,
        goalRows,
        { at: now, week, weekActivity: activity, monthAnchor: now },
      );
      const wins = selectWins(
        await this.signals.wins(tx, tenantId, userId, week),
      );
      const latest = await tx.mentorReview.findFirst({
        where: { tenantId, userId },
        orderBy: { weekStart: "desc" },
      });
      const streakWeeks = await this.streak(tx, tenantId, userId);
      const patterns = mentorPatterns(
        await this.pastReviews(tx, tenantId, userId),
        now,
      );
      return {
        weekStart: week.start,
        weekEnd: week.end,
        activity,
        previousActivity,
        wins,
        goals: goals.map(MentorService.goalDto),
        latestReview: latest === null ? null : MentorService.reviewDto(latest),
        streakWeeks,
        chatAvailable,
        patterns,
      };
    });
  }

  async pulse(now: Date = new Date()): Promise<MentorPulse> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const week = mentorPeriodRange("week", now);
      const activity = await this.signals.activity(
        tx,
        tenantId,
        userId,
        week,
        now,
      );
      const goalRows = await tx.mentorGoal.findMany({
        where: { tenantId, userId, endedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          metric: true,
          period: true,
          target: true,
          why: true,
          intention: true,
          createdAt: true,
          endedAt: true,
        },
      });
      const goals = await this.signals.progress(
        tx,
        tenantId,
        userId,
        goalRows,
        {
          at: now,
          week,
          weekActivity: activity,
          monthAnchor: now,
        },
      );
      const wins = selectWins(
        await this.signals.wins(tx, tenantId, userId, week),
      );
      return {
        weekStart: week.start,
        goalsDone: goals
          .filter((g) => g.progress.pace === "done")
          .map((g) => ({
            id: g.id,
            label: mentorGoalLabel(
              g.progress.metric,
              g.progress.target,
              g.progress.period,
            ),
            period: g.progress.period,
            periodStart: g.progress.periodStart,
          })),
        wins,
      };
    });
  }

  /** הסיכום האחרון בלבד — לשיחה („מתחייב”, „לענות למנטור”) בלי כל הסקירה. */
  async latestReview(): Promise<MentorReviewDto | null> {
    const { tenantId, userId } = TenantContext.current();
    const row = await this.prisma.withTenant((tx) =>
      tx.mentorReview.findFirst({
        where: { tenantId, userId },
        orderBy: { weekStart: "desc" },
      }),
    );
    return row === null ? null : MentorService.reviewDto(row);
  }

  /* ---------------- יעדים ---------------- */

  async createGoal(
    input: MentorGoalInput,
    now: Date = new Date(),
  ): Promise<MentorGoalDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      /*
       * יעד אחד לכל מדד ותקופה: „5 הצעות בשבוע” ו„8 הצעות בשבוע” יחד
       * הם לא שני יעדים אלא סתירה. יעד חדש על אותו מדד מחליף את
       * הקודם — והקודם נסגר, לא נמחק, כי סיכומים כבר ציטטו אותו.
       */
      await tx.mentorGoal.updateMany({
        where: {
          tenantId,
          userId,
          metric: input.metric,
          period: input.period,
          endedAt: null,
        },
        data: { endedAt: now },
      });
      const row = await tx.mentorGoal.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          metric: input.metric,
          period: input.period,
          target: input.target,
          why: input.why === undefined || input.why === "" ? null : input.why,
          intention:
            input.intention === undefined || input.intention === ""
              ? null
              : input.intention,
        },
      });
      await this.audit.record(tx, {
        action: "mentor_goal.create",
        entityType: "mentor_goal",
        entityId: row.id,
        metadata: {
          metric: input.metric,
          period: input.period,
          target: input.target,
        },
      });
      const week = mentorPeriodRange("week", now);
      const activity = await this.signals.activity(
        tx,
        tenantId,
        userId,
        week,
        now,
      );
      const [withProgress] = await this.signals.progress(
        tx,
        tenantId,
        userId,
        [row],
        { at: now, week, weekActivity: activity, monthAnchor: now },
      );
      if (withProgress === undefined)
        throw new NotFoundException("היעד לא נמצא");
      return MentorService.goalDto(withProgress);
    });
  }

  async endGoal(id: string, now: Date = new Date()): Promise<void> {
    const { tenantId, userId } = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const ended = await tx.mentorGoal.updateMany({
        where: { id, tenantId, userId, endedAt: null },
        data: { endedAt: now },
      });
      if (ended.count === 0) throw new NotFoundException("היעד לא נמצא");
      await this.audit.record(tx, {
        action: "mentor_goal.end",
        entityType: "mentor_goal",
        entityId: id,
      });
    });
  }

  /** מיעד תוצאה ליעדי תהליך — לפי המשפך של המתווך ב-13 השבועות האחרונים. */
  async suggestions(
    target: number,
    period: MentorGoalPeriod,
    now: Date = new Date(),
  ): Promise<ProcessGoalSuggestion[]> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const start = jerusalemWeekStart(now, -HISTORY_WEEKS);
      const history = await this.signals.activity(
        tx,
        tenantId,
        userId,
        { start, end: now },
        now,
      );
      return suggestProcessGoals({
        outcome: { target, period },
        history,
        historyWeeks: HISTORY_WEEKS,
      });
    });
  }

  /* ---------------- סיכומים ---------------- */

  async reviews(limit = 12): Promise<MentorReviewDto[]> {
    const { tenantId, userId } = TenantContext.current();
    const rows = await this.prisma.withTenant((tx) =>
      tx.mentorReview.findMany({
        where: { tenantId, userId },
        orderBy: { weekStart: "desc" },
        take: limit,
      }),
    );
    return rows.map(MentorService.reviewDto);
  }

  async answerReflection(
    id: string,
    answer: string,
    now: Date = new Date(),
  ): Promise<MentorReviewDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const updated = await tx.mentorReview.updateMany({
        where: { id, tenantId, userId },
        data: { reflectionAnswer: answer, answeredAt: now },
      });
      if (updated.count === 0) throw new NotFoundException("הסיכום לא נמצא");
      const row = await tx.mentorReview.findFirst({
        where: { id, tenantId, userId },
      });
      if (row === null) throw new NotFoundException("הסיכום לא נמצא");
      return MentorService.reviewDto(row);
    });
  }

  /**
   * המחויבות לבקשה של המנטור — „מתחייב” או „לא השבוע”, עם מילה אם
   * רוצים. אפשר לשנות את הדעת עד הסיכום הבא: המחויבות היא של
   * המתווך, לא של הטופס.
   */
  async commit(
    id: string,
    decision: MentorCommitment,
    note: string | undefined,
    now: Date = new Date(),
  ): Promise<MentorReviewDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.mentorReview.findFirst({
        where: { id, tenantId, userId },
      });
      if (row === null) throw new NotFoundException("הסיכום לא נמצא");
      const body = (row.body ?? {}) as Partial<MentorReviewBody>;
      if (!body.ask)
        throw new BadRequestException("בסיכום הזה אין בקשה להתחייב אליה");
      /*
       * הסיכום הבא כבר בדק את המחויבות הזו ורשם „עמדתם” או „לא יצא”
       * — שינוי עכשיו היה משאיר שני סיכומים שסותרים זה את זה. לשונית
       * ישנה או קריאה ישירה ל-API נדחות; המסך מציג את הכפתור רק על
       * הסיכום האחרון.
       */
      const later = await tx.mentorReview.findFirst({
        where: { tenantId, userId, weekStart: { gt: row.weekStart } },
        select: { id: true },
      });
      if (later !== null)
        throw new ConflictException(
          "הסיכום הבא כבר בדק את המחויבות הזו — אי אפשר לשנות אותה עכשיו",
        );
      const updated = await tx.mentorReview.update({
        where: { id },
        data: {
          commitment: decision,
          committedAt: now,
          commitmentNote: note === undefined || note === "" ? null : note,
        },
      });
      await this.audit.record(tx, {
        action: "mentor_review.commit",
        entityType: "mentor_review",
        entityId: id,
        metadata: { decision },
      });
      return MentorService.reviewDto(updated);
    });
  }

  /**
   * התוכנית „אם… אז…” — החצי השני של WOOP. נשמרת על הסיכום, ונכנסת
   * ליעד הפעיל של אותו מדד ותקופה ככוונת יישום: כך הדחיפה של אמצע
   * השבוע והבקשה לשבוע הבא מצטטות את התוכנית שנולדה מהמכשול, ולא
   * את הישנה. יעד שאינו פעיל — התוכנית נשמרת על הסיכום בלבד.
   */
  async setPlan(
    id: string,
    plan: string,
    now: Date = new Date(),
  ): Promise<MentorReviewDto> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.mentorReview.findFirst({
        where: { id, tenantId, userId },
      });
      if (row === null) throw new NotFoundException("הסיכום לא נמצא");
      const body = (row.body ?? {}) as Partial<MentorReviewBody>;
      if (!body.reflection)
        throw new BadRequestException(
          "בסיכום הזה לא הייתה שאלה, ולכן אין ממה לבנות תוכנית",
        );
      const updated = await tx.mentorReview.update({
        where: { id },
        data: { plan, plannedAt: now },
      });
      if (body.ask) {
        await tx.mentorGoal.updateMany({
          where: {
            tenantId,
            userId,
            metric: body.ask.metric,
            period: body.ask.period,
            endedAt: null,
          },
          data: { intention: plan },
        });
      }
      await this.audit.record(tx, {
        action: "mentor_review.plan",
        entityType: "mentor_review",
        entityId: id,
      });
      return MentorService.reviewDto(updated);
    });
  }

  /* ---------------- שיחה ---------------- */

  async turns(limit = 40): Promise<{ turns: MentorTurnDto[] }> {
    const { tenantId, userId } = TenantContext.current();
    const rows = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.findMany({
        where: { tenantId, userId },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    );
    return { turns: rows.reverse().map(MentorService.turnDto) };
  }

  /**
   * שאלה למנטור. ה-LLM מציע, הקוד מכריע: התשובה עוברת סכמה, ובלי
   * מודל — או כשהוא נופל — המנטור עונה מהיעדים ומהסיכום (docs/13 §7).
   */
  async ask(
    text: string,
    now: Date = new Date(),
  ): Promise<{ turn: MentorTurnDto; source: "model" | "fallback" }> {
    const ctx = TenantContext.current();
    const { tenantId, userId } = ctx;
    if (ctx.billingOnly) throw new ForbiddenException("החשבון במצב חיוב בלבד");

    const context = await this.prisma.withTenant(
      async (tx): Promise<MentorChatContext & { overCap: boolean }> => {
        await tx.mentorMessage.create({
          data: { id: ulid(), tenantId, userId, role: "user", text },
        });
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId },
          select: { name: true },
        });
        const week = mentorPeriodRange("week", now);
        const activity = await this.signals.activity(
          tx,
          tenantId,
          userId,
          week,
          now,
        );
        const goalRows = await tx.mentorGoal.findMany({
          where: { tenantId, userId, endedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            metric: true,
            period: true,
            target: true,
            why: true,
            intention: true,
            createdAt: true,
            endedAt: true,
          },
        });
        const goals = (
          await this.signals.progress(tx, tenantId, userId, goalRows, {
            at: now,
            week,
            weekActivity: activity,
            monthAnchor: now,
          })
        ).map((g) => g.progress);
        const latest = await tx.mentorReview.findFirst({
          where: { tenantId, userId },
          orderBy: { weekStart: "desc" },
        });
        const history = (
          await tx.mentorMessage.findMany({
            where: { tenantId, userId },
            orderBy: { createdAt: "desc" },
            take: CHAT_HISTORY_TURNS + 1,
            select: { role: true, text: true },
          })
        )
          .slice(1) // בלי ההודעה שהרגע נכתבה — היא „השאלה”
          .reverse()
          .map((t) => ({ role: t.role as "user" | "mentor", text: t.text }));
        const today = jerusalemDayRange(now);
        const sentToday = await tx.mentorMessage.count({
          where: {
            tenantId,
            userId,
            role: "user",
            createdAt: { gte: today.start, lt: today.end },
          },
        });
        const dto = latest === null ? null : MentorService.reviewDto(latest);
        const patterns = mentorPatterns(
          await this.pastReviews(tx, tenantId, userId),
          now,
        );
        return {
          firstName: (user?.name ?? "").trim().split(/\s+/u)[0] ?? "",
          nowText: MentorService.nowText(now),
          goals,
          lastReview:
            dto === null
              ? null
              : {
                  mood: dto.mood,
                  headline: dto.headline,
                  greeting: dto.greeting,
                  paragraphs: dto.paragraphs,
                  askNextWeek: dto.askNextWeek,
                  ask: dto.ask,
                  plan: dto.plan,
                  reflection: dto.reflection,
                  weekLabel: `שבוע ${formatJerusalemDate(dto.weekStart)}`,
                  reflectionAnswer: dto.reflectionAnswer,
                },
          history,
          patterns,
          question: text,
          overCap: sentToday > CHAT_DAILY_CAP,
        };
      },
    );

    let reply: string | null = null;
    if (!context.overCap && (await this.gemini.isConfigured())) {
      const detailed = await this.gemini.generateStructuredDetailed(
        buildMentorPrompt(context),
        MENTOR_REPLY_JSON_SCHEMA,
        {
          maxOutputTokens: 1_024,
          timeoutMs: CHAT_TIMEOUT_MS,
        },
      );
      const parsed = ReplySchema.safeParse(detailed.value);
      if (parsed.success) reply = parsed.data.reply;
    }
    const source: "model" | "fallback" = reply === null ? "fallback" : "model";
    const answer = reply ?? mentorFallbackReply(context);

    const row = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          role: "mentor",
          text: answer.slice(0, 4000),
        },
      }),
    );
    return { turn: MentorService.turnDto(row), source };
  }

  /* ---------------- עזרים ---------------- */

  private async streak(
    tx: TenantTx,
    tenantId: string,
    userId: string,
  ): Promise<number> {
    const rows = await tx.mentorReview.findMany({
      where: { tenantId, userId },
      orderBy: { weekStart: "desc" },
      take: 26,
      select: { weekStart: true, body: true },
    });
    const first = rows[0];
    if (first === undefined) return 0;
    let streak = 0;
    let expected = first.weekStart;
    for (const row of rows) {
      if (row.weekStart.getTime() !== expected.getTime()) break;
      if ((row.body as Partial<MentorReviewBody> | null)?.allGoalsMet !== true)
        break;
      streak += 1;
      expected = jerusalemWeekStart(expected, -1);
    }
    return streak;
  }

  /** הסיכומים האחרונים כקלט לזיכרון — מהחדש לישן. */
  private async pastReviews(
    tx: TenantTx,
    tenantId: string,
    userId: string,
  ): Promise<MentorPastReview[]> {
    const rows = await tx.mentorReview.findMany({
      where: { tenantId, userId },
      orderBy: { weekStart: "desc" },
      take: PATTERN_LOOKBACK,
      select: {
        weekStart: true,
        body: true,
        reflectionAnswer: true,
        plan: true,
        commitment: true,
      },
    });
    return rows.map(MentorService.toPastReview);
  }

  static toPastReview(row: {
    weekStart: Date;
    body: unknown;
    reflectionAnswer: string | null;
    plan?: string | null;
    commitment?: string | null;
  }): MentorPastReview {
    const body = (row.body ?? {}) as Partial<MentorReviewBody>;
    return {
      weekStart: row.weekStart,
      goals: Array.isArray(body.goals) ? body.goals : [],
      askMetric: body.ask?.metric ?? null,
      reflectionAnswer: row.reflectionAnswer,
      plan: row.plan ?? null,
      commitment:
        row.commitment === "accepted" || row.commitment === "declined"
          ? row.commitment
          : null,
      commitmentKept: body.commitmentKept ?? null,
    };
  }

  static nowText(now: Date): string {
    return new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "full",
      timeStyle: "short",
    }).format(now);
  }

  static goalDto(goal: GoalWithProgress): MentorGoalDto {
    return {
      id: goal.id,
      metric: goal.metric,
      period: goal.period,
      target: goal.target,
      why: goal.why,
      intention: goal.intention,
      createdAt: goal.createdAt,
      progress: goal.progress,
    };
  }

  static reviewDto(row: {
    id: string;
    weekStart: Date;
    mood: string;
    headline: string;
    body: unknown;
    reflectionAnswer: string | null;
    commitment?: string | null;
    committedAt?: Date | null;
    commitmentNote?: string | null;
    plan?: string | null;
    createdAt: Date;
  }): MentorReviewDto {
    const body = (row.body ?? {}) as Partial<MentorReviewBody>;
    const askMetric = body.ask?.metric;
    return {
      id: row.id,
      weekStart: row.weekStart,
      mood: row.mood as MentorMood,
      headline: row.headline,
      greeting: body.greeting ?? null,
      paragraphs: Array.isArray(body.paragraphs) ? body.paragraphs : [],
      askNextWeek: body.askNextWeek ?? null,
      ask: body.ask ?? null,
      commitment:
        row.commitment === "accepted" || row.commitment === "declined"
          ? row.commitment
          : null,
      committedAt: row.committedAt ?? null,
      commitmentNote: row.commitmentNote ?? null,
      plan: row.plan ?? null,
      planSuggestions:
        body.reflection && askMetric !== undefined
          ? obstaclePlanSuggestions(askMetric)
          : [],
      reflection: body.reflection ?? null,
      reflectionAnswer: row.reflectionAnswer,
      allGoalsMet: body.allGoalsMet === true,
      wins: Array.isArray(body.wins) ? body.wins : [],
      createdAt: row.createdAt,
    };
  }

  static turnDto(row: {
    id: string;
    role: string;
    text: string;
    createdAt: Date;
  }): MentorTurnDto {
    return {
      id: row.id,
      role: row.role as "user" | "mentor",
      text: row.text,
      createdAt: row.createdAt,
    };
  }
}
