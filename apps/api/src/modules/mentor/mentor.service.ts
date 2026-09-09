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
  formatJerusalemDate,
  jerusalemDayRange,
  jerusalemWeekStart,
  jerusalemDayStart,
  jerusalemWallParts,
  jerusalemWallIsoToUtc,
  MENTOR_REPLY_JSON_SCHEMA,
  type MentorActivity,
  type MentorAsk,
  type MentorAdvice,
  MentorGoalInputSchema,
  type MentorChatContext,
  type MentorGoalProposal,
  type MentorPersona,
  mentorAdvice,
  mentorFallbackReply,
  parseGoalRequest,
  resolveIdeaFeedback,
  resolveMentorPersona,
  ideaByKey,
  IDEA_MARKS_MAX,
  jerusalemDayLabel,
  type MentorGoalInput,
  mentorGoalLabel,
  type MentorGoalMetric,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  type MentorInsights,
  type MentorMood,
  type MentorPastReview,
  type MentorPattern,
  mentorPatterns,
  mentorPeriodRange,
  mentorStartsNewThread,
  type MentorMessageVerdict,
  mentorThreadTitle,
  MENTOR_METRICS,
  officeEvidenceLabel,
  mentorOnboarding,
  onboardingDay,
  ONBOARDING_DAYS,
  type MentorOnboarding,
  type MentorMonthlyBody,
  type MentorReviewBody,
  type MentorWin,
  obstaclePlanSuggestions,
  PATTERN_LOOKBACK,
  type ProcessGoalSuggestion,
  selectWins,
  suggestProcessGoals,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AgentEventsService } from "../agent/agent-events.service";
import { MentorPracticeService } from "./mentor-practice.service";
import { AuditService } from "../../core/audit.service";
import { GeminiService } from "../../core/gemini.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import {
  MentorSignalsService,
  type GoalWithProgress,
} from "./mentor-signals.service";

/** כמה שבועות אחורה נספרים לצורך משפך ההמרה של המתווך. */
/** כמה תורים אחרונים המודל רואה. */
const CHAT_HISTORY_TURNS = 12;
/**
 * ‏כמה הודעות נטענות **לפני** ההודעה שנפתחה מרשימת הנעוצים. רוב
 * ‏החלון הולך קדימה, כי משם ממשיכים לקרוא; מעט לפניה קיים כדי
 * ‏שהמשפט יגיע עם מה שנאמר סביבו.
 */
const TURN_WINDOW_BEFORE = 8;
/** ‏גודל עמוד ברשימת הנעוצים — יש סמן, ולכן זה גבול עמוד ולא גבול. */
const PINNED_PAGE = 30;
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
  /** מהירות המענה ושיחות שמחכות לחזרה — השבוע מול השבוע שעבר */
  insights: MentorInsights;
  /** מה המנטור זוכר — דפוסים מהסיכומים של החודשיים האחרונים */
  patterns: MentorPattern[];
  /** מה המנטור מציע עכשיו — עד שלוש עצות מהמספרים (docs/14 §7.1) */
  advice: MentorAdvice[];
  /** השם והסגנון שהמתווך בחר (docs/14 §4.1) */
  persona: MentorPersona;
  /** 30 הימים הראשונים — `null` למי שכבר עבר אותם (docs/14 §7.5) */
  onboarding: MentorOnboarding | null;
}

/** מה עובד אצלנו — למנהל, ספירות בלבד (docs/14 §7.4). */
export interface MentorOfficeDto {
  /** כמה מתווכים תרמו עדות כלשהי */
  agents: number;
  proven: {
    key: string;
    metric: MentorGoalMetric;
    metricLabel: string;
    text: string;
    helped: number;
    dismissed: number;
    up: number;
    measured: number;
    /** „עזר ל-3 · המספר עלה אצל 2” */
    evidence: string;
  }[];
}

/** הסיכום החודשי כפי שהמסך מקבל אותו. */
export interface MentorMonthlyDto {
  id: string;
  monthStart: Date;
  headline: string;
  greeting: string | null;
  paragraphs: string[];
  /** המדד למיקוד בחודש הבא — `null` כשאין */
  focus: MentorGoalMetric | null;
  createdAt: Date;
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

/** ‏שורה ברשימת ההיסטוריה — הכול נגזר מההודעות, שום שדה אינו שמור. */
export interface MentorThreadDto {
  id: string;
  title: string;
  lastAt: Date;
  messages: number;
}

export interface MentorTurnDto {
  /** ‏דירוג המתווך על התשובה — `null` כשלא דורגה, וזה הרוב */
  feedback?: "helpful" | "not_helpful" | null;
  /** ‏מתי נעצה, אם נעצה — המסך צובע לפי זה */
  pinnedAt?: string | null;
  id: string;
  /**
   * ‏השיחה שההודעה שייכת לה. ברשימת השיחה עצמה זו ידיעה מיותרת;
   * ‏ברשימת הנעוצים היא **כל התכלית** — משפט שנעצת נמצא בשיחה
   * ‏אחרת, ובלי המזהה אין מאיפה לפתוח אותה.
   */
  threadId: string;
  role: "user" | "mentor";
  text: string;
  createdAt: Date;
}

const ReplySchema = z.object({
  reply: z.string().trim().min(1).max(1500),
  // המודל מציע, המתווך לוחץ, הקוד כותב — אותה סכמה כמו היעד עצמו
  proposedGoal: MentorGoalInputSchema.pick({
    metric: true,
    period: true,
    target: true,
  }).optional(),
});

/**
 * המנטור האישי — מה שהמסך צריך (docs/14).
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
    private readonly events: AgentEventsService,
  ) {}

  async overview(now: Date = new Date()): Promise<MentorOverview> {
    const { tenantId, userId } = TenantContext.current();
    const chatAvailable = await this.gemini.isConfigured();
    return this.prisma.withTenant(async (tx) => {
      const week = mentorPeriodRange("week", now);
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { createdAt: true, preferences: true },
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
      const insights = await this.signals.insights(
        tx,
        tenantId,
        userId,
        week,
        previousActivity === null
          ? null
          : { start: jerusalemWeekStart(now, -1), end: week.start },
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
      const funnel = await this.signals.funnelHistory(
        tx,
        tenantId,
        userId,
        now,
      );
      const advice = mentorAdvice({
        goals: goals.map((g) => g.progress),
        activity,
        previousActivity,
        insights,
        funnel,
        feedback: resolveIdeaFeedback(user?.preferences),
        office: await this.signals.officePlaybookFor(tx, tenantId, userId, now),
        closestDeal: await this.signals.closestDeal(tx, tenantId, userId, now),
        now,
      });
      return {
        weekStart: week.start,
        weekEnd: week.end,
        activity,
        previousActivity,
        insights,
        wins,
        goals: goals.map(MentorService.goalDto),
        latestReview: latest === null ? null : MentorService.reviewDto(latest),
        streakWeeks,
        chatAvailable,
        patterns,
        advice,
        persona: resolveMentorPersona(user?.preferences),
        onboarding: await this.onboardingOf(
          tx,
          tenantId,
          userId,
          user?.createdAt,
          goals.map((g) => g.progress),
          now,
        ),
      };
    });
  }

  /** 30 הימים הראשונים (docs/14 §7.5) — היום, השבוע והצעד; `null` לוותיק. */
  private async onboardingOf(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    userCreatedAt: Date | undefined,
    goals: MentorGoalProgress[],
    now: Date,
  ): Promise<MentorOnboarding | null> {
    if (userCreatedAt === undefined) return null;
    if (onboardingDay(userCreatedAt, now) > ONBOARDING_DAYS) return null;
    const practices = await MentorPracticeService.stats(tx, tenantId, userId, {
      start: userCreatedAt,
      end: now,
    });
    return mentorOnboarding({
      userCreatedAt,
      now,
      goals,
      practices: practices.count,
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

  /**
   * מה עובד אצלנו — למנהל (docs/14 §7.4): הרעיונות שהוכיחו את עצמם
   * במשרד, עם ספירות בלבד. אין כאן שמות ואין דרך לגזור אותם.
   */
  async office(now: Date = new Date()): Promise<MentorOfficeDto> {
    const { tenantId } = TenantContext.current();
    const office = await this.prisma.withTenant((tx) =>
      this.signals.officePlaybook(tx, tenantId, now),
    );
    return {
      agents: office.agents,
      proven: office.proven.map((e) => ({
        key: e.key,
        metric: e.metric,
        metricLabel:
          MENTOR_METRICS.find((m) => m.code === e.metric)?.label ?? e.metric,
        text: e.text,
        helped: e.helped,
        dismissed: e.dismissed,
        up: e.up,
        measured: e.measured,
        evidence: officeEvidenceLabel(e),
      })),
    };
  }

  /** הסיכומים החודשיים — מהחדש לישן (docs/14 §3). */
  async monthly(limit = 6): Promise<MentorMonthlyDto[]> {
    const { tenantId, userId } = TenantContext.current();
    const rows = await this.prisma.withTenant((tx) =>
      tx.mentorMonthlyReview.findMany({
        where: { tenantId, userId },
        orderBy: { monthStart: "desc" },
        take: limit,
      }),
    );
    return rows.map((row) => {
      const body = (row.body ?? {}) as Partial<MentorMonthlyBody>;
      return {
        id: row.id,
        monthStart: row.monthStart,
        headline: row.headline,
        greeting: body.greeting ?? null,
        paragraphs: Array.isArray(body.paragraphs) ? body.paragraphs : [],
        focus: body.focus ?? null,
        createdAt: row.createdAt,
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
      const funnel = await this.signals.funnelHistory(
        tx,
        tenantId,
        userId,
        now,
      );
      return suggestProcessGoals({
        outcome: { target, period },
        history: funnel.history,
        historyWeeks: funnel.weeks,
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

  /**
   * ‏השיחה שעל המסך — הנוכחית, או זו שביקשו לפתוח מההיסטוריה.
   *
   * ‎**בלי `threadId` זו השיחה האחרונה ולא „ארבעים ההודעות
   * האחרונות”.** ההבדל מתגלה בדיוק ברגע שמישהו חוזר אחרי יומיים:
   * קודם הוא היה רואה את סוף השיחה הקודמת כאילו היא נמשכת, ועכשיו
   * הוא רואה מסך נקי — והקודמת ממתינה בהיסטוריה.
   *
   * ‎`threadId` שאינו של המתווך הזה מחזיר ריק ולא שגיאה, כי הוא
   * ‏מסונן באותה שאילתה: השיחה של עמית אינה „אסורה”, היא פשוט
   * ‏אינה קיימת מבחינתו.
   */
  async turns(
    limit = 40,
    threadId?: string,
    now: Date = new Date(),
    /**
     * ‎**הודעה שחייבת להיות במסך** — פתיחה מרשימת הנעוצים.
     *
     * ‏בלי זה נפתחה השיחה הנכונה ונטענו 40 האחרונות שלה, וההודעה
     * ‏שנעצת פשוט לא הייתה שם: בשיחה ארוכה, הרשימה שקיימת כדי
     * ‏להחזיר אליה לא החזירה אליה (ביקורת Codex, P2). המזהה כאן
     * ‏קובע גם את השיחה — הודעה יודעת לאיזו שיחה היא שייכת.
     */
    from?: string,
  ): Promise<{ turns: MentorTurnDto[]; threadId: string | null }> {
    const { tenantId, userId } = TenantContext.current();
    if (from !== undefined) return this.turnsAround(from, limit);
    const rows = await this.prisma.withTenant(async (tx) => {
      let id = threadId;
      if (id === undefined) {
        const newest = await tx.mentorMessage.findFirst({
          where: { tenantId, userId },
          orderBy: { createdAt: "desc" },
          select: { threadId: true, createdAt: true },
        });
        /*
         * ‎**אותו כלל שקרוי בכתיבה, גם בקריאה.**
         *
         * ‏‎`ask` מכריע לפי `mentorStartsNewThread` שהודעה אחרי שש
         * ‏שעות שקט פותחת שיחה חדשה. הקריאה כאן החזירה את השיחה
         * ‏האחרונה **בלי קשר לגילה**, ולכן מי שחזר למחרת ראה את
         * ‏שיחת אתמול, כתב בה — וההודעה נשמרה בשיחה חדשה בזמן שהמסך
         * ‏הציג את שתיהן כאחת (ביקורת Codex, P1).
         *
         * ‏זה בדיוק מה שהקבוע המשותף נועד למנוע, ולא השתמשתי בו
         * ‏בצד הקריאה. כלל אחד, שני קוראים.
         */
        id =
          newest !== null && !mentorStartsNewThread(newest.createdAt, now)
            ? newest.threadId
            : undefined;
      }
      if (id === undefined) return [];
      return tx.mentorMessage.findMany({
        where: { tenantId, userId, threadId: id },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    });
    return {
      turns: rows.reverse().map(MentorService.turnDto),
      threadId: rows[0]?.threadId ?? null,
    };
  }

  /**
   * ‎**חלון סביב הודעה מסוימת** — ההודעה עצמה, מעט לפניה, והמשך.
   *
   * ‏„מעט לפניה” אינו קישוט: משפט בלי מה שנאמר סביבו הוא ציטוט ולא
   * ‏עצה, וזו כל הסיבה שהנעיצה מחזירה אל השיחה ולא אל הטקסט לבדו.
   * ‏רוב החלון הולך קדימה, כי משם ממשיכים לקרוא.
   *
   * ‏הודעה שאינה של המתווך הזה מחזירה ריק ולא שגיאה — אותו כלל כמו
   * ‏בשאר הקובץ, ומאותו נימוק.
   */
  private async turnsAround(
    from: string,
    limit: number,
  ): Promise<{ turns: MentorTurnDto[]; threadId: string | null }> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const anchor = await tx.mentorMessage.findFirst({
        where: { id: from, tenantId, userId },
        select: { threadId: true, createdAt: true },
      });
      if (anchor === null) return { turns: [], threadId: null };
      const before = Math.min(TURN_WINDOW_BEFORE, Math.max(0, limit - 1));
      const [earlier, rest] = await Promise.all([
        tx.mentorMessage.findMany({
          where: {
            tenantId,
            userId,
            threadId: anchor.threadId,
            createdAt: { lt: anchor.createdAt },
          },
          orderBy: { createdAt: "desc" },
          take: before,
        }),
        tx.mentorMessage.findMany({
          where: {
            tenantId,
            userId,
            threadId: anchor.threadId,
            createdAt: { gte: anchor.createdAt },
          },
          orderBy: { createdAt: "asc" },
          take: limit - before,
        }),
      ]);
      return {
        turns: [...earlier.reverse(), ...rest].map(MentorService.turnDto),
        threadId: anchor.threadId,
      };
    });
  }

  /**
   * ‎**דירוג תשובה, ונעיצה — שתי פעולות על אותה שורה.**
   *
   * ‏שתיהן מסוננות ב-`updateMany` על `userId`, ולכן הודעה של עמית
   * ‏אינה „אסורה” אלא פשוט אינה נמצאת. `count === 0` הוא התשובה
   * ‏הנכונה גם למזהה שאינו קיים וגם למזהה של מישהו אחר — שני
   * ‏המצבים אינם צריכים להיות ניתנים להבחנה מבחוץ.
   *
   * ‎**רק תשובה של המנטור ניתנת לדירוג.** דירוג של השאלה שלך עצמך
   * ‏אינו אומר דבר, והמסך אינו מציע אותו; התנאי כאן הוא מה שהופך
   * ‏את זה לנכון גם כשמישהו קורא ל-API ישירות.
   */
  async rateMessage(
    id: string,
    verdict: MentorMessageVerdict | null,
  ): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const { count } = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.updateMany({
        where: { id, tenantId, userId, role: "mentor" },
        data: { feedback: verdict },
      }),
    );
    if (count === 0) throw new NotFoundException("ההודעה לא נמצאה");
    return { ok: true };
  }

  async pinMessage(id: string, pinned: boolean): Promise<{ ok: true }> {
    const { tenantId, userId } = TenantContext.current();
    const { count } = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.updateMany({
        where: { id, tenantId, userId },
        data: { pinnedAt: pinned ? new Date() : null },
      }),
    );
    if (count === 0) throw new NotFoundException("ההודעה לא נמצאה");
    return { ok: true };
  }

  /**
   * ‏מה שנעצת — על פני כל השיחות, החדש ראשון.
   *
   * ‏זו הסיבה שנעיצה קיימת: משפט טוב נאמר בשיחה אחת ונחוץ בשיחה
   * ‏אחרת, וחיפוש בהיסטוריה אינו תשובה למי שזוכר שהיה משהו ולא
   * ‏זוכר מתי.
   */
  async pinned(
    limit = PINNED_PAGE,
    /**
     * ‏סמן העמוד הבא — ה-`pinnedAt` של השורה האחרונה שהוצגה.
     *
     * ‏בלעדיו הרשימה נעצרה על 30 **לתמיד**: נעוץ שלושים ואחד הסתיר
     * ‏את הישן ממנו, ולא הייתה שום דרך להגיע אליו מלבד לבטל נעיצות
     * ‏חדשות יותר (ביקורת Codex, P2).
     *
     * ‎`pinnedAt` ולא מזהה: זה גם סדר הרשימה, ולכן הוא הסמן היחיד
     * ‏שאינו יכול לסתור אותה.
     */
    before?: Date,
  ): Promise<{ turns: MentorTurnDto[]; nextBefore: string | null }> {
    const { tenantId, userId } = TenantContext.current();
    const rows = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.findMany({
        where: {
          tenantId,
          userId,
          pinnedAt: before === undefined ? { not: null } : { lt: before },
        },
        orderBy: { pinnedAt: "desc" },
        take: limit,
      }),
    );
    /*
     * ‏„יש עוד” נאמר רק כשהעמוד מלא. עמוד חלקי הוא הסוף, ולהחזיר
     * ‏סמן עליו היה מייצר כפתור „עוד” שאינו מביא דבר.
     */
    const last = rows.length === limit ? rows[rows.length - 1] : undefined;
    return {
      turns: rows.map(MentorService.turnDto),
      nextBefore: last?.pinnedAt?.toISOString() ?? null,
    };
  }

  /**
   * ‎**רשימת השיחות — נגזרת, בלי טבלה ובלי כותרת שמורה.**
   *
   * ‏שם השיחה הוא השאלה הראשונה שנשאלה בה, והמועד הוא האחרון שנאמר
   * ‏בה. שניהם נקראים מההודעות עצמן, ולכן אינם יכולים לחלוק עליהן:
   * ‏עמודת כותרת הייתה יכולה להישאר על נוסח שנמחק.
   *
   * ‏שתי שאילתות ולא N+1: `groupBy` לשלד (מזהה, מועד אחרון, כמה),
   * ‏ואז שליפה אחת של ההודעה הפותחת של כל שיחה מהעמוד הזה. עוד
   * ‏שאילתה לכל שורה הייתה עשרים שאילתות על מסך שנפתח בלחיצה.
   */
  async threads(limit = 20): Promise<{ threads: MentorThreadDto[] }> {
    const { tenantId, userId } = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const groups = await tx.mentorMessage.groupBy({
        by: ["threadId"],
        where: { tenantId, userId },
        _max: { createdAt: true },
        _count: { _all: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: limit,
      });
      if (groups.length === 0) return { threads: [] };
      /*
       * ‏ההודעה הפותחת של כל שיחה היא זו שמזהה השיחה הוא המזהה שלה —
       * ‏זו כל הסיבה שהמזהה נבחר כך. שליפה לפי מפתח ראשי, בלי מיון
       * ‏ובלי חלון.
       */
      const heads = await tx.mentorMessage.findMany({
        where: {
          tenantId,
          userId,
          id: { in: groups.map((g) => g.threadId) },
        },
        select: { id: true, text: true, role: true },
      });
      const headOf = new Map(heads.map((h) => [h.id, h]));
      return {
        threads: groups.map((g) => {
          const head = headOf.get(g.threadId);
          return {
            id: g.threadId,
            /* ‏רק שאלה של המתווך היא כותרת; פתיח של המנטור אינו */
            title: mentorThreadTitle(head?.role === "user" ? head.text : null),
            lastAt: g._max.createdAt ?? new Date(0),
            messages: g._count._all,
          };
        }),
      };
    });
  }

  /**
   * שאלה למנטור. ה-LLM מציע, הקוד מכריע: התשובה עוברת סכמה, ובלי
   * מודל — או כשהוא נופל — המנטור עונה מהיעדים ומהסיכום (docs/14 §7).
   */
  async ask(
    text: string,
    now: Date = new Date(),
    /** מאיפה השאלה הגיעה — ליומן האסימונים של הפלטפורמה בלבד */
    channel: "web" | "whatsapp" = "web",
    /**
     * ‏לאיזו שיחה ההודעה שייכת, כשהמסך יודע:
     * ‎`"new"` — „שיחה חדשה” מפורש, עוקף את כלל השקט.
     * ‏מזהה — המשך שיחה שנפתחה מההיסטוריה.
     * ‎`undefined` — מכריע השקט, כמו תמיד.
     */
    into?: "new" | string,
  ): Promise<{
    turn: MentorTurnDto;
    source: "model" | "fallback";
    /** יעד שהמנטור מציע לקבוע — המסך מציג כפתור, המתווך לוחץ (docs/14 §7) */
    proposedGoal?: MentorGoalProposal;
  }> {
    const ctx = TenantContext.current();
    const { tenantId, userId } = ctx;
    if (ctx.billingOnly) throw new ForbiddenException("החשבון במצב חיוב בלבד");

    /*
     * ‎**באיזו שיחה ההודעה הזו יושבת** — נקבע לפני שהיא נכתבת.
     *
     * ‏השאלה נשאלת פעם אחת, וכל השאר נגזר ממנה: התשובה תיכתב לאותה
     * ‏שיחה, וההיסטוריה שתיסע לפרומפט תיקרא ממנה בלבד.
     *
     * ‎`startNew` הוא „שיחה חדשה” מפורש מהמסך. בלעדיו מכריע השקט:
     * ‏‎`mentorStartsNewThread` — אותו כלל בדיוק שחילק ב-SQL את מה
     * ‏שכבר נכתב.
     */
    const messageId = ulid();
    const threadId = await this.prisma.withTenant(async (tx) => {
      if (into === "new") return messageId;
      /*
       * ‏המשך שיחה מההיסטוריה — אבל רק אחרי שנמצאה **אצל המתווך
       * ‏הזה**. מזהה שהגיע מבחוץ אינו הוכחה לבעלות, ובלי הבדיקה
       * ‏הזו אפשר היה לכתוב לתוך שיחה של עמית.
       */
      if (into !== undefined) {
        const owned = await tx.mentorMessage.findFirst({
          where: { tenantId, userId, threadId: into },
          select: { threadId: true },
        });
        if (owned !== null) return owned.threadId;
        throw new BadRequestException("השיחה הזו אינה קיימת");
      }
      const previous = await tx.mentorMessage.findFirst({
        where: { tenantId, userId },
        orderBy: { createdAt: "desc" },
        select: { threadId: true, createdAt: true },
      });
      if (previous === null) return messageId;
      return mentorStartsNewThread(previous.createdAt, now)
        ? messageId
        : previous.threadId;
    });

    const context = await this.prisma.withTenant(
      async (tx): Promise<MentorChatContext & { overCap: boolean }> => {
        await tx.mentorMessage.create({
          data: { id: messageId, tenantId, userId, threadId, role: "user", text },
        });
        const user = await tx.user.findFirst({
          where: { id: userId, tenantId },
          select: { name: true, createdAt: true, preferences: true },
        });
        const week = mentorPeriodRange("week", now);
        const activity = await this.signals.activity(
          tx,
          tenantId,
          userId,
          week,
          now,
        );
        /*
         * מול שבוע שעבר — **אותו חלק של השבוע**: שאלה ביום שני משווה
         * ראשון–שני של השבוע לראשון–שני של שבוע שעבר, לא לשבוע שלם.
         * אחרת כל מדד היה „פחות” ביום שני, והמודל היה מייעץ על ירידה
         * שאינה קיימת (ביקורת Codex). אותה שעת קיר, שבוע אחורה.
         */
        const sameMomentLastWeek = jerusalemWallIsoToUtc(
          `${jerusalemWallParts(jerusalemDayStart(now, -7)).date}T${jerusalemWallParts(now).time}:00.000`,
        );
        const previousActivity =
          user !== null && user.createdAt < week.start
            ? await this.signals.activity(
                tx,
                tenantId,
                userId,
                { start: jerusalemWeekStart(now, -1), end: sameMomentLastWeek },
                sameMomentLastWeek,
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
        /*
         * ‎**ההיסטוריה היא של השיחה הזו, לא של הכול.**
         *
         * ‏קודם נלקחו שתים־עשרה ההודעות האחרונות של המתווך בלי קשר
         * ‏למתי נאמרו — ולכן שאלה חדשה בבוקר נשענה על מה שנאמר אמש
         * ‏על נושא אחר לגמרי. זו בדיוק המשמעות של „שיחה”: מה שנאמר
         * ‏בתוכה שייך, ומה שמחוצה לה לא.
         */
        const history = (
          await tx.mentorMessage.findMany({
            where: { tenantId, userId, threadId },
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
        const insights = await this.signals.insights(
          tx,
          tenantId,
          userId,
          week,
          { start: jerusalemWeekStart(now, -1), end: week.start },
        );
        // מה שהמנטור צריך כדי לייעץ — המשפך והניתוח (docs/14 §7.1)
        const funnel = await this.signals.funnelHistory(
          tx,
          tenantId,
          userId,
          now,
        );
        // מה עובד במשרד — ידע משותף לעצות ולפרומפט (§7.4)
        const office = await this.signals.officePlaybookFor(
          tx,
          tenantId,
          userId,
          now,
        );
        // העסקה הקרובה ביותר — העצה הראשונה, והחריג לכלל 6 בפרומפט (§7.6)
        const closest = await this.signals.closestDeal(
          tx,
          tenantId,
          userId,
          now,
        );
        const advice = mentorAdvice({
          goals,
          activity,
          previousActivity,
          insights,
          funnel,
          feedback: resolveIdeaFeedback(user?.preferences),
          office,
          closestDeal: closest,
          now,
        });
        // התרגול האחרון בחודש האחרון — מה המנטור אמר לנסות (§7.3)
        const practice = await MentorPracticeService.stats(
          tx,
          tenantId,
          userId,
          {
            start: jerusalemDayStart(now, -30),
            end: now,
          },
        );
        return {
          insights,
          activity,
          previousActivity,
          funnel,
          advice,
          onboarding: await this.onboardingOf(
            tx,
            tenantId,
            userId,
            user?.createdAt,
            goals,
            now,
          ),
          closestDeal: closest,
          lastPractice:
            practice.last === null
              ? null
              : {
                  scenarioLabel: practice.last.scenarioLabel,
                  score: practice.last.score,
                  tryNext: practice.last.tryNext,
                },
          office,
          persona: resolveMentorPersona(user?.preferences),
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
    let proposedGoal: MentorGoalProposal | undefined;
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
      if (parsed.success) {
        reply = parsed.data.reply;
        proposedGoal = parsed.data.proposedGoal;
      }
      /*
       * הקריאה למודל נרשמת ביומן הסוכן — גם כשהתשובה לא עברה את
       * הסכמה: האסימונים נצרכו מהמפתח של הפלטפורמה, ודוח השימוש
       * צריך להראות אותם. ללא קריאה (בלי מפתח, מעל המכסה) אין מה
       * לרשום — לא שולם דבר.
       */
      await this.events.record({
        channel,
        kind: "mentor",
        transcript: text,
        payload: { replied: parsed.success },
        source: "llm",
        model: detailed.model,
        latencyMs: detailed.latencyMs,
        ...(detailed.usage === undefined ? {} : { usage: detailed.usage }),
      });
    }
    const source: "model" | "fallback" = reply === null ? "fallback" : "model";
    /*
     * בקשה מפורשת ליעד מקבלת כפתור גם בלי מודל, וגם כשהמודל ענה בלי
     * למלא את ההצעה: הפענוח הדטרמיניסטי הוא הרשת. הכפתור אינו קובע
     * — הוא מציע; הלחיצה של המתווך היא שכותבת.
     */
    proposedGoal ??= parseGoalRequest(text) ?? undefined;
    const answer =
      reply ??
      (proposedGoal === undefined
        ? mentorFallbackReply(context)
        : `${mentorGoalLabel(proposedGoal.metric, proposedGoal.target, proposedGoal.period)} — מוכן. לחיצה על הכפתור שמתחת קובעת את היעד, ומשם אני עוקב.`);

    const row = await this.prisma.withTenant((tx) =>
      tx.mentorMessage.create({
        data: {
          id: ulid(),
          tenantId,
          userId,
          // ‏התשובה יושבת בשיחה של השאלה — לא נבדקת מחדש מול השקט
          threadId,
          role: "mentor",
          text: answer.slice(0, 4000),
        },
      }),
    );
    return {
      turn: MentorService.turnDto(row),
      source,
      ...(proposedGoal === undefined ? {} : { proposedGoal }),
    };
  }

  /* ---------------- משוב על רעיונות ---------------- */

  /**
   * „עזר לי” / „לא בשבילי” על רעיון (docs/14 §7.2) — הזיכרון של המנטור
   * לגבי מה עובד אצל המתווך הזה. נשמר ב-`preferences.mentor.ideas`
   * של המשתמש במיזוג אטומי ב-SQL (כמו פאנלי העזרה): שני מכשירים או
   * לשונית נגישות פתוחה אינם דורסים זה את זה. המפתח מאומת מול ספר
   * המשחק — מפתח שאינו רעיון נדחה.
   */
  async ideaFeedback(
    input: {
      ideaKey: string;
      verdict: "helped" | "dismissed";
    },
    now: Date = new Date(),
  ): Promise<{ ok: true; text: string }> {
    const { tenantId, userId } = TenantContext.current();
    const idea = ideaByKey(input.ideaKey);
    if (idea === null) throw new BadRequestException("רעיון לא מוכר");
    const list = input.verdict === "helped" ? "liked" : "dismissed";
    const other = input.verdict === "helped" ? "dismissed" : "liked";
    // הסימון עם תאריך — כדי למדוד בעוד שבוע אם המספר זז (`ideaMarksDue`)
    const mark = JSON.stringify([
      {
        key: input.ideaKey,
        verdict: input.verdict,
        date: jerusalemDayLabel(now),
      },
    ]);
    await this.prisma.withTenant(
      (tx) =>
        /*
         * מוסיפים לרשימה האחת ומסירים מהשנייה — משוב אחרון קובע. הרשימה
         * נחתכת למאתיים האחרונים בקריאה (`resolveIdeaFeedback`), ולכן
         * הכתיבה רק מוסיפה.
         */
        /*
         * ‎`jsonb_set` אינו יוצר צמתי ביניים: למשתמש בלי `mentor.ideas` הוא
         * מחזיר את הקלט בשקט. לכן בונים את `mentor` ⟵ `ideas` במפורש.
         */
        tx.$executeRaw`
        UPDATE users
        SET preferences = jsonb_set(
          COALESCE(preferences, '{}'::jsonb),
          '{mentor}',
          COALESCE(preferences -> 'mentor', '{}'::jsonb) || jsonb_build_object(
            'ideas',
            COALESCE(preferences -> 'mentor' -> 'ideas', '{}'::jsonb) || jsonb_build_object(
              ${list}::text,
              (COALESCE(preferences -> 'mentor' -> 'ideas' -> ${list}::text, '[]'::jsonb) - ${input.ideaKey}::text)
                || to_jsonb(${input.ideaKey}::text),
              ${other}::text,
              COALESCE(preferences -> 'mentor' -> 'ideas' -> ${other}::text, '[]'::jsonb) - ${input.ideaKey}::text,
              'marks',
              COALESCE((
                SELECT jsonb_agg(m.e ORDER BY m.i)
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(preferences -> 'mentor' -> 'ideas' -> 'marks') = 'array'
                    THEN preferences -> 'mentor' -> 'ideas' -> 'marks'
                    ELSE '[]'::jsonb
                  END || ${mark}::jsonb
                ) WITH ORDINALITY AS m(e, i)
                WHERE m.i > (
                  CASE
                    WHEN jsonb_typeof(preferences -> 'mentor' -> 'ideas' -> 'marks') = 'array'
                    THEN jsonb_array_length(preferences -> 'mentor' -> 'ideas' -> 'marks')
                    ELSE 0
                  END
                ) + 1 - ${IDEA_MARKS_MAX}::int
              ), '[]'::jsonb)
            )
          ),
          true
        )
        WHERE id = ${userId} AND tenant_id = ${tenantId}`,
    );
    return {
      ok: true,
      text:
        input.verdict === "helped"
          ? "רשמתי — עוד מהסוג הזה. בעוד שבוע אגיד לך אם המספר זז."
          : "רשמתי — הרעיון הזה לא יחזור. מחר יבוא אחר.",
    };
  }

  /**
   * המשוב מוואטסאפ — על רעיון הבוקר של היום, שנשמר בשליחה
   * (`preferences.mentor.lastIdea`). בלי רעיון מהיום אין על מה לענות.
   */
  async ideaFeedbackFromChat(
    verdict: "helped" | "dismissed",
    /** הרעיון שהכפתור הוצג עליו — כשיש, המשוב עליו ולא על „האחרון” */
    ideaKey?: string,
    now: Date = new Date(),
  ): Promise<string> {
    const { tenantId, userId } = TenantContext.current();
    if (ideaKey !== undefined) {
      const shown = ideaByKey(ideaKey);
      if (shown === null) return "לא זיהיתי על איזה רעיון — אפשר לענות מהמסך.";
      const result = await this.ideaFeedback({ ideaKey, verdict });
      return `${result.text} („${shown.text.slice(0, 80)}${shown.text.length > 80 ? "…" : ""}”)`;
    }
    const user = await this.prisma.withTenant((tx) =>
      tx.user.findFirst({
        where: { id: userId, tenantId },
        select: { preferences: true },
      }),
    );
    const last = lastIdeaOf(user?.preferences);
    if (last === null || last.date !== jerusalemDayLabel(now)) {
      return "אין רעיון מהבוקר של היום לתת עליו משוב — מחר בבוקר יגיע אחד, ואז הכפתורים כאן.";
    }
    const result = await this.ideaFeedback({ ideaKey: last.key, verdict });
    return `${result.text} („${last.text.slice(0, 80)}${last.text.length > 80 ? "…" : ""}”)`;
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
    threadId: string;
    role: string;
    text: string;
    createdAt: Date;
    feedback?: string | null;
    pinnedAt?: Date | null;
  }): MentorTurnDto {
    return {
      id: row.id,
      threadId: row.threadId,
      role: row.role as "user" | "mentor",
      text: row.text,
      createdAt: row.createdAt,
      /*
       * ‏שדות המשוב נכתבים תמיד, גם כשהם ריקים: הודעה שנוצרה עכשיו
       * ‏חוזרת מאותו טיפוס כמו הודעה שנטענה, והמסך אינו צריך לדעת
       * ‏מאיזה מסלול היא הגיעה.
       */
      feedback:
        row.feedback === "helpful" || row.feedback === "not_helpful"
          ? row.feedback
          : null,
      pinnedAt: row.pinnedAt?.toISOString() ?? null,
    };
  }
}

/** רעיון הבוקר האחרון שנשלח — נשמר בשליחה כדי שהמשוב מוואטסאפ ידע על מה. */
function lastIdeaOf(
  preferences: unknown,
): { key: string; text: string; date: string } | null {
  const mentor =
    typeof preferences === "object" && preferences !== null
      ? (preferences as { mentor?: unknown }).mentor
      : undefined;
  const last =
    typeof mentor === "object" && mentor !== null
      ? (mentor as { lastIdea?: unknown }).lastIdea
      : undefined;
  if (typeof last !== "object" || last === null) return null;
  const { key, text, date } = last as Record<string, unknown>;
  return typeof key === "string" &&
    typeof text === "string" &&
    typeof date === "string"
    ? { key, text, date }
    : null;
}
