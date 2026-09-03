import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  backwardPlan,
  comparePeriods,
  DEFAULT_RATIOS,
  GOAL_HORIZONS,
  goalPeriod,
  jerusalemDayLabel,
  jerusalemDayStart,
  jerusalemWeekday,
  jerusalemWeekStart,
  LEAD_MEASURES,
  mentorMoments,
  splitToHorizon,
  weeklyScore,
  parseWeeklyCommitment,
  cleanFeedback,
  feedbackCopy,
  FEEDBACK_NOTIFICATION_TYPE,
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
  /**
   * ‎**שלושה-עשר השבועות, כל אחד עם הציון שלו — הגרף.**
   *
   * ‎`percent: null` הוא שבוע שלא הייתה בו התחייבות, והוא נבדל
   * מאפס בכוונה: עמודה בגובה אפס אומרת „נכשלת”, והיעדר עמודה אומר
   * „לא הבטחת”.
   */
  weeklyTrend: WeekPoint[];
  /** ‏יחסי ההמרה שנגזרו מההיסטוריה שלו, או `null` כשאין מספיק. */
  derivedRatios: ConversionRatios | null;
  /** ‎`true` כשהיחסים בשימוש הם ברירת המחדל הענפית ולא שלו. */
  usingDefaultRatios: boolean;
  /**
   * ‎**שיחות יוצאות מהמרכזייה שאי אפשר לשייך לאף אחד, השבוע.**
   *
   * ‏המרכזייה אינה מדווחת איזו שלוחה חייגה, ושיחה שאינה קשורה לליד
   * נשארת בלי עוגן לאדם. המספר הזה אינו קישוט — הוא מה שמאפשר למסך
   * לומר „ייתכן שספרתי לך פחות”, במקום להציג 3/40 לסוכן שהתקשר
   * ארבעים פעם ולתת לו להסיק שהוא לא עבד.
   */
  unattributedCalls: number;
}

/**
 * ‎**שבוע שסוכן סגר בו את היעד, כפי שהמנהל רואה אותו.**
 *
 * ‏המספרים הם `snapshot` — מה שנקרא ברגע ההישג. חישוב מחדש בעת
 * הצפייה היה משנה את מה שהמנהל מגיב עליו: שיחה שנמחקה חודש אחרי
 * הייתה הופכת „42 מתוך 40” ל„41 מתוך 40”, ואת השבח לשגיאה.
 */
export interface AchievementDto {
  id: string;
  userId: string;
  userName: string;
  weekKey: string;
  percent: number;
  reachedAt: Date;
  lines: { label: string; committed: number; actual: number }[];
  feedback: { text: string; byName: string; at: Date } | null;
}

/**
 * ‎**קריאת התצלום מ-JSON.**
 *
 * ‏העמודה היא `Json`, כלומר כל דבר יכול לשבת בה — כולל שורה שנכתבה
 * בגרסה קודמת של הסורק. פענוח סלחני מחזיר רק שורות שלמות, ומסך
 * שמציג „undefined מתוך undefined” גרוע ממסך שמציג פחות.
 */
function toSnapshotLines(
  value: unknown,
): { label: string; committed: number; actual: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (row === null || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    if (
      typeof r["label"] !== "string" ||
      typeof r["committed"] !== "number" ||
      typeof r["actual"] !== "number"
    ) {
      return [];
    }
    return [{ label: r["label"], committed: r["committed"], actual: r["actual"] }];
  });
}

/** ‏נקודה אחת בגרף השבועי. */
export interface WeekPoint {
  /** ‏יום ראשון של אותו שבוע, `YYYY-MM-DD` בשעון ישראל. */
  weekKey: string;
  /** ‏אחוז הביצוע, או `null` כששבוע זה לא נשא התחייבות. */
  percent: number | null;
  /** ‎`true` לשבוע שעוד רץ — הוא אינו נספר לרצף. */
  current: boolean;
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

/**
 * ‎**יחסי ההמרה שלו, מהפעילות שנספרה — או `null` כשאין מספיק.**
 *
 * ‏מתווך שסוגר אחת משש פגישות צריך תוכנית אחרת ממי שסוגר אחת
 * משלוש. `null` ולא ברירת מחדל שקטה: המסך אומר במפורש „ממוצע ענפי,
 * עד שיהיו לך מספרים”, ומספר שהומצא ומוצג כעובדה גרוע ממספר חסר.
 *
 * ‏פונקציה טהורה שמקבלת את הספירה, ולא שיטה שסופרת בעצמה: הטווח
 * שהיא צריכה — שלושה-עשר השבועות האחרונים — כבר נספר עבור ההשוואה
 * „איפה היית”, ושתי ספירות של אותו טווח היו שש שאילתות מיותרות.
 */
function ratiosFrom(counted: WeeklyActual): ConversionRatios | null {
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

@Injectable()
export class MentorService {
  constructor(private readonly prisma: PrismaService) {}

  /* ======================================================================
   * ‏קריאה: כל מה שהמסך צריך, בקריאה אחת
   * ====================================================================== */

  async overview(now = new Date()): Promise<MentorOverviewDto> {
    const ctx = TenantContext.current();
    const scope = { tenantId: ctx.tenantId, userId: ctx.userId };

    /*
     * ‎**סיכום קריאה-בלבד שסופר חמישה טווחים** — השבוע, המחזור,
     * המחזור הקודם, ובימי ראשון גם שני שבועות שהסתיימו. חמש השניות
     * שהן ברירת המחדל הפילו אותו, וההצהרה כאן מפורשת ומקומית ולא
     * העלאה גורפת של הסף לכל המערכת.
     */
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
          commitment: parseWeeklyCommitment(row.commitment),
          ...(row.obstacle === null ? {} : { obstacle: row.obstacle }),
          ...(row.ifThenPlan === null ? {} : { ifThenPlan: row.ifThenPlan }),
          periodStart: period.start,
          periodEnd: period.end,
          ...(row.achievedAt === null ? {} : { achievedAt: row.achievedAt }),
        });
      }

      const yearly = goals.find((g) => g.horizon === "year");
      const weekGoal = goals.find((g) => g.horizon === "week");

      /*
       * ‎**הספירה של שלושה-עשר השבועות נעשית פעם אחת.**
       *
       * ‏אותו טווח בדיוק משרת שני צרכים — ההשוואה „איפה היית”
       * וגזירת יחסי ההמרה — ושתי קריאות נפרדות אליו הכפילו שש
       * שאילתות בלי להוסיף מידע. הן גם מה שהפיל את הטרנזקציה על
       * מגבלת חמש השניות.
       */
      const cycleStart = jerusalemWeekStart(now, -(MIN_WEEKS_FOR_RATIOS - 1));
      /*
       * ‎**שליפה אחת של זמנים, ולא שש ספירות של טווחים חופפים.**
       *
       * ‏השבוע הנוכחי, השבוע שעבר, המחזור, שני השבועות של הרצף
       * והגרף השבועי — כולם חתכים של אותם שלושה-עשר שבועות. עד כה
       * כל אחד מהם היה סבב שאילתות משלו, והם גם מה שהפיל את
       * הטרנזקציה על מגבלת חמש השניות.
       *
       * ‏מעבר לביצועים יש כאן הכרעה על נכונות: כשכל החתכים נחתכים
       * מאותה רשימה, הגרף אינו יכול לומר דבר אחר מהציון. שתי
       * שאילתות נפרדות על אותה שאלה הן שתי אמיתות שממתינות להיפרד.
       */
      const cycleTimes = await this.measureTimes(tx, scope, cycleStart, now);
      const thisCycle = this.countsIn(cycleTimes);

      /* ---- החישוב לאחור, על היחסים שלו כשיש ---- */
      const derivedRatios = ratiosFrom(thisCycle);
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
      /*
       * ‎**ביצוע נמדד עד עכשיו, לא עד סוף השבוע** (ביקורת Codex, P2).
       *
       * ‏הגבול העליון היה יום ראשון הבא, ולכן פגישה שנקבעה ליום
       * חמישי נספרה כבר ביום ראשון — והציון היה יכול להגיע ל-100%
       * לפני שהתקיימה ולו פגישה אחת. „מה עשיתי” אינו „מה מתוכנן”,
       * וזה בדיוק ההבדל שהופך את הציון למשהו שאפשר להאמין לו.
       */
      const actual = this.countsIn(cycleTimes, thisWeek);
      const committed = weekGoal?.commitment ?? {};
      const score = weeklyScore(committed, actual);

      /*
       * ‎**שני השבועות ש*הסתיימו*, ולא אחד** (ביקורת Codex, P2).
       *
       * ‏„פעמיים ברצף” נשען על שבועות שנסגרו. השבוע הנוכחי אינו
       * אחד מהם — ביום ראשון הוא בן יום אחד וממילא מתחת לסף — ולכן
       * הוא אינו נשלף כאן בכלל: המפתחות הם של השבוע שעבר ושלפניו.
       */
      /*
       * ‎**שני השבועות שהסתיימו — מחושבים, ולא נשלפים מארכיון**
       * (ביקורת Codex, P2 ×2).
       *
       * ‏הגרסה הקודמת כתבה את ציון השבוע לטבלה בכל פתיחת מסך, וזו
       * הייתה טעות בשורש: „היסטוריה” שנכתבת רק כשמישהו מסתכל היא
       * היסטוריה של **מתי הוא הסתכל**. מי שפתח ביום שני ב-0%, עשה
       * את העבודה ולא פתח שוב — נשאר עם 0% בארכיון, והמנטור היה
       * מודיע לו ביום ראשון על שבוע חלש שלא היה. ומי שלא פתח כלל
       * פשוט נעדר.
       *
       * ‏מה שנדרש כדי לדעת אם שבוע שהסתיים היה חלש נמצא כבר במסד:
       * המחויבות שמורה על יעד השבוע של אותה תקופה, והפעילות נספרת
       * מהשיחות והפגישות. לכן הציון **מחושב** — אותו חשבון בדיוק
       * כמו לשבוע הנוכחי, על טווח סגור.
       *
       * ‎`mentor_weekly_scores` נשארת לשלב ב׳: הסורק היומי ישמור בה
       * „מה נאמר לו אז” לצורך ההודעות. בשלב הזה **אין לה כותב**,
       * וזה מוצהר ולא נסתר — טבלה ריקה עדיפה על ארכיון שקרי.
       */
      /*
       * ‏שני השבועות נספרים **רק ביום ראשון**, כי „פעמיים ברצף” הוא
       * הרגע היחיד שנשען עליהם והוא נאמר רק בתחילת שבוע. שאר ימות
       * השבוע זו עבודה שאיש אינו רואה — ושתים-עשרה שאילתות שהעמיסו
       * את הטרנזקציה על לא כלום.
       */
      /*
       * ‏שלושה-עשר השבועות שהסתיימו, כל אחד עם הציון שלו — ‎`null`
       * כשלא הייתה בו התחייבות. זה גם הגרף וגם המקור לרצף, ולכן
       * אין דרך שהם יאמרו דברים שונים.
       */
      const trend = await this.weeklyTrend(tx, scope, cycleTimes, now);
      const closed = trend.filter((w) => !w.current);
      const lastWeek = closed[closed.length - 1]?.percent ?? null;
      const weekBefore = closed[closed.length - 2]?.percent ?? null;
      /*
       * ‏סדר, ולא סינון: „פעמיים ברצף” בודק את שני האיברים הראשונים,
       * ולכן שבוע חסר במקום הראשון חייב לקטוע את הרשימה ולא להידחס
       * החוצה — אחרת שבוע ישן היה מתחזה לשבוע שעבר.
       */
      const previousPercents =
        lastWeek === null ? [] : weekBefore === null ? [lastWeek] : [lastWeek, weekBefore];

      /*
       * ‏ברמת המשרד ולא ברמת המשתמש, כי זה בדיוק מה שהן: שיחות
       * שאיש אינו יכול לטעון לבעלות עליהן. אם יש כאלה, המסך אומר
       * שהספירה חלקית.
       */
      const unattributedCalls = await tx.call.count({
        where: {
          tenantId: ctx.tenantId,
          direction: "outbound",
          occurredAt: { gte: thisWeek, lt: now },
          createdBy: null,
          leadId: null,
        },
      });

      const moments = mentorMoments({
        score,
        weekday: jerusalemWeekday(now),
        previousPercents,
      });

      /* ---- „איפה היית” ---- */
      const previousWeek = this.countsIn(cycleTimes, jerusalemWeekStart(now, -1), thisWeek);
      /* ‏המחזור שלפני הקודם הוא מחוץ לחלון, ולכן הוא השליפה השנייה והאחרונה */
      const lastCycle = this.countsIn(
        await this.measureTimes(
          tx,
          scope,
          jerusalemWeekStart(now, -(MIN_WEEKS_FOR_RATIOS * 2 - 1)),
          cycleStart,
        ),
      );

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
          ...(previousPercents[0] === undefined
            ? {}
            : { previousPercent: previousPercents[0] }),
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
        weeklyTrend: trend,
        derivedRatios,
        usingDefaultRatios: derivedRatios === null,
        unattributedCalls,
      };
    }, { timeout: 20_000 });
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
   * ‏מי סגר את השבוע — והתגובה של המנהל
   * ====================================================================== */

  /**
   * ‎**הסוכנים שסגרו את היעד לאחרונה, למסך המנהל.**
   *
   * ‏מוצגים גם אלה שכבר קיבלו מילה וגם אלה שלא, ומי שלא — ראשון.
   * מסך שמציג רק את הממתינים היה מוחק את ההיסטוריה בכל פעם שהמנהל
   * מגיב, ואז אי אפשר לראות מי נשאר בלי תגובה שבועיים ברצף.
   *
   * ‏הגישה נשמרת ב-`analytics.view` בבקר. אין כאן סינון לפי סוכן:
   * ההישג הזה **נועד** להיראות בידי ההנהלה, וזה בדיוק ההבדל בינו
   * לבין היעד עצמו — שהוא פרטי.
   */
  async achievements(limit = 20): Promise<AchievementDto[]> {
    const ctx = TenantContext.current();
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.mentorAchievement.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: [{ feedbackAt: { sort: "asc", nulls: "first" } }, { reachedAt: "desc" }],
        take: limit,
      });
      if (rows.length === 0) return [];

      /* ‏שמות בשליפה אחת — הסוכן והמגיב גם יחד */
      const ids = [
        ...new Set(
          rows.flatMap((r) => [r.userId, r.feedbackByUserId].filter((v): v is string => v !== null)),
        ),
      ];
      const users = await tx.user.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(users.map((u) => [u.id, u.name]));

      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: nameOf.get(row.userId) ?? "סוכן",
        weekKey: row.weekKey,
        percent: row.percent,
        reachedAt: row.reachedAt,
        lines: toSnapshotLines(row.snapshot),
        feedback:
          row.feedbackText === null || row.feedbackAt === null
            ? null
            : {
                text: row.feedbackText,
                byName: nameOf.get(row.feedbackByUserId ?? "") ?? "המנהל",
                at: row.feedbackAt,
              },
      }));
    });
  }

  /**
   * ‎**המנהל כותב, והסוכן מקבל התראה.**
   *
   * ‏הכתיבה וההתראה באותה טרנזקציה: פידבק שנשמר בלי שההתראה נכתבה
   * הוא פידבק שהסוכן לעולם לא יראה, וזה גרוע מלא לכתוב אותו.
   *
   * ‎**כתיבה חוזרת מעדכנת ואינה שולחת שוב.** מנהל שתיקן ניסוח אינו
   * מתכוון להתריע פעמיים, והמפתח הייחודי על ההתראה מכריע גם אם כן.
   */
  async sendFeedback(achievementId: string, text: string): Promise<void> {
    const ctx = TenantContext.current();
    const clean = cleanFeedback(text);
    if (clean === null) throw new BadRequestException("אין מה לשלוח — הטקסט ריק");

    await this.prisma.withTenant(async (tx) => {
      const row = await tx.mentorAchievement.findFirst({
        where: { tenantId: ctx.tenantId, id: achievementId },
        select: { id: true, userId: true, weekKey: true, feedbackAt: true },
      });
      if (row === null) throw new NotFoundException("ההישג לא נמצא");

      const manager = await tx.user.findFirst({
        where: { tenantId: ctx.tenantId, id: ctx.userId },
        select: { name: true },
      });
      const managerName = manager?.name ?? "המנהל";

      /*
       * ‎`updateMany` עם `tenantId` ולא `update` לפי מפתח ראשי.
       * ה-RLS היה מגן ממילא, אבל שער ההיקף דורש שכל שאילתה תסנן
       * לפי משרד — והכלל הזה שווה יותר מהקיצור: הוא מה שמוודא
       * שהשאילתה הבאה, שתיכתב מחוץ להקשר הזה, לא תסמוך על RLS לבדו.
       */
      await tx.mentorAchievement.updateMany({
        where: { tenantId: ctx.tenantId, id: row.id },
        data: {
          feedbackText: clean,
          feedbackByUserId: ctx.userId,
          feedbackAt: new Date(),
        },
      });

      /*
       * ‏מנהל שמגיב על ההישג של עצמו אינו שולח לעצמו התראה. זה קורה
       * במשרד קטן שבו הבעלים הוא גם סוכן, וזה המקרה הנפוץ אצלנו.
       */
      if (row.userId === ctx.userId) return;

      const copy = feedbackCopy(managerName, clean);
      await tx.notification.createMany({
        data: [
          {
            id: ulid(),
            tenantId: ctx.tenantId,
            userId: row.userId,
            type: FEEDBACK_NOTIFICATION_TYPE,
            /*
             * ‏מפתח לכל תיקון ולא לכל הישג: מנהל שכתב שוב אחרי שבוע
             * מתכוון שהסוכן יראה. מה שנמנע הוא לחיצה כפולה על אותו
             * טקסט, ולכן המפתח נושא את התוכן.
             */
            dedupeKey: `mentor_feedback:${row.id}:${clean.length}:${clean.slice(0, 24)}`,
            title: copy.title,
            body: copy.body,
            entityType: "mentor_achievement",
            entityId: row.id,
          },
        ],
        skipDuplicates: true,
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
  private async measureTimes(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    from: Date,
    to: Date,
  ): Promise<Record<LeadMeasure, Date[]>> {
    const { tenantId, userId } = scope;
    const range = { gte: from, lt: to };

    const [appointments, listings, leads] = await Promise.all([
      /*
       * ‎**רק פגישות שהתקיימו** (ביקורת Codex, P2). ‏הסינון היה „לא
       * מבוטלת”, וזה השאיר בפנים גם `scheduled` שחלפה בלי שאיש אישר
       * אותה וגם `no_show` — כלומר פגישה שהלקוח לא הגיע אליה נספרה
       * כפגישה שנעשתה. ‎`completed` הוא הסימן שהמערכת עצמה שמה
       * כשנרשמת תוצאה (`calendar.service`), ואותו סינון בדיוק
       * שהאנליטיקה משתמשת בו לסיורים שהתקיימו.
       */
      tx.appointment.findMany({
        where: { tenantId, ownerUserId: userId, startsAt: range, status: "completed" },
        select: { startsAt: true },
      }),
      tx.property.findMany({
        where: { tenantId, agentUserId: userId, deletedAt: null, createdAt: range },
        select: { createdAt: true },
      }),
      /*
       * ‎**לידים חדשים — שנוצרו בטווח ומוקצים אליו.**
       *
       * ‎`assignedToUserId` ולא `createdBy`: ליד שנכנס מטופס אינטרנט
       * או מהמרכזייה נוצר בידי המערכת, והשאלה היא של מי הוא — כלומר
       * מי אמור לעבוד עליו. זו גם ההקצאה שהמתווך רואה ברשימת הלידים,
       * כך שהמספר כאן והמספר שם הם אותו מספר.
       */
      tx.lead.findMany({
        where: { tenantId, assignedToUserId: userId, createdAt: range },
        select: { createdAt: true },
      }),
    ]);

    return {
      calls: await this.outboundCallTimes(tx, scope, range),
      leads: leads.map((r) => r.createdAt),
      appointments: appointments.map((r) => r.startsAt),
      offers: await this.offerSentTimes(tx, scope, range),
      listings: listings.map((r) => r.createdAt),
    };
  }

  /** ‏אותה מדידה, כשכל מה שנדרש הוא כמה. */
  private countsIn(times: Record<LeadMeasure, Date[]>, from?: Date, to?: Date): WeeklyActual {
    const out: WeeklyActual = {};
    for (const measure of LEAD_MEASURES) {
      out[measure] = times[measure].filter(
        (t) => (from === undefined || t >= from) && (to === undefined || t < to),
      ).length;
    }
    return out;
  }

  /**
   * ‎**שלושה-עשר השבועות האחרונים, כל אחד עם הציון שלו.**
   *
   * ## שתי הכרעות שהגרף הזה נשען עליהן
   *
   * ‎**1. ההיסטוריה מחושבת, לא נשלפת מארכיון.** הגרסה הקודמת כתבה
   * את ציון השבוע לטבלה בכל פתיחת מסך, וזו הייתה טעות בשורש:
   * „היסטוריה” שנכתבת רק כשמישהו מסתכל היא היסטוריה של **מתי הוא
   * הסתכל**. מי שפתח ביום שני ב-0%, עשה את העבודה ולא פתח שוב —
   * היה נשאר עם 0%; ומי שלא פתח כלל פשוט נעדר. כל מה שנדרש כבר
   * במסד: המחויבות על יעד השבוע, והפעילות שנספרת.
   *
   * ‎**2. שבוע בלי התחייבות הוא `null`, לא אפס.** עמודה בגובה אפס
   * אומרת „נכשלת”; היעדר עמודה אומר „לא הבטחת”. ההבדל הוא כל
   * ההבדל בין גרף שמלווה לגרף שמאשים, ובלעדיו מתווך חדש היה רואה
   * שלושה-עשר כישלונות בפעם הראשונה שנכנס.
   *
   * ‏השבוע הנוכחי נכלל ומסומן `current`, כי הוא עוד נע — והוא גם
   * היחיד שאינו נספר לרצף „פעמיים ברצף”.
   */
  private async weeklyTrend(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    times: Record<LeadMeasure, Date[]>,
    now: Date,
  ): Promise<WeekPoint[]> {
    const weeks: Date[] = [];
    for (let back = MIN_WEEKS_FOR_RATIOS - 1; back >= 0; back -= 1) {
      weeks.push(jerusalemWeekStart(now, -back));
    }

    /*
     * ‏שאילתה אחת לכל ההתחייבויות בחלון, ולא אחת לשבוע: שלוש-עשרה
     * שליפות בזו אחר זו הן בדיוק מה שהעמיס את הטרנזקציה קודם.
     */
    const rows = await tx.mentorGoal.findMany({
      where: {
        ...scope,
        horizon: "week",
        periodStart: {
          gte: dayToDate(jerusalemDayLabel(weeks[0] as Date)),
          lte: dayToDate(jerusalemDayLabel(weeks[weeks.length - 1] as Date)),
        },
      },
      select: { periodStart: true, commitment: true },
    });
    const byWeek = new Map(
      rows.map((r) => [r.periodStart.toISOString().slice(0, 10), r.commitment]),
    );

    const thisWeek = jerusalemWeekStart(now);
    return weeks.map((weekStart) => {
      const label = jerusalemDayLabel(weekStart);
      const current = weekStart.getTime() === thisWeek.getTime();
      const committed = parseWeeklyCommitment(byWeek.get(label) ?? null);
      if (Object.keys(committed).length === 0) {
        return { weekKey: label, percent: null, current };
      }
      /* ‏שבוע סגור נספר במלואו; השבוע הנוכחי רק עד עכשיו */
      const until = current ? now : jerusalemDayStart(weekStart, 7);
      const actual = this.countsIn(times, weekStart, until);
      return { weekKey: label, percent: weeklyScore(committed, actual).percent, current };
    });
  }

  /**
   * ‎**שיחות יוצאות שלו — כולל אלה שהמרכזייה רשמה** (ביקורת Codex, P1).
   *
   * ## שני באגים שהיו כאן, ושניהם החזירו אפס
   *
   * ‎**1. הערך.** ‏הסינון היה `direction: "out"`, והמערכת שומרת
   * ‎`"inbound"` / `"outbound"` — גם ברישום הידני וגם בקליטה
   * מהמרכזייה. כלומר המדד המרכזי של המנטור התאים לאפס שורות תמיד,
   * והמסך היה מציג „0 / 40” לסוכן שהתקשר ארבעים פעם.
   *
   * ‎**2. השיוך.** ‏`TelephonyService.ingest` יוצרת שיחות ספק **בלי
   * ‎`createdBy`** — המרכזייה אינה אומרת איזו שלוחה חייגה. משרד
   * שעובד עם 015 היה רואה רק שיחות שנרשמו ידנית, כלומר כמעט כלום.
   *
   * ## השיוך שנבחר, ומה גבולו
   *
   * ‏שיחה יוצאת שקשורה לליד שייכת לסוכן שהליד מוקצה לו. זה אינו
   * ניחוש: שיחה יוצאת נוצרת מתוך עבודה על ליד, וההקצאה היא מי
   * מטפל בו. `createdBy` קודם לה כשהוא קיים — רישום ידני יודע
   * במדויק מי רשם.
   *
   * ‎**מה שנשאר בחוץ, ובכוונה:** שיחה יוצאת מהמרכזייה שאינה קשורה
   * לשום ליד. אין לה שום עוגן לאדם, ולנחש אותה לפי „מי היה מחובר”
   * היה מייצר ציון על עבודה של מישהו אחר. התיקון האמיתי הוא
   * ‎`createdBy` בקליטה, וזה שינוי באינטגרציית הטלפוניה.
   *
   * ‏הכיוון הוא **משיחות הטווח החוצה**, כמו בהצעות: חסום בגודל
   * הטווח ולא בגודל היסטוריית הלידים של המשרד.
   */
  private async outboundCallTimes(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    range: { gte: Date; lt: Date },
  ): Promise<Date[]> {
    const rows = await tx.call.findMany({
      where: { tenantId: scope.tenantId, direction: "outbound", occurredAt: range },
      select: { createdBy: true, leadId: true, occurredAt: true },
    });
    if (rows.length === 0) return [];

    const mine = rows.filter((r) => r.createdBy === scope.userId);

    /* שיחות ספק ללא רושם — משויכות דרך הליד שהן נוגעות בו */
    const orphanLeadIds = [
      ...new Set(
        rows
          .filter((r) => r.createdBy === null && r.leadId !== null)
          .map((r) => r.leadId as string),
      ),
    ];
    if (orphanLeadIds.length === 0) return mine.map((r) => r.occurredAt);

    const myLeads = await tx.lead.findMany({
      where: {
        tenantId: scope.tenantId,
        id: { in: orphanLeadIds },
        assignedToUserId: scope.userId,
      },
      select: { id: true },
    });
    const myLeadIds = new Set(myLeads.map((l) => l.id));
    return [
      ...mine,
      ...rows.filter(
        (r) => r.createdBy === null && r.leadId !== null && myLeadIds.has(r.leadId),
      ),
    ].map((r) => r.occurredAt);
  }

  /**
   * ‎**הצעות ששלח — דרך ההתאמה והקונה, כי להצעה אין בעלים.**
   *
   * ‏ל-`offers` אין עמודת משתמש: הבעלות שלה עוברת דרך ההתאמה אל
   * הקונה. הכיוון כאן הוא **מההצעות של השבוע החוצה** ולא מהקונים
   * פנימה, וזה ההבדל בין שאילתה חסומה בגודל השבוע לבין שאילתה
   * שגדלה עם כל קונה שאי פעם היה במשרד.
   */
  private async offerSentTimes(
    tx: PrismaTx,
    scope: { tenantId: string; userId: string },
    range: { gte: Date; lt: Date },
  ): Promise<Date[]> {
    const sent = await tx.offer.findMany({
      where: { tenantId: scope.tenantId, sentAt: range },
      select: { matchId: true, sentAt: true },
    });
    if (sent.length === 0) return [];

    const matches = await tx.match.findMany({
      where: { tenantId: scope.tenantId, id: { in: sent.map((o) => o.matchId) } },
      select: { id: true, buyerId: true },
    });
    if (matches.length === 0) return [];

    const mine = await tx.buyer.findMany({
      where: {
        tenantId: scope.tenantId,
        ownerUserId: scope.userId,
        id: { in: [...new Set(matches.map((m) => m.buyerId))] },
      },
      select: { id: true },
    });
    const mineIds = new Set(mine.map((b) => b.id));
    const myMatchIds = new Set(
      matches.filter((m) => mineIds.has(m.buyerId)).map((m) => m.id),
    );
    /*
     * ‏חוזרים אל ההצעות עצמן ולא סופרים התאמות: `sentAt` יושב על
     * ההצעה, והוא הזמן שהגרף מציב לפיו. שתי הצעות על אותה התאמה הן
     * שתי שליחות.
     */
    return sent
      .filter((o) => myMatchIds.has(o.matchId) && o.sentAt !== null)
      .map((o) => o.sentAt as Date);
  }


}

/** הטרנזקציה כפי ש-`withTenant` מוסרת אותה. */
type PrismaTx = Parameters<Parameters<PrismaService["withTenant"]>[0]>[0];
