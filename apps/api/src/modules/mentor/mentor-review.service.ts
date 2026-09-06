import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ulid } from "ulid";
import {
  jerusalemDayStart,
  jerusalemMonthStart,
  jerusalemWallIsoToUtc,
  jerusalemWallParts,
  jerusalemWeekStart,
  jerusalemWeekday,
  DEFAULT_MENTOR_PERSONA,
  mentorCadence,
  EMPTY_IDEA_FEEDBACK,
  ideaMarksDue,
  ideaOutcomeWindows,
  mentorIdeaOutcome,
  mentorMonthlyBody,
  mentorMonthlyReview,
  shiftDayLabel,
  mentorDailyIdeaPick,
  mentorDailyPlan,
  mentorGoalLabel,
  mentorMidweekNudge,
  mentorPatterns,
  mentorPeriodRange,
  PATTERN_LOOKBACK,
  mentorReviewBody,
  mentorReviewTitle,
  mentorWeeklyReview,
  resolveIdeaFeedback,
  resolveMentorPersona,
  selectWins,
  type MentorGoalMetric,
  type MentorGoalPeriod,
  type MentorIdeaFeedback,
  type MentorIdeaOutcome,
  type MentorMonthSignals,
  type MentorMonthWeek,
  type MentorPersona,
  type MentorReviewBody,
  type MentorWeekSignals,
} from "@metavchim/shared";
import { recordMentorWin } from "../../common/mentor-wins";
import { notifyOnce } from "../../common/notify-once";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import {
  MentorSignalsService,
  type MentorGoalRow,
} from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

/**
 * כל חצי שעה. הסיכום נכתב פעם בשבוע והבוקר פעם ביום, אבל יעד שהושג
 * נחגג באותו סבב — חצי שעה היא המרחק המרבי בין ההצעה החמישית לבין
 * „השגת את היעד”.
 */
const TICK_MS = 30 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 90 * 1000;
/** כמה סיכומים אחורה נקראים לחישוב הרצף. */
const STREAK_LOOKBACK = 26;

/**
 * הסיכום השבועי של המנטור — נבנה ונשלח מכאן (docs/14 §6).
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
   * החודש שהגיע זמנו לסכם — הקודם, מה-1 בחודש 10:00 שעון ישראל ועד
   * ה-7 (השלמה למי שהשרת היה למטה). ריק מחוץ לחלון. הבוקר של ה-1
   * ולא מוצאי שבת: החודש נגמר בתאריך, לא בשבוע.
   */
  static dueMonths(now: Date): Date[] {
    const thisMonth = jerusalemMonthStart(now);
    const label = jerusalemWallParts(thisMonth).date;
    const opens = jerusalemWallIsoToUtc(`${label.slice(0, 7)}-01T10:00:00.000`);
    const closes = jerusalemWallIsoToUtc(
      `${label.slice(0, 7)}-07T00:00:00.000`,
    );
    if (now < opens || now >= closes) return [];
    // היום שלפני ה-1 שייך לחודש הקודם — ומשם ל-1 שלו
    const previous = shiftDayLabel(label, -1).slice(0, 7);
    return [jerusalemWallIsoToUtc(`${previous}-01T00:00:00.000`)];
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

  /**
   * חלון הבוקר: ראשון–שישי, 08:00 עד 11:00 שעון ישראל. מחזיר את תאריך
   * היום („2026-09-06”) כשהחלון פתוח — המפתח של „פעם ביום” — ו-`null`
   * אחרת. לא לפני 08:00 כדי שלא להעיר, ולא אחרי 11:00: תוכנית ליום
   * שמגיעה בצהריים היא תוכנית לאתמול. שבת — אין בוקר.
   */
  static dailyWindow(now: Date): string | null {
    if (jerusalemWeekday(now) === 6) return null;
    const { date } = jerusalemWallParts(now);
    const opens = jerusalemWallIsoToUtc(`${date}T08:00:00.000`);
    const closes = jerusalemWallIsoToUtc(`${date}T11:00:00.000`);
    return now >= opens && now < closes ? date : null;
  }

  /**
   * השעות שבהן חגיגה על יעד נשלחת: 07:00 עד 22:00 שעון ישראל. יעד
   * שהושג בלילה נחגג בסבב הראשון של הבוקר — חגיגה בוואטסאפ ב-23:30
   * אינה חגיגה.
   */
  static awake(now: Date): boolean {
    const hour = Number(jerusalemWallParts(now).time.slice(0, 2));
    return hour >= 7 && hour < 22;
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
    const months = MentorReviewService.dueMonths(now);
    const nudgeWeek = MentorReviewService.nudgeWindow(now);
    const day = MentorReviewService.dailyWindow(now);
    const awake = MentorReviewService.awake(now);
    if (
      weeks.length === 0 &&
      months.length === 0 &&
      nudgeWeek === null &&
      day === null &&
      !awake
    )
      return 0;
    const tenants = await this.prisma.tenant.findMany({
      where: { status: { in: ["active", "trial"] } },
      select: { id: true },
    });
    let written = 0;
    for (const tenant of tenants) {
      if (!(await this.plans.tenantHasFeature(tenant.id, "ai_coach"))) continue;
      // קודם החגיגה — כדי שהבוקר של אותו סבב כבר יגיד „כבר הושג”
      if (awake) {
        try {
          written += await this.celebrateGoalsForTenant(tenant.id, now);
        } catch (error: unknown) {
          this.logger.warn(
            `חגיגת יעדים נכשלה למשרד ${tenant.id}: ${String(error)}`,
          );
        }
      }
      if (day !== null) {
        try {
          written += await this.dailyForTenant(tenant.id, day, now);
        } catch (error: unknown) {
          this.logger.warn(
            `הבוקר של המנטור נכשל למשרד ${tenant.id}: ${String(error)}`,
          );
        }
      }
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
      // אחרי השבועי — הסיכום של השבוע האחרון בחודש כבר כתוב כשהחודשי קורא אותו
      for (const monthStart of months) {
        try {
          written += await this.monthlyForTenant(tenant.id, monthStart);
        } catch (error: unknown) {
          this.logger.warn(
            `הסיכום החודשי של המנטור נכשל למשרד ${tenant.id}: ${String(error)}`,
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
   * חגיגת יעד שהושג — באותו יום, לא במוצאי שבת (docs/14 §2: חיזוק
   * קרוב לאירוע). כל סבב: לכל משתמש פעיל עם יעד פעיל, מודדים את
   * התקופה הנוכחית וכל יעד שב-`done` נרשם כהצלחה `goal_reached` עם
   * מפתח התקופה — `recordMentorWin` הוא שמבטיח פעם אחת לתקופה ושולח
   * את ההתראה. יעד שכבר נחגג בתקופה הזו מסונן **לפני** שסופרים, כדי
   * שהסבב לא ימדוד 48 פעמים ביום את מה שכבר נאמר.
   */
  async celebrateGoalsForTenant(tenantId: string, now: Date): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor-goals:${tenantId}`}))`;
      const goals = await tx.mentorGoal.findMany({
        where: { tenantId, endedAt: null, user: { isActive: true } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          userId: true,
          metric: true,
          period: true,
          target: true,
          why: true,
          intention: true,
          createdAt: true,
          endedAt: true,
        },
      });
      if (goals.length === 0) return 0;
      const week = mentorPeriodRange("week", now);
      const periodKey: Record<MentorGoalPeriod, string> = {
        week: jerusalemWallParts(week.start).date,
        month: jerusalemWallParts(mentorPeriodRange("month", now).start).date,
      };
      const celebrated = new Set(
        (
          await tx.mentorWin.findMany({
            where: {
              tenantId,
              kind: "goal_reached",
              entityId: { in: goals.map((g) => g.id) },
              periodKey: { in: [periodKey.week, periodKey.month] },
            },
            select: { entityId: true, periodKey: true },
          })
        ).map((w) => `${w.entityId}:${w.periodKey}`),
      );
      const pending = goals.filter(
        (g) =>
          !celebrated.has(`${g.id}:${periodKey[g.period as MentorGoalPeriod]}`),
      );
      const byUser = new Map<string, typeof pending>();
      for (const goal of pending) {
        byUser.set(goal.userId, [...(byUser.get(goal.userId) ?? []), goal]);
      }
      let sent = 0;
      for (const [userId, userGoals] of byUser) {
        sent += await this.celebrateGoalsForUser(
          tx,
          tenantId,
          userId,
          userGoals,
          now,
        );
      }
      return sent;
    });
  }

  /** כמה יעדים של המשתמש הושגו ונחגגו עכשיו (רק מבין `goals`). */
  async celebrateGoalsForUser(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    goals: MentorGoalRow[],
    now: Date,
  ): Promise<number> {
    const week = mentorPeriodRange("week", now);
    const activity = await this.signals.activity(
      tx,
      tenantId,
      userId,
      week,
      now,
    );
    const progress = await this.signals.progress(tx, tenantId, userId, goals, {
      at: now,
      week,
      weekActivity: activity,
      monthAnchor: now,
    });
    let sent = 0;
    for (const goal of progress) {
      if (goal.progress.pace !== "done") continue;
      const inserted = await recordMentorWin(tx, {
        tenantId,
        userId,
        kind: "goal_reached",
        entityType: "mentor_goal",
        entityId: goal.id,
        title: mentorGoalLabel(
          goal.metric as MentorGoalMetric,
          goal.target,
          goal.period as MentorGoalPeriod,
        ),
        periodKey: jerusalemWallParts(goal.progress.periodStart).date,
        // ההתראה נוחתת במסך המנטור — שם היעד שהושג
        notifyEntityType: "mentor",
      });
      if (inserted) sent += 1;
    }
    return sent;
  }

  /**
   * הבוקר של המנטור — לכל משתמש פעיל, פעם ביום, בחלון 08:00–11:00
   * (docs/14 §3). מי שכבר קיבל היום מסונן לפני שסופרים; מי שאין לו
   * מה לשמוע (`mentorDailyPlan` מחזיר `null`) לא מקבל „בוקר טוב” ריק.
   */
  async dailyForTenant(
    tenantId: string,
    day: string,
    now: Date,
  ): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor-daily:${tenantId}:${day}`}))`;
      const greeted = new Set(
        (
          await tx.notification.findMany({
            where: {
              tenantId,
              type: "mentor_daily",
              createdAt: { gte: jerusalemDayStart(now) },
            },
            select: { userId: true },
          })
        ).map((n) => n.userId),
      );
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, preferences: true },
      });
      let sent = 0;
      for (const user of users) {
        if (greeted.has(user.id)) continue;
        if (
          await this.dailyForUser(
            tx,
            tenantId,
            user.id,
            day,
            now,
            firstNameOf(user.name),
            resolveMentorPersona(user.preferences),
            resolveIdeaFeedback(user.preferences),
          )
        )
          sent += 1;
      }
      return sent;
    });
  }

  /**
   * ‎`true` = נשלחה תוכנית ליום; ‎`false` = אין מה לומר היום, או שהמתווך
   * בחר סגנון רגוע — בלי הודעת בוקר (docs/14 §4.1).
   */
  async dailyForUser(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    day: string,
    now: Date,
    firstName = "",
    persona: MentorPersona = DEFAULT_MENTOR_PERSONA,
    feedback: MentorIdeaFeedback = EMPTY_IDEA_FEEDBACK,
  ): Promise<boolean> {
    if (!mentorCadence(persona.style).morning) return false;
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
    const insights = await this.signals.insights(
      tx,
      tenantId,
      userId,
      week,
      null,
    );
    // „אתמול” — יום הלוח הישראלי הקודם; בראשון אתמול היה שבת, ואין מה לשבח
    const yesterday =
      jerusalemWeekday(now) === 0
        ? null
        : await this.signals.activity(
            tx,
            tenantId,
            userId,
            { start: jerusalemDayStart(now, -1), end: jerusalemDayStart(now) },
            now,
          );
    // רעיון אחד מספר המשחק, על מדד המיקוד — מתחלף כל יום, בלי מה שנדחה
    const idea = mentorDailyIdeaPick(goals, now, feedback);
    const plan = mentorDailyPlan({
      goals,
      insights,
      yesterday,
      idea: idea.text,
      now,
      persona,
      ...(firstName === "" ? {} : { firstName }),
    });
    if (plan === null) return false;
    const sent = await notifyOnce(tx, {
      tenantId,
      dedupeKey: `mentor_daily:${userId}:${day}`,
      userId,
      type: "mentor_daily",
      title: plan.title,
      body: plan.body.slice(0, 500),
      entityType: "mentor",
      entityId: null,
    });
    if (sent && plan.body.includes(idea.text)) {
      /*
       * הרעיון שנשלח נשמר על המשתמש — כדי ש„עזר לי” / „לא בשבילי”
       * מוואטסאפ ידעו על מה (docs/14 §7.2). מיזוג אטומי של מפתח אחד,
       * לא דריסה של כל ההעדפות.
       */
      // ‎`jsonb_set` אינו יוצר את `mentor` כשאין — בונים אותו במפורש
      await tx.$executeRaw`
        UPDATE users
        SET preferences = jsonb_set(
          COALESCE(preferences, '{}'::jsonb),
          '{mentor}',
          COALESCE(preferences -> 'mentor', '{}'::jsonb) || jsonb_build_object(
            'lastIdea',
            ${JSON.stringify({ key: idea.key, text: idea.text, date: day })}::jsonb
          ),
          true
        )
        WHERE id = ${userId} AND tenant_id = ${tenantId}`;
    }
    return sent;
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
        select: {
          userId: true,
          user: { select: { name: true, preferences: true } },
        },
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
            resolveMentorPersona(user.preferences),
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
    persona: MentorPersona = DEFAULT_MENTOR_PERSONA,
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
    const nudge = mentorMidweekNudge(goals, now, firstName, persona);
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
        select: { id: true, createdAt: true, name: true, preferences: true },
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
            resolveMentorPersona(user.preferences),
            resolveIdeaFeedback(user.preferences),
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
    persona: MentorPersona = DEFAULT_MENTOR_PERSONA,
    feedback: MentorIdeaFeedback = EMPTY_IDEA_FEEDBACK,
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
    const insights = await this.signals.insights(
      tx,
      tenantId,
      userId,
      week,
      previousActivity === undefined
        ? null
        : { start: prevStart, end: weekStart },
    );
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
    /*
     * האם הרעיון עבד: „עזר לי” שסומן לפני שבוע נמדד עכשיו — המדד של
     * הרעיון בשבוע מהסימון מול השבוע שלפניו (docs/14 §7.2). כל סימון
     * נמדד פעם אחת, בסיכום של השבוע שבו חלונו נסגר.
     */
    const ideaOutcomes: MentorIdeaOutcome[] = [];
    for (const mark of ideaMarksDue(feedback.marks, week)) {
      const windows = ideaOutcomeWindows(mark);
      const [before, after] = await Promise.all([
        this.signals.activity(tx, tenantId, userId, windows.before, weekEnd),
        this.signals.activity(tx, tenantId, userId, windows.after, weekEnd),
      ]);
      const outcome = mentorIdeaOutcome(mark, before, after);
      if (outcome !== null) ideaOutcomes.push(outcome);
    }

    const signals: MentorWeekSignals = {
      patterns,
      persona,
      feedback,
      ideaOutcomes,
      ...(firstName === "" ? {} : { firstName }),
      insights,
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
    const reviewId = ulid();
    await tx.mentorReview.create({
      data: {
        id: reviewId,
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
      /*
       * מזהה הסיכום — כדי שהעובד ידע אילו כפתורים יש לו לתת: „מתחייב”
       * רק כשיש בקשה לשבוע הבא, „לענות למנטור” רק כשיש שאלה. כפתור
       * שמוביל ל„אין בקשה” הוא הבטחה שנשברת (ביקורת Codex).
       */
      entityId: reviewId,
    });
    return true;
  }

  /** סיכום חודשי לכל משתמש פעיל במשרד שאין לו עדיין סיכום לחודש. */
  async monthlyForTenant(tenantId: string, monthStart: Date): Promise<number> {
    return this.prisma.withExplicitTenant(tenantId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor-monthly:${tenantId}:${monthStart.toISOString()}`}))`;
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, createdAt: true, name: true, preferences: true },
      });
      const done = new Set(
        (
          await tx.mentorMonthlyReview.findMany({
            where: { tenantId, monthStart },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      );
      let written = 0;
      for (const user of users) {
        if (done.has(user.id)) continue;
        if (
          await this.monthlyForUser(
            tx,
            tenantId,
            user.id,
            user.createdAt,
            monthStart,
            firstNameOf(user.name),
            resolveMentorPersona(user.preferences),
            resolveIdeaFeedback(user.preferences),
          )
        )
          written += 1;
      }
      return written;
    });
  }

  /**
   * הסיכום החודשי של משתמש אחד (docs/14 §3) — מהמונים של החודש,
   * מהסיכומים השבועיים שכבר נאמרו (היעדים כפי שנמדדו, ומה נמדד על
   * „עזר לי”) ומהסימונים של החודש. ‎`true` = נכתב; ‎`false` = חודש
   * בלי מה לומר.
   */
  async monthlyForUser(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    userCreatedAt: Date,
    monthStart: Date,
    firstName = "",
    persona: MentorPersona = DEFAULT_MENTOR_PERSONA,
    feedback: MentorIdeaFeedback = EMPTY_IDEA_FEEDBACK,
  ): Promise<boolean> {
    const month = mentorPeriodRange("month", monthStart);
    // רגע לפני ה-1 שייך לחודש שלפניו
    const previous = mentorPeriodRange(
      "month",
      new Date(monthStart.getTime() - 1),
    );
    const activity = await this.signals.activity(
      tx,
      tenantId,
      userId,
      month,
      month.end,
    );
    const previousActivity =
      userCreatedAt < monthStart
        ? await this.signals.activity(
            tx,
            tenantId,
            userId,
            previous,
            monthStart,
          )
        : undefined;
    const wins = await this.signals.wins(tx, tenantId, userId, month);
    // השבוע שייך לחודש שהוא מתחיל בו
    const reviews = await tx.mentorReview.findMany({
      where: {
        tenantId,
        userId,
        weekStart: { gte: month.start, lt: month.end },
      },
      orderBy: { weekStart: "asc" },
      select: { weekStart: true, body: true },
    });
    const weeks: MentorMonthWeek[] = reviews.map((row) => {
      const body = (row.body ?? {}) as Partial<MentorReviewBody>;
      return {
        weekStart: row.weekStart,
        goals: Array.isArray(body.goals) ? body.goals : [],
        ...(Array.isArray(body.ideaOutcomes)
          ? { ideaOutcomes: body.ideaOutcomes }
          : {}),
      };
    });
    const startLabel = jerusalemWallParts(month.start).date;
    const endLabel = jerusalemWallParts(month.end).date;
    const marks = feedback.marks.filter(
      (m) => m.date >= startLabel && m.date < endLabel,
    );
    const signals: MentorMonthSignals = {
      monthStart,
      activity,
      ...(previousActivity === undefined ? {} : { previousActivity }),
      wins,
      weeks,
      marks,
      feedback,
      persona,
      ...(firstName === "" ? {} : { firstName }),
    };
    const review = mentorMonthlyReview(signals);
    if (review === null) return false;
    const reviewId = ulid();
    await tx.mentorMonthlyReview.create({
      data: {
        id: reviewId,
        tenantId,
        userId,
        monthStart,
        headline: review.headline,
        body: mentorMonthlyBody(signals, review) as object,
      },
    });
    const text = [review.greeting ?? "", ...review.paragraphs]
      .filter((p) => p !== "")
      .join(" ");
    await notifyOnce(tx, {
      tenantId,
      dedupeKey: `mentor_monthly:${userId}:${monthStart.toISOString()}`,
      userId,
      type: "mentor_monthly",
      title: review.headline,
      body: text.slice(0, 500),
      entityType: "mentor",
      entityId: reviewId,
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
