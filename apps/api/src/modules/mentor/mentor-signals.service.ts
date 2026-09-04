import { Injectable } from "@nestjs/common";
import {
  MENTOR_GOAL_METRICS,
  mentorGoalProgress,
  mentorPeriodRange,
  type MentorActivity,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  type MentorWin,
  type MentorWinKind,
} from "@metavchim/shared";
import type { TenantTx } from "../../core/prisma.service";

export interface DateRange {
  start: Date;
  end: Date;
}

/** שורת יעד כפי שהיא בבסיס — מה שהמסך והסיכום מקבלים יחד עם ההתקדמות. */
export interface MentorGoalRow {
  id: string;
  metric: string;
  period: string;
  target: number;
  why: string | null;
  intention: string | null;
  createdAt: Date;
  endedAt: Date | null;
}

export type GoalWithProgress = MentorGoalRow & { progress: MentorGoalProgress };

/**
 * המונים של המנטור — ספירה של **המשתמש** בטווח (docs/13 §5.1).
 *
 * שש שאילתות מצטברות, בלי שליפת שורות, ומקור אחד לכל מדד: המסך,
 * הסיכום השבועי וההצעות סופרים כאן. מדד שנספר בשני מקומות היה
 * מציג „3 סיורים” בכרטיס ו„2 סיורים” בסיכום של אותו שבוע.
 *
 * ## שיוך למתווך
 *
 * לנכס אין שדה „סוכן”, ולכן עסקה שנסגרה נספרת מ-`mentor_wins` — שם
 * נרשם מי סימן „נמכר” — ונכס חדש מיומן הביקורת, שרושם מי יצר.
 * הצעה משויכת דרך בעל הקונה, כמו בדוח הסוכנים, בשאילתה גולמית אחת
 * כי ל-`offers` אין קשר Prisma ל-`matches`.
 */
@Injectable()
export class MentorSignalsService {
  async activity(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: DateRange,
    now: Date,
  ): Promise<MentorActivity> {
    const { start, end } = range;
    // סיור „התקיים” רק אם מועדו כבר עבר — סיור של מחר אינו פעילות
    const viewingsUntil = now < end ? now : end;
    const [deals, offers, viewings, leads, buyers, properties] =
      await Promise.all([
        tx.mentorWin.count({
          where: {
            tenantId,
            userId,
            kind: "deal_closed",
            happenedAt: { gte: start, lt: end },
          },
        }),
        tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(o.id) AS n
        FROM offers o
        JOIN matches m ON m.id = o.match_id
        JOIN buyers b ON b.id = m.buyer_id
        WHERE o.tenant_id = ${tenantId}
          AND b.owner_user_id = ${userId}
          AND o.created_at >= ${start} AND o.created_at < ${end}`,
        tx.appointment.count({
          where: {
            tenantId,
            kind: "viewing",
            status: { notIn: ["cancelled", "no_show"] },
            startsAt: { gte: start, lt: viewingsUntil },
            // יומן של מי — ובלי בעלים, מי שהקליד (כמו בדו"ח הבוקר)
            OR: [
              { ownerUserId: userId },
              { ownerUserId: null, createdBy: userId },
            ],
          },
        }),
        tx.lead.count({
          where: {
            tenantId,
            assignedToUserId: userId,
            firstResponseAt: { gte: start, lt: end },
          },
        }),
        tx.buyer.count({
          where: {
            tenantId,
            ownerUserId: userId,
            deletedAt: null,
            createdAt: { gte: start, lt: end },
          },
        }),
        tx.auditLog.count({
          where: {
            tenantId,
            userId,
            action: "property.create",
            createdAt: { gte: start, lt: end },
          },
        }),
      ]);
    return {
      deals_closed: deals,
      offers_sent: Number(offers[0]?.n ?? 0),
      viewings_held: viewings,
      leads_answered: leads,
      new_buyers: buyers,
      new_properties: properties,
    };
  }

  async wins(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: DateRange,
  ): Promise<MentorWin[]> {
    const rows = await tx.mentorWin.findMany({
      where: {
        tenantId,
        userId,
        happenedAt: { gte: range.start, lt: range.end },
      },
      orderBy: { happenedAt: "asc" },
      select: { id: true, kind: true, title: true },
    });
    // המזהה — זהות יציבה לחגיגה במסך; המיקום ברשימה משתנה כשמצטרפת הצלחה
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as MentorWinKind,
      title: r.title,
    }));
  }

  /** היעדים שהיו פעילים בטווח — כולל יעד שהופסק אחרי תחילתו. */
  async goalsActiveIn(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    range: DateRange,
  ): Promise<MentorGoalRow[]> {
    return tx.mentorGoal.findMany({
      where: {
        tenantId,
        userId,
        createdAt: { lt: range.end },
        OR: [{ endedAt: null }, { endedAt: { gt: range.start } }],
      },
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
  }

  /**
   * התקדמות לכל יעד. פעילות השבוע מגיעה מבחוץ (המסך כבר ספר אותה);
   * פעילות החודש נספרת רק אם יש יעד חודשי.
   *
   * ‎`at` הוא הרגע שמולו נמדד הקצב, ו-`week` הוא השבוע שנמדד —
   * **שניהם** ניתנים, כי בסיכום `at` הוא סוף השבוע, וגזירת השבוע
   * מתוכו הייתה נותנת את השבוע **הבא** (ראשון 00:00 כבר שייך לו):
   * ‎3 מתוך 5 היה נמדד כ„מעל הקצב” בשבוע שבו לא נשלח דבר.
   * ‎`monthAnchor` — הרגע שלפיו נבחר החודש: עכשיו למסך, שבת בערב
   * לסיכום, כדי ששבוע שנגמר בראשון הראשון לחודש יסכם את החודש
   * שהסתיים ולא את זה שהתחיל לפני שעה.
   */
  async progress(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    goals: MentorGoalRow[],
    opts: {
      at: Date;
      week: DateRange;
      weekActivity: MentorActivity;
      monthAnchor: Date;
    },
  ): Promise<GoalWithProgress[]> {
    const { at, week, weekActivity, monthAnchor } = opts;
    const ranges = new Map<MentorGoalPeriod, DateRange>([["week", week]]);
    const byPeriod = new Map<MentorGoalPeriod, MentorActivity>([
      ["week", weekActivity],
    ]);
    if (goals.some((g) => g.period === "month")) {
      const month = mentorPeriodRange("month", monthAnchor);
      ranges.set("month", month);
      byPeriod.set(
        "month",
        await this.activity(tx, tenantId, userId, month, at),
      );
    }
    return goals.flatMap((goal) => {
      const period = goal.period as MentorGoalPeriod;
      const activity = byPeriod.get(period);
      const range = ranges.get(period);
      if (
        activity === undefined ||
        range === undefined ||
        !(MENTOR_GOAL_METRICS as readonly string[]).includes(goal.metric)
      ) {
        return [];
      }
      const metric = goal.metric as (typeof MENTOR_GOAL_METRICS)[number];
      const progress = mentorGoalProgress({
        metric,
        period,
        target: goal.target,
        actual: activity[metric],
        periodStart: range.start,
        periodEnd: range.end,
        now: at,
        ...(goal.why === null ? {} : { why: goal.why }),
        ...(goal.intention === null ? {} : { intention: goal.intention }),
      });
      return [{ ...goal, progress }];
    });
  }
}
