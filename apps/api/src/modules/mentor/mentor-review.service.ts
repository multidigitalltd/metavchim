import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  jerusalemDayStart,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  jerusalemWeekStart,
  mentorMidweekNudge,
  mentorPatterns,
  mentorPeriodRange,
  PATTERN_LOOKBACK,
  mentorReviewBody,
  mentorReviewTitle,
  mentorWeeklyReview,
  selectWins,
  type MentorReviewBody,
  type MentorWeekSignals,
} from "@metavchim/shared";
import { notifyOnce } from "../../common/notify-once";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

/** כל חצי שעה — הסיכום נכתב פעם בשבוע, והסבב רק מחפש שבוע שהגיע זמנו. */
const TICK_MS = 30 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 90 * 1000;
/** כמה סיכומים אחורה נקראים לחישוב הרצף. */
const STREAK_LOOKBACK = 26;

/**
 * הסיכום השבועי של המנטור — נבנה ונשלח מכאן (docs/13 §6).
 *
 * ## למה ב-API ולא בוורקר
 *
 * המונים של §5.1 חיים ב-`MentorSignalsService`, ואותם מונים בדיוק
 * מציג המסך. וורקר היה צריך עותק שני של שש השאילתות, ושני עותקים
 * נפרדים ביום שמתקנים אחד מהם — הסיכום היה אומר „3 סיורים” והמסך
 * „2”. ל-API כבר יש דפוס של סבב מתוזמן (`ViewingReminderService`),
 * והסיכום נכנס לאותה תבנית.
 *
 * ## מתי
 *
 * מוצאי שבת 20:00 שעון ישראל, על השבוע שמסתיים. השבוע נמדד כסגור
 * (`at = weekEnd`): הסיכום הוא פסק הדין על השבוע, לא תחזית. סבב
 * שפספס (השרת היה למטה) משלים את השבוע הקודם עד יום שלישי — אחרי
 * זה סיכום על שבוע שעבר-שעבר הוא רעש.
 *
 * ## אידמפוטנטיות
 *
 * ייחודיות על (דייר, משתמש, תחילת שבוע) + נעילת advisory לדייר:
 * שני סבבים מקבילים אינם כותבים פעמיים, וההתראה נושאת אותו מפתח.
 */
@Injectable()
export class MentorReviewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MentorReviewService.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanCatalogService,
    private readonly signals: MentorSignalsService,
  ) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, FIRST_TICK_DELAY_MS);
    this.first.unref?.();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** השבועות שהגיע זמנם ברגע נתון — פונקציה טהורה, נבדקת. */
  static dueWeeks(now: Date): Date[] {
    const thisWeek = jerusalemWeekStart(now);
    const due: Date[] = [];
    // מוצאי שבת של השבוע הנוכחי, 20:00 שעון ישראל
    const saturday = jerusalemWallParts(jerusalemDayStart(thisWeek, 6)).date;
    if (now >= jerusalemWallIsoToUtc(`${saturday}T20:00:00.000`))
      due.push(thisWeek);
    // השלמה של שבוע שעבר — עד יום שלישי
    const catchUpUntil = jerusalemDayStart(thisWeek, 2);
    if (now < catchUpUntil) due.push(jerusalemWeekStart(now, -1));
    return due;
  }

  /**
   * חלון הדחיפה של אמצע השבוע: רביעי 12:00 עד שישי 12:00 שעון ישראל.
   * מחזיר את תחילת השבוע כשהחלון פתוח, ‎`null` אחרת. לא לפני רביעי —
   * אין עוד מה לומר; לא אחרי שישי בצהריים — אין עוד מה לעשות.
   */
  static nudgeWindow(now: Date): Date | null {
    const thisWeek = jerusalemWeekStart(now);
    const wednesday = jerusalemWallParts(jerusalemDayStart(thisWeek, 3)).date;
    const friday = jerusalemWallParts(jerusalemDayStart(thisWeek, 5)).date;
    const opens = jerusalemWallIsoToUtc(`${wednesday}T12:00:00.000`);
    const closes = jerusalemWallIsoToUtc(`${friday}T12:00:00.000`);
    return now >= opens && now < closes ? thisWeek : null;
  }

  async tick(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.sweep(now);
    } catch (error: unknown) {
      this.logger.error(`סבב הסיכום השבועי של המנטור נכשל: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async sweep(now: Date): Promise<number> {
    const weeks = MentorReviewService.dueWeeks(now);
    const nudgeWeek = MentorReviewService.nudgeWindow(now);
    if (weeks.length === 0 && nudgeWeek === null) return 0;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });
    let written = 0;
    for (const tenant of tenants) {
      if (!(await this.plans.tenantHasFeature(tenant.id, "ai_coach"))) continue;
      for (const weekStart of weeks) {
        try {
          written += await this.generateForTenant(tenant.id, weekStart);
        } catch (error: unknown) {
          // משרד אחד שנכשל אינו עוצר את השאר — זו סריקה, לא עסקה
          this.logger.warn(
            `סיכום המנטור נכשל למשרד ${tenant.id}: ${String(error)}`,
          );
        }
      }
      if (nudgeWeek !== null) {
        try {
          written += await this.nudgeForTenant(tenant.id, nudgeWeek, now);
        } catch (error: unknown) {
          this.logger.warn(
            `דחיפת אמצע השבוע נכשלה למשרד ${tenant.id}: ${String(error)}`,
          );
        }
      }
    }
    return written;
  }

  /**
   * דחיפת אמצע השבוע לכל משתמש פעיל עם יעד שבועי בפיגור — פעם אחת
   * לשבוע. הסבב רץ כל חצי שעה, ולכן מי שכבר קיבל מסונן לפני שסופרים:
   * הספירה זולה, אבל לא בחינם.
   */
  async nudgeForTenant(
    tenantId: string,
    weekStart: Date,
    now: Date,
  ): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor-nudge:${tenantId}:${weekStart.toISOString()}`}))`;
      const nudged = new Set(
        (
          await tx.notification.findMany({
            where: {
              tenantId,
              type: "mentor_nudge",
              createdAt: { gte: weekStart },
            },
            select: { userId: true },
          })
        ).map((n) => n.userId),
      );
      // רק משתמשים פעילים עם יעד שבועי פעיל — משתמש שהושבת שומר על
      // מינויי הפוש שלו, והדחיפה הייתה ממשיכה להגיע (ביקורת Codex)
      const withGoals = await tx.mentorGoal.findMany({
        where: {
          tenantId,
          period: "week",
          endedAt: null,
          user: { isActive: true },
        },
        distinct: ["userId"],
        select: { userId: true, user: { select: { name: true } } },
      });
      let sent = 0;
      for (const { userId, user } of withGoals) {
        if (nudged.has(userId)) continue;
        if (
          await this.nudgeForUser(
            tx,
            tenantId,
            userId,
            weekStart,
            now,
            firstNameOf(user.name),
          )
        )
          sent += 1;
      }
      return sent;
    });
  }

  /** ‎`true` = נשלחה דחיפה; ‎`false` = הכול בקצב, או שאין יעדים. */
  async nudgeForUser(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    weekStart: Date,
    now: Date,
    firstName = "",
  ): Promise<boolean> {
    const week = mentorPeriodRange("week", now);
    const activity = await this.signals.activity(
      tx,
      tenantId,
      userId,
      week,
      now,
    );
    /*
     * רק יעדים **פעילים** — לא כמו בסיכום, שסופר גם יעד שהופסק
     * במהלך השבוע. יעד שהוחלף ביום שני היה יכול להיבחר כ„הרחוק ביותר
     * מהקצב” ולהזכיר מספר שכבר אינו היעד (ביקורת Codex).
     */
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
    const nudge = mentorMidweekNudge(goals, now, firstName);
    if (nudge === null) return false;
    return notifyOnce(tx, {
      tenantId,
      dedupeKey: `mentor_nudge:${userId}:${weekStart.toISOString()}`,
      userId,
      type: "mentor_nudge",
      title: nudge.title,
      body: nudge.body.slice(0, 500),
      entityType: "mentor",
      entityId: null,
    });
  }

  /** סיכומים לכל משתמש פעיל במשרד שאין לו עדיין סיכום לשבוע. */
  async generateForTenant(tenantId: string, weekStart: Date): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor-weekly:${tenantId}:${weekStart.toISOString()}`}))`;
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, createdAt: true, name: true },
      });
      const done = new Set(
        (
          await tx.mentorReview.findMany({
            where: { tenantId, weekStart },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      );
      let written = 0;
      for (const user of users) {
        if (done.has(user.id)) continue;
        if (
          await this.generateForUser(
            tx,
            tenantId,
            user.id,
            user.createdAt,
            weekStart,
            firstNameOf(user.name),
          )
        )
          written += 1;
      }
      return written;
    });
  }

  /** ‎`true` = נכתב סיכום; ‎`false` = לא היה מה לומר. */
  async generateForUser(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    userCreatedAt: Date,
    weekStart: Date,
    /** השם הפרטי — לפתיח אישי. ריק = בלי פתיח */
    firstName = "",
  ): Promise<boolean> {
    const weekEnd = jerusalemWeekStart(weekStart, 1);
    const prevStart = jerusalemWeekStart(weekStart, -1);
    const week = { start: weekStart, end: weekEnd };

    const activity = await this.signals.activity(
      tx,
      tenantId,
      userId,
      week,
      weekEnd,
    );
    // מתווך שהצטרף השבוע — אין מול מה להשוות
    const previousActivity =
      userCreatedAt < weekStart
        ? await this.signals.activity(
            tx,
            tenantId,
            userId,
            { start: prevStart, end: weekStart },
            weekStart,
          )
        : undefined;
    const goalRows = await this.signals.goalsActiveIn(
      tx,
      tenantId,
      userId,
      week,
    );
    const goalsWithRows = await this.signals.progress(
      tx,
      tenantId,
      userId,
      goalRows,
      {
        at: weekEnd,
        week,
        weekActivity: activity,
        // שבת — היום האחרון של השבוע, ולכן החודש שהשבוע באמת שייך לו
        monthAnchor: jerusalemDayStart(weekEnd, -1),
      },
    );
    const goals = goalsWithRows.map((g) => g.progress);
    const wins = selectWins(
      await this.signals.wins(tx, tenantId, userId, week),
    );

    const allGoalsMet =
      goals.length > 0 && goals.every((g) => g.pace === "done");
    const streakWeeks = allGoalsMet
      ? 1 + (await this.previousStreak(tx, tenantId, userId, weekStart))
      : 0;

    /*
     * המחויבות מהסיכום הקודם — נבדקת מול היעד **של השבוע הזה** על
     * אותו מדד ותקופה, ורק אם הוא **עדיין פעיל**. יעד שהופסק בינתיים
     * (גם באמצע השבוע — `goalsActiveIn` עדיין מחזיר אותו לסיכום)
     * אינו נבדק: אי אפשר לעמוד במה שכבר לא קיים, ואי אפשר גם להיכשל
     * בו.
     */
    const previousReview = await tx.mentorReview.findFirst({
      where: { tenantId, userId, weekStart: prevStart },
      select: { commitment: true, body: true },
    });
    const previousAsk =
      (previousReview?.body as Partial<MentorReviewBody> | null)?.ask ?? null;
    const committedGoal =
      previousReview?.commitment === "accepted" && previousAsk
        ? goalsWithRows.find(
            (g) =>
              g.endedAt === null &&
              g.progress.metric === previousAsk.metric &&
              g.progress.period === previousAsk.period,
          )?.progress
        : undefined;
    const previousCommitment =
      previousAsk && committedGoal !== undefined
        ? {
            metric: previousAsk.metric,
            period: previousAsk.period,
            target: previousAsk.target,
            kept: committedGoal.actual >= previousAsk.target,
          }
        : undefined;

    const past = await tx.mentorReview.findMany({
      where: { tenantId, userId, weekStart: { lt: weekStart } },
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
    // „היום” של הסיכום הוא סוף השבוע שמסכמים — גם בסבב השלמה מאוחר
    const patterns = mentorPatterns(
      past.map(MentorService.toPastReview),
      weekEnd,
    );

    const signals: MentorWeekSignals = {
      patterns,
      ...(firstName === "" ? {} : { firstName }),
      weekStart,
      wins,
      activity,
      ...(previousActivity === undefined ? {} : { previousActivity }),
      goals,
      streakWeeks,
      ...(previousCommitment === undefined ? {} : { previousCommitment }),
    };
    const review = mentorWeeklyReview(signals);
    if (review === null) return false;

    const body = mentorReviewBody(signals, review);
    await tx.mentorReview.create({
      data: {
        id: ulid(),
        tenantId,
        userId,
        weekStart,
        mood: review.mood,
        headline: review.headline,
        body: body as object,
      },
    });
    const text = [
      review.greeting ?? "",
      ...review.paragraphs,
      review.askNextWeek ?? "",
    ]
      .filter((p) => p !== "")
      .join(" ");
    await notifyOnce(tx, {
      tenantId,
      dedupeKey: `mentor_weekly:${userId}:${weekStart.toISOString()}`,
      userId,
      type: "mentor_weekly",
      title: mentorReviewTitle(review),
      body: text.slice(0, 500),
      entityType: "mentor",
      entityId: null,
    });
    return true;
  }

  /** כמה שבועות רצופים לפני `weekStart` כל היעדים הושגו. */
  private async previousStreak(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    weekStart: Date,
  ): Promise<number> {
    const previous = await tx.mentorReview.findMany({
      where: { tenantId, userId, weekStart: { lt: weekStart } },
      orderBy: { weekStart: "desc" },
      take: STREAK_LOOKBACK,
      select: { weekStart: true, body: true },
    });
    let streak = 0;
    let expected = jerusalemWeekStart(weekStart, -1);
    for (const row of previous) {
      // רצף הוא שבועות **עוקבים** — שבוע בלי סיכום שובר אותו
      if (row.weekStart.getTime() !== expected.getTime()) break;
      const body = row.body as Partial<MentorReviewBody> | null;
      if (body?.allGoalsMet !== true) break;
      streak += 1;
      expected = jerusalemWeekStart(expected, -1);
    }
    return streak;
  }
}

/** השם הפרטי מתוך השם המלא — לפנייה אישית; ריק כשאין שם. */
function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/u)[0] ?? "";
}
