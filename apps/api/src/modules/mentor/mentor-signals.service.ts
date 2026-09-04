import { Injectable } from "@nestjs/common";
import {
  MENTOR_FAST_RESPONSE_MINUTES,
  MENTOR_GOAL_METRICS,
  MENTOR_MISSED_RETURN_HOURS,
  type MentorActivity,
  type MentorGoalPeriod,
  type MentorGoalProgress,
  mentorGoalProgress,
  type MentorInsights,
  mentorPeriodRange,
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
    const [
      deals,
      offers,
      viewings,
      leads,
      buyers,
      properties,
      callsMade,
      callsAnswered,
      leadsFast,
      followups,
      ownerUpdates,
    ] = await Promise.all([
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
      /*
       * שיחות — של מי? שיחה שנרשמה ידנית נושאת `created_by`; שיחה
       * מהמרכזייה אינה נושאת משתמש, ומשויכת דרך הליד שלה
       * (`leads.assigned_to_user_id`). שיחה נכנסת מלקוח קיים בלי ליד
       * על השיחה עצמה שייכת למי שהליד **האחרון** של אותו לקוח אצלו
       * — ליד אחד, ולא כל מי שאי פעם טיפל בו, אחרת שיחה אחת נספרת
       * לשני מתווכים (ביקורת Codex). שיחה יוצאת מהמרכזייה בלי ליד
       * משויך אינה נספרת לאיש — עדיף חסר מניחוש.
       */
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(c.id) AS n
        FROM calls c
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'outbound'
          AND c.occurred_at >= ${start} AND c.occurred_at < ${end}
          AND (c.created_by = ${userId} OR l.assigned_to_user_id = ${userId})`,
      // נכנסת שנענתה: כל מה שאינו „לא נענתה” — גם `unknown` נספר, כמו בדוח הנכס
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(c.id) AS n
        FROM calls c
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'inbound'
          AND c.outcome NOT IN ('missed', 'no_answer', 'voicemail')
          AND c.occurred_at >= ${start} AND c.occurred_at < ${end}
          AND (
            c.created_by = ${userId}
            OR l.assigned_to_user_id = ${userId}
            OR (c.lead_id IS NULL AND c.contact_id IS NOT NULL AND ${userId} = (
              SELECT cl.assigned_to_user_id FROM leads cl
              WHERE cl.tenant_id = c.tenant_id
                AND cl.contact_id = c.contact_id
              ORDER BY cl.created_at DESC
              LIMIT 1
            ))
          )`,
      // ליד שנענה „מהר” — מרגע היצירה עד המענה הראשון, בדקות
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(id) AS n
        FROM leads
        WHERE tenant_id = ${tenantId}
          AND assigned_to_user_id = ${userId}
          AND first_response_at >= ${start} AND first_response_at < ${end}
          AND first_response_at - created_at <= ${MENTOR_FAST_RESPONSE_MINUTES} * INTERVAL '1 minute'`,
      // מעקבים שהמתווך בחר — משימות האוטומציה (lead-sla / lead-stale) נסגרות לבד ואינן נספרות
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(id) AS n
        FROM tasks
        WHERE tenant_id = ${tenantId}
          AND assigned_to_user_id = ${userId}
          AND completed_at >= ${start} AND completed_at < ${end}
          AND (source_key IS NULL OR source_key NOT LIKE 'lead-%')`,
      tx.auditLog.count({
        where: {
          tenantId,
          userId,
          action: "property.owner_update",
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
      calls_made: Number(callsMade[0]?.n ?? 0),
      calls_answered: Number(callsAnswered[0]?.n ?? 0),
      leads_answered_fast: Number(leadsFast[0]?.n ?? 0),
      followups_done: Number(followups[0]?.n ?? 0),
      owner_updates_sent: Number(ownerUpdates ?? 0),
    };
  }

  /**
   * התובנות שאינן מונה: חציון זמן המענה ללידים חדשים (השבוע ובשבוע
   * שלפניו — השוואה לעצמו בלבד), ושיחות נכנסות שלא נענו ולא יצאה
   * אליהן שיחה חוזרת תוך יממה. חציון ולא ממוצע: ליד אחד שנענה אחרי
   * יומיים לא צריך למחוק שבוע של מענה תוך עשר דקות.
   */
  async insights(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    week: DateRange,
    previousWeek: DateRange | null,
  ): Promise<MentorInsights> {
    const median = async (range: DateRange): Promise<number | null> => {
      const rows = await tx.$queryRaw<{ median: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60
        )::float AS median
        FROM leads
        WHERE tenant_id = ${tenantId}
          AND assigned_to_user_id = ${userId}
          AND first_response_at >= ${range.start} AND first_response_at < ${range.end}
          AND first_response_at >= created_at`;
      const value = rows[0]?.median;
      return typeof value === "number" && Number.isFinite(value)
        ? Math.round(value)
        : null;
    };
    const [current, previous, missed] = await Promise.all([
      median(week),
      previousWeek === null ? Promise.resolve(null) : median(previousWeek),
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(c.id) AS n
        FROM calls c
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'inbound'
          AND c.outcome IN ('missed', 'no_answer', 'voicemail')
          AND c.occurred_at >= ${week.start} AND c.occurred_at < ${week.end}
          AND (
            c.created_by = ${userId}
            OR l.assigned_to_user_id = ${userId}
            OR (c.lead_id IS NULL AND c.contact_id IS NOT NULL AND ${userId} = (
              SELECT cl.assigned_to_user_id FROM leads cl
              WHERE cl.tenant_id = c.tenant_id
                AND cl.contact_id = c.contact_id
              ORDER BY cl.created_at DESC
              LIMIT 1
            ))
          )
          AND (c.contact_id IS NOT NULL OR c.phone_hash IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM calls r
            WHERE r.tenant_id = c.tenant_id
              AND r.direction = 'outbound'
              AND r.occurred_at > c.occurred_at
              AND r.occurred_at < c.occurred_at + ${MENTOR_MISSED_RETURN_HOURS} * INTERVAL '1 hour'
              AND (
                (c.contact_id IS NOT NULL AND r.contact_id = c.contact_id)
                OR (c.phone_hash IS NOT NULL AND r.phone_hash = c.phone_hash)
                OR (c.contact_id IS NOT NULL AND r.lead_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM leads rl
                  WHERE rl.id = r.lead_id AND rl.contact_id = c.contact_id
                ))
              )
          )`,
    ]);
    return {
      responseMedianMinutes: current,
      previousResponseMedianMinutes: previous,
      missedUnreturned: Number(missed[0]?.n ?? 0),
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
