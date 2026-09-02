import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  backwardPlan,
  comparePeriods,
  DEFAULT_RATIOS,
  GOAL_HORIZONS,
  goalPeriod,
  jerusalemDayStart,
  jerusalemWeekday,
  jerusalemWeekStart,
  LEAD_MEASURES,
  mentorMoments,
  splitToHorizon,
  weeklyScore,
  weekKey,
  type BackwardPlan,
  type ConversionRatios,
  type GoalHorizon,
  type GoalUnit,
  type LeadMeasure,
  type MentorMoment,
  type PeriodComparison,
  type WeeklyActual,
  type WeeklyCommitment,
  type WeeklyScore,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**המנטור האישי — הצד שיודע ומודד.**
 *
 * ## מה השירות הזה עושה, ומה במפורש לא
 *
 * ‏הוא עונה על שתי שאלות: „מה היעד” ו„מה עשיתי בפועל”. הוא **אינו**
 * שולח דבר — ההודעות בוואטסאפ הן הסורק היומי, והוא נשען על אותם
 * חישובים בדיוק. ההפרדה חשובה: מסך שנפתח אינו מייצר הודעה, ולכן
 * מתווך שבודק את הציון שלוש פעמים ביום אינו מקבל שלוש חגיגות.
 *
 * ## הכלל שמנחה כל שאילתה כאן
 *
 * ‎**המתווך לא מדווח כלום.** כל ארבעת המדדים נספרים ממה שכבר במערכת
 * — שיחות מהמרכזייה, פגישות ביומן, הצעות שנשלחו, נכסים שנקלטו.
 * אפליקציית יעדים מבקשת „סמן שעשית”; מנטור כבר יודע. מה שהמתווך
 * מזין הוא רק **היעד**, וזה גם כל מה שהמסך מבקש ממנו.
 *
 * ## אישי, ולא משרדי
 *
 * ‏כל שאילתה כאן מסננת לפי `ctx.userId` בנוסף ל-RLS. יעד הוא הדבר
 * הפרטי ביותר שמתווך כותב במערכת הזו — כולל מה שעצר אותו בשבוע
 * שעבר — ומנהל שרואה את היעד של הסוכן שלו הוא לא מנטור, הוא מפקח.
 */

/** יעד אחד, כפי שהמסך מקבל אותו. */
export interface MentorGoalDto {
  horizon: GoalHorizon;
  unit: GoalUnit;
  /** עמלות — באגורות; עסקאות ובלעדיות — ספירה. */
  target: number;
  averageCommissionAgorot?: number;
  ratios: ConversionRatios;
  commitment: WeeklyCommitment;
  obstacle?: string;
  ifThenPlan?: string;
  periodStart: string;
  periodEnd: string;
  achievedAt?: Date;
}

/** השוואה של מדד אחד בין שתי תקופות — „איפה היית”. */
export interface MeasureComparison extends PeriodComparison {
  measure: LeadMeasure;
}

export interface MentorOverviewDto {
  goals: MentorGoalDto[];
  /** החישוב לאחור מהיעד השנתי. `null` כשאין יעד שנתי. */
  plan: BackwardPlan | null;
  /** ‏היעד השנתי פרוס לכל אחת מהרמות — גם לרמות שטרם נקבעו. */
  suggested: { horizon: GoalHorizon; target: number }[];
  week: {
    weekKey: string;
    weekday: number;
    committed: WeeklyCommitment;
    actual: WeeklyActual;
    score: WeeklyScore;
    previousPercent?: number;
  };
  moments: MentorMoment[];
  /** ארבעת המדדים, השבוע מול השבוע שעבר. */
  weekOverWeek: MeasureComparison[];
  /** ארבעת המדדים, שלושה-עשר השבועות האחרונים מול אלה שלפניהם. */
  cycleOverCycle: MeasureComparison[];
  /** ‏יחסי ההמרה שנגזרו מההיסטוריה שלו, או `null` כשאין מספיק. */
  derivedRatios: ConversionRatios | null;
  /** ‎`true` כשהיחסים בשימוש הם ברירת המחדל הענפית ולא שלו. */
  usingDefaultRatios: boolean;
}

/** מה שהמסך שולח כשהוא קובע או מעדכן יעד. */
export interface SaveGoalInput {
  unit: GoalUnit;
  target: number;
  averageCommissionAgorot?: number;
  commitment?: WeeklyCommitment;
  obstacle?: string;
  ifThenPlan?: string;
}

/*
 * ‎**כמה שבועות היסטוריה נדרשים לפני שמחשבים יחסי המרה משלו.**
 *
 * ‏יחס שנגזר משבועיים הוא רעש: שבוע אחד עם שתי פגישות ואפס עסקאות
 * היה קובע ש-0% מהפגישות נסגרות, והתוכנית שנבנית עליו דורשת אינסוף
 * שיחות. שלושה-עשר שבועות הם מחזור שלם — מספיק כדי שהמספר יאמר
 * משהו, ומעט מספיק כדי שהוא יתאר את המתווך של היום.
 */
const MIN_WEEKS_FOR_RATIOS = 13;

/** ‏המרה בטוחה של JSON מהמסד למחויבות שבועית. */
function toCommitment(value: unknown): WeeklyCommitment {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: WeeklyCommitment = {};
  for (const measure of LEAD_MEASURES) {
    const n = raw[measure];
    if (typeof n === "number" && Number.isFinite(n) && n > 0) out[measure] = Math.floor(n);
  }
  return out;
}

/** ‏המרה בטוחה של JSON מהמסד ליחסי המרה. חסר ⇒ ברירת המחדל. */
function toRatios(value: unknown): ConversionRatios {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_RATIOS;
  }
  const raw = value as Record<string, unknown>;
  const pick = (key: keyof ConversionRatios): number => {
    const n = raw[key];
    return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1
      ? n
      : DEFAULT_RATIOS[key];
  };
  return {
    callToAppointment: pick("callToAppointment"),
    appointmentToOffer: pick("appointmentToOffer"),
    offerToDeal: pick("offerToDeal"),
  };
}

/** ‏תאריך בשעון ישראל כמחרוזת `YYYY-MM-DD` ⇒ `Date` בחצות שלו. */
function dayToDate(label: string): Date {
  return new Date(`${label}T00:00:00.000Z`);
}

@Injectable()
export class MentorService {
  constructor(private readonly prisma: PrismaService) {}

  /* ======================================================================
   * ‏קריאה: כל מה שהמסך צריך, בקריאה אחת
   * ====================================================================== */

  async overview(now = new Date()): Promise<MentorOverviewDto> {
    const ctx = TenantContext.current();
    const scope = { tenantId: ctx.tenantId, userId: ctx.userId };

    return this.prisma.withTenant(async (tx): Promise<MentorOverviewDto> => {
      const rows = await tx.mentorGoal.findMany({ where: { ...scope } });

      /*
       * ‏רק היעדים של **התקופה הנוכחית**. שורות של מחזורים שחלפו
       * נשארות במסד — הן ההיסטוריה שההשוואה „איפה היית” נשענת
       * עליה — אבל המסך מציג את מה שפתוח עכשיו.
       */
      const goals: MentorGoalDto[] = [];
      for (const horizon of GOAL_HORIZONS) {
        const period = goalPeriod(horizon, now);
        const row = rows.find(
          (r) =>
            r.horizon === horizon &&
            r.periodStart.toISOString().slice(0, 10) === period.start,
        );
        if (row === undefined) continue;
        goals.push({
          horizon,
          unit: row.unit as GoalUnit,
          target: Number(row.targetAgorot),
          ...(row.averageCommissionAgorot === null
            ? {}
            : { averageCommissionAgorot: Number(row.averageCommissionAgorot) }),
          ratios: toRatios(row.ratios),
          commitment: toCommitment(row.commitment),
          ...(row.obstacle === null ? {} : { obstacle: row.obstacle }),
          ...(row.ifThenPlan === null ? {} : { ifThenPlan: row.ifThenPlan }),
          periodStart: period.start,
          periodEnd: period.end,
          ...(row.achievedAt === null ? {} : { achievedAt: row.achievedAt }),
        });
      }

      const yearly = goals.find((g) => g.horizon === "year");
      const weekGoal = goals.find((g) => g.horizon === "week");

      /* ---- החישוב לאחור, על היחסים שלו כשיש ---- */
      const derivedRatios = await this.deriveRatios(tx, scope, now);
      const ratios = derivedRatios ?? yearly?.ratios ?? DEFAULT_RATIOS;
      const plan =
        yearly === undefined
          ? null
          : backwardPlan({
              target: yearly.target,
              unit: yearly.unit,
              ...(yearly.averageCommissionAgorot === undefined
                ? {}
                : { averageCommissionAgorot: yearly.averageCommissionAgorot }),
              ratios,
            });

      const suggested =
        yearly === undefined
          ? []
          : GOAL_HORIZONS.filter((h) => h !== "year").map((horizon) => ({
              horizon,
              target: splitToHorizon(yearly.target, horizon),
            }));

      /* ---- הציון של השבוע, ממה שהמערכת ספרה ---- */
      const thisWeek = jerusalemWeekStart(now);
      const actual = await this.countMeasures(tx, scope, thisWeek, jerusalemDayStart(thisWeek, 7));
      const committed = weekGoal?.commitment ?? {};
      const score = weeklyScore(committed, actual);

      const previousRow = await tx.mentorWeeklyScore.findFirst({
        where: { ...scope, weekKey: weekKey(jerusalemWeekStart(now, -1)) },
        select: { percent: true },
      });

      const moments = mentorMoments({
        score,
        weekday: jerusalemWeekday(now),
        ...(previousRow === null ? {} : { previousPercent: previousRow.percent }),
      });

      /* ---- „איפה היית” ---- */
      const previousWeek = await this.countMeasures(
        tx,
        scope,
        jerusalemWeekStart(now, -1),
        thisWeek,
      );
      const cycleStart = jerusalemWeekStart(now, -12);
      const priorCycleStart = jerusalemWeekStart(now, -25);
      const thisCycle = await this.countMeasures(
        tx,
        scope,
        cycleStart,
        jerusalemDayStart(thisWeek, 7),
      );
      const lastCycle = await this.countMeasures(tx, scope, priorCycleStart, cycleStart);

      return {
        goals,
        plan,
        suggested,
        week: {
          weekKey: weekKey(now),
          weekday: jerusalemWeekday(now),
          committed,
          actual,
          score,
          ...(previousRow === null ? {} : { previousPercent: previousRow.percent }),
        },
        moments,
        weekOverWeek: LEAD_MEASURES.map((measure) => ({
          measure,
          ...comparePeriods(actual[measure] ?? 0, previousWeek[measure] ?? 0),
        })),
        cycleOverCycle: LEAD_MEASURES.map((measure) => ({
          measure,
          ...comparePeriods(thisCycle[measure] ?? 0, lastCycle[measure] ?? 0),
        })),
        derivedRatios,
        usingDefaultRatios: derivedRatios === null,
      };
    });
  }

  /* ======================================================================
   * ‏כתיבה: יעד לרמה אחת, לתקופה הנוכחית
   * ====================================================================== */

  async saveGoal(horizon: GoalHorizon, input: SaveGoalInput): Promise<void> {
    const ctx = TenantContext.current();
    const period = goalPeriod(horizon, new Date());
    const scope = { tenantId: ctx.tenantId, userId: ctx.userId };

    await this.prisma.withTenant(async (tx) => {
      const data = {
        unit: input.unit,
        targetAgorot: BigInt(Math.max(0, Math.floor(input.target))),
        averageCommissionAgorot:
          input.averageCommissionAgorot === undefined
            ? null
            : BigInt(Math.max(0, Math.floor(input.averageCommissionAgorot))),
        commitment: input.commitment ?? {},
        obstacle: input.obstacle?.trim() || null,
        ifThenPlan: input.ifThenPlan?.trim() || null,
        periodEnd: dayToDate(period.end),
      };
      /*
       * ‎`upsert` על המפתח הייחודי, ולא „קרא ואז כתוב”: קביעה חוזרת
       * מאותו מסך בשתי לשוניות הייתה מייצרת שתי שורות לאותה תקופה,
       * ואז „היעד שלי” היה תלוי בסדר הקריאה.
       */
      await tx.mentorGoal.upsert({
        where: {
          tenantId_userId_horizon_periodStart: {
            ...scope,
            horizon,
            periodStart: dayToDate(period.start),
          },
        },
        update: data,
        create: {
          id: ulid(),
          ...scope,
          horizon,
          periodStart: dayToDate(period.start),
          /* ‏היחסים נגזרים בקריאה; כאן רק נקודת הפתיחה */
          ratios: { ...DEFAULT_RATIOS },
          ...data,
        },
      });
    });
  }

  async deleteGoal(horizon: GoalHorizon): Promise<void> {
    const ctx = TenantContext.current();
    const period = goalPeriod(horizon, new Date());
    await this.prisma.withTenant(async (tx) => {
      await tx.mentorGoal.deleteMany({
        where: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          horizon,
          periodStart: dayToDate(period.start),
        },
      });
    });
  }

  /* ======================================================================
   * ‏הספירה עצמה
   * ====================================================================== */

  /**
   * ‎**ארבעת המדדים בטווח נתון, כפי שהמערכת ספרה אותם.**
   *
   * ‏כל בחירה כאן היא הכרעה על מה „נחשב”, ולכן כתובה:
   *
   * ‎**שיחות — יוצאות בלבד.** שיחה נכנסת אינה פעולה שהמתווך בחר
   * לעשות; היא תוצאה של השיווק. ספירה שכוללת אותה הייתה נותנת ציון
   * גבוה למי שישב וענה, וזה בדיוק ההפך ממדד מוביל.
   *
   * ‎**פגישות — של מי שהיומן שלו, ולא של מי שהקליד.** `ownerUserId`
   * הוא הסוכן שהפגישה שלו; `createdBy` הוא לעתים המזכירה.
   * ומבוטלות אינן נספרות: פגישה שבוטלה לא קרתה.
   *
   * ‎**הצעות — שנשלחו, ולא שנוצרו.** `sentAt` הוא הרגע שבו הלקוח
   * קיבל משהו. הצעה שנוצרה ולא נשלחה היא טיוטה.
   *
   * ‎**נכסים — שנקלטו בטווח ומשויכים אליו.** זה „מדד הבלעדיות”: מה
   * שהמתווך הכניס למלאי.
   */
  private async countMeasures(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    from: Date,
    to: Date,
  ): Promise<WeeklyActual> {
    const { tenantId, userId } = scope;
    const range = { gte: from, lt: to };

    const [calls, appointments, listings] = await Promise.all([
      tx.call.count({
        where: { tenantId, createdBy: userId, direction: "out", occurredAt: range },
      }),
      tx.appointment.count({
        where: {
          tenantId,
          ownerUserId: userId,
          startsAt: range,
          status: { not: "cancelled" },
        },
      }),
      tx.property.count({
        where: { tenantId, agentUserId: userId, deletedAt: null, createdAt: range },
      }),
    ]);

    return {
      calls,
      appointments,
      offers: await this.countOffersSent(tx, scope, range),
      listings,
    };
  }

  /**
   * ‎**הצעות ששלח — דרך ההתאמה והקונה, כי להצעה אין בעלים.**
   *
   * ‏ל-`offers` אין עמודת משתמש: הבעלות שלה עוברת דרך ההתאמה אל
   * הקונה. הכיוון כאן הוא **מההצעות של השבוע החוצה** ולא מהקונים
   * פנימה, וזה ההבדל בין שאילתה חסומה בגודל השבוע לבין שאילתה
   * שגדלה עם כל קונה שאי פעם היה במשרד.
   */
  private async countOffersSent(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    range: { gte: Date; lt: Date },
  ): Promise<number> {
    const sent = await tx.offer.findMany({
      where: { tenantId: scope.tenantId, sentAt: range },
      select: { matchId: true },
    });
    if (sent.length === 0) return 0;

    const matches = await tx.match.findMany({
      where: { tenantId: scope.tenantId, id: { in: sent.map((o) => o.matchId) } },
      select: { id: true, buyerId: true },
    });
    if (matches.length === 0) return 0;

    const mine = await tx.buyer.findMany({
      where: {
        tenantId: scope.tenantId,
        ownerUserId: scope.userId,
        id: { in: [...new Set(matches.map((m) => m.buyerId))] },
      },
      select: { id: true },
    });
    const mineIds = new Set(mine.map((b) => b.id));
    return matches.filter((m) => mineIds.has(m.buyerId)).length;
  }

  /**
   * ‎**יחסי ההמרה שלו, מההיסטוריה — או `null` כשאין מספיק.**
   *
   * ‏מתווך שסוגר אחת משש פגישות צריך תוכנית אחרת ממי שסוגר אחת
   * משלוש. `null` ולא ברירת מחדל שקטה: המסך אומר במפורש „ממוצע
   * ענפי, עד שיהיו לך מספרים”, ומספר שהומצא ומוצג כעובדה גרוע
   * ממספר חסר.
   */
  private async deriveRatios(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    now: Date,
  ): Promise<ConversionRatios | null> {
    const from = jerusalemWeekStart(now, -(MIN_WEEKS_FOR_RATIOS - 1));
    const to = jerusalemDayStart(jerusalemWeekStart(now), 7);
    const counted = await this.countMeasures(tx, scope, from, to);

    const calls = counted.calls ?? 0;
    const appointments = counted.appointments ?? 0;
    const offers = counted.offers ?? 0;
    /*
     * ‏שלב שאין בו אף פעולה אינו „יחס אפס”, הוא **חוסר מידע**: יחס
     * אפס היה מייצר תוכנית שדורשת אינסוף שיחות. אין מספיק ⇒ `null`,
     * והמסך אומר את זה.
     */
    if (calls === 0 || appointments === 0 || offers === 0) return null;

    return {
      callToAppointment: Math.min(1, appointments / calls),
      appointmentToOffer: Math.min(1, offers / appointments),
      /*
       * ‏עסקאות אינן נספרות אוטומטית בשלב הזה — אין במערכת חותמת
       * „נסגרה”. לכן דווקא היחס הזה נשאר ברירת המחדל, ואינו מומצא
       * ממספר שאיננו מודדים.
       */
      offerToDeal: DEFAULT_RATIOS.offerToDeal,
    };
  }
}

/** הטרנזקציה כפי ש-`withTenant` מוסרת אותה. */
type PrismaTx = Parameters<Parameters<PrismaService["withTenant"]>[0]>[0];
