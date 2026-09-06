import { Injectable, Optional } from "@nestjs/common";
import {
  ideaByKey,
  officePlaybook,
  officePlaybookFor,
  resolveIdeaFeedback,
  type MentorIdeaOutcome,
  type MentorOfficePlaybook,
  type OfficeEvidenceEntry,
  CLOSEST_DEAL_WINDOW_DAYS,
  closestDeal,
  type DealCandidate,
  type MentorClosestDeal,
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
  jerusalemWeekStart,
} from "@metavchim/shared";
import { CryptoService } from "../../core/crypto.service";
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

/** כמה שבועות אחורה נמדד המשפך של המתווך — רבעון. */
export const MENTOR_HISTORY_WEEKS = 13;
/** כמה שבועות אחורה נאספות מדידות של רעיונות לספר המשחק של המשרד — חצי שנה. */
export const OFFICE_PLAYBOOK_WEEKS = 26;

/**
 * המונים של המנטור — ספירה של **המשתמש** בטווח (docs/14 §5.1).
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
  /*
   * ההצפנה — לשם הקונה של „העסקה הקרובה ביותר” בלבד (§7.6). אופציונלית
   * כדי שהבדיקות יבנו את השירות בלי DI; בלי מפענח השם הוא „קונה”.
   */
  constructor(@Optional() private readonly crypto?: CryptoService) {}

  /**
   * העסקה הקרובה ביותר (docs/14 §7.6) — הקונים של המתווך עצמו עם
   * הסיורים שהתקיימו וההצעות של 30 הימים האחרונים; הבחירה והניסוח
   * ב-`closestDeal` (טהור). שתי שאילתות ושליפת שמות — רק למי שעומד
   * בסף; קונה שנמחק אינו מועמד.
   */
  async closestDeal(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<MentorClosestDeal | null> {
    const since = new Date(
      now.getTime() - CLOSEST_DEAL_WINDOW_DAYS * 86_400_000,
    );
    const [viewings, offers] = await Promise.all([
      tx.$queryRaw<
        {
          buyer_id: string;
          property_id: string | null;
          starts_at: Date;
          street: string | null;
          house_number: string | null;
          city: string | null;
        }[]
      >`
        SELECT a.buyer_id, a.property_id, a.starts_at, p.street, p.house_number, p.city
        FROM appointments a
        JOIN buyers b ON b.id = a.buyer_id
        LEFT JOIN properties p ON p.id = a.property_id
        WHERE a.tenant_id = ${tenantId}
          AND b.tenant_id = ${tenantId}
          AND b.owner_user_id = ${userId}
          AND b.deleted_at IS NULL
          AND a.kind = 'viewing'
          AND a.status NOT IN ('cancelled', 'no_show')
          AND a.starts_at >= ${since} AND a.starts_at < ${now}
        ORDER BY a.starts_at DESC`,
      tx.$queryRaw<{ buyer_id: string; status: string }[]>`
        SELECT m.buyer_id, o.status
        FROM offers o
        JOIN matches m ON m.id = o.match_id
        JOIN buyers b ON b.id = m.buyer_id
        WHERE o.tenant_id = ${tenantId}
          AND b.owner_user_id = ${userId}
          AND b.deleted_at IS NULL
          AND o.sent_at >= ${since} AND o.sent_at < ${now}`,
    ]);
    const byBuyer = new Map<string, DealCandidate>();
    const seed = (id: string): DealCandidate => {
      const existing = byBuyer.get(id);
      if (existing !== undefined) return existing;
      const fresh: DealCandidate = {
        buyerId: id,
        name: "קונה",
        viewings: 0,
        distinctProperties: 0,
        lastViewingAt: null,
        lastProperty: null,
        interestedOffers: 0,
        pendingOffers: 0,
        maturity: "interested",
      };
      byBuyer.set(id, fresh);
      return fresh;
    };
    const properties = new Map<string, Set<string>>();
    for (const row of Array.isArray(viewings) ? viewings : []) {
      if (typeof row.buyer_id !== "string") continue;
      const c = seed(row.buyer_id);
      c.viewings += 1;
      const set = properties.get(row.buyer_id) ?? new Set<string>();
      if (row.property_id !== null) set.add(row.property_id);
      properties.set(row.buyer_id, set);
      c.distinctProperties = set.size;
      // השורות ממוינות מהחדש לישן — הראשון לכל קונה הוא הסיור האחרון
      if (c.lastViewingAt === null) {
        c.lastViewingAt = row.starts_at;
        const address = [
          [row.street, row.house_number].filter(Boolean).join(" "),
          row.city,
        ]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join(", ");
        c.lastProperty = address === "" ? null : address;
      }
    }
    for (const row of Array.isArray(offers) ? offers : []) {
      if (typeof row.buyer_id !== "string") continue;
      const c = seed(row.buyer_id);
      if (row.status === "interested") c.interestedOffers += 1;
      else if (["sent", "delivered", "opened"].includes(row.status))
        c.pendingOffers += 1;
    }
    if (byBuyer.size === 0) return null;
    const rows = await tx.buyer.findMany({
      where: { tenantId, id: { in: [...byBuyer.keys()] }, deletedAt: null },
      select: { id: true, maturity: true, contactId: true },
    });
    // לקונה אין קשר Prisma לאיש הקשר — השמות נשלפים בנפרד, רק למועמדים
    const contacts = new Map(
      (
        await tx.contact.findMany({
          where: { tenantId, id: { in: rows.map((r) => r.contactId) } },
          select: { id: true, nameEncrypted: true },
        })
      ).map((c) => [c.id, c.nameEncrypted]),
    );
    for (const row of rows) {
      const c = byBuyer.get(row.id);
      if (c === undefined) continue;
      c.maturity = row.maturity;
      const encrypted = contacts.get(row.contactId);
      if (encrypted === undefined) continue;
      try {
        const name = this.crypto?.decrypt(encrypted).trim();
        if (name !== undefined && name !== "") c.name = name;
      } catch {
        // שם שלא נפתח — נשאר „קונה”; העסקה חשובה מהשם
      }
    }
    return closestDeal([...byBuyer.values()], now);
  }

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
          AND o.sent_at >= ${start} AND o.sent_at < ${end}`,
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
       * שיחות — של מי? זה **שיוך**, לא נראוּת: מי רואה ליד מוכרע
       * ב-`ownership.ts` (וליד לא-משויך הוא הערימה המשותפת); כאן
       * שואלים למי השיחה **נספרת**, ושיחה של ליד בלי מתווך אינה
       * נספרת לאיש. שיחה שנרשמה ידנית נושאת `created_by`; שיחה
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
        LEFT JOIN leads lc ON lc.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'outbound'
          AND c.occurred_at >= ${start} AND c.occurred_at < ${end}
          AND (
            c.created_by = ${userId}
            OR (c.created_by IS NULL AND lc.assigned_to_user_id = ${userId})
          )`,
      /*
       * נכנסת שנענתה: `answered` בלבד. `unknown` הוא ניתוק בלי ראיה
       * שמישהו ענה — מרכזייה שאינה מדווחת משך או אירוע מענה — ולספור
       * אותו כמענה היה מנפח יעד של „שיחות נכנסות שנענו” בדיוק במשרד
       * שאין לו את הראיה (ביקורת Codex).
       */
      tx.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(c.id) AS n
        FROM calls c
        LEFT JOIN leads lc ON lc.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'inbound'
          AND c.outcome = 'answered'
          AND c.occurred_at >= ${start} AND c.occurred_at < ${end}
          AND (
            c.created_by = ${userId}
            OR (c.created_by IS NULL AND lc.assigned_to_user_id = ${userId})
            OR (c.created_by IS NULL AND c.lead_id IS NULL AND c.contact_id IS NOT NULL AND ${userId} = (
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
          AND first_response_at >= created_at
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
        LEFT JOIN leads lc ON lc.id = c.lead_id
        WHERE c.tenant_id = ${tenantId}
          AND c.direction = 'inbound'
          AND c.outcome IN ('missed', 'no_answer', 'voicemail')
          AND c.occurred_at >= ${week.start} AND c.occurred_at < ${week.end}
          AND (
            c.created_by = ${userId}
            OR (c.created_by IS NULL AND lc.assigned_to_user_id = ${userId})
            OR (c.created_by IS NULL AND c.lead_id IS NULL AND c.contact_id IS NOT NULL AND ${userId} = (
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

  /**
   * המשפך של המתווך — הפעילות המצטברת ב-13 השבועות האחרונים, לחישוב
   * יחסי ההמרה שלו עצמו (הצעות לסיור, סיורים לעסקה). חלון אחד לכל
   * הקוראים: ההצעות ליעדי תהליך, העצה של המנטור והשיחה — כדי ש„היחס
   * שלך” יהיה אותו מספר בכל מקום.
   */
  async funnelHistory(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<{ history: MentorActivity; weeks: number }> {
    const start = jerusalemWeekStart(now, -MENTOR_HISTORY_WEEKS);
    const history = await this.activity(
      tx,
      tenantId,
      userId,
      { start, end: now },
      now,
    );
    return { history, weeks: MENTOR_HISTORY_WEEKS };
  }

  /**
   * ספר המשחק של המשרד (docs/14 §7.4) — כל העדויות של המתווכים
   * הפעילים, בלי זהות: „עזר לי” / „לא בשבילי” מההעדפות, ומה נמדד
   * (§7.2) מגופי הסיכומים של חצי השנה האחרונה. שתי שאילתות למשרד,
   * ולכן הסבב מחשב פעם אחת למשרד ומעביר לכל משתמש.
   */
  async officePlaybook(
    tx: TenantTx,
    tenantId: string,
    now: Date,
  ): Promise<MentorOfficePlaybook> {
    return officePlaybook(await this.officeEvidence(tx, tenantId, now));
  }

  /** הספר כפי שמתווך אחד רואה אותו — בלי העדות שלו (§7.4). */
  async officePlaybookFor(
    tx: TenantTx,
    tenantId: string,
    userId: string,
    now: Date,
  ): Promise<MentorOfficePlaybook> {
    return officePlaybookFor(
      await this.officeEvidence(tx, tenantId, now),
      userId,
    );
  }

  /**
   * העדויות של המתווכים הפעילים — עם מזהה, כדי שאפשר יהיה להוציא
   * את המתווך עצמו מהספר שמוצג לו. המזהה אינו יוצא מכאן לפלט.
   */
  async officeEvidence(
    tx: TenantTx,
    tenantId: string,
    now: Date,
  ): Promise<OfficeEvidenceEntry[]> {
    const since = jerusalemWeekStart(now, -OFFICE_PLAYBOOK_WEEKS);
    const [users, reviews] = await Promise.all([
      tx.$queryRaw<{ id: string; preferences: unknown }[]>`
        SELECT id, preferences
        FROM users
        WHERE tenant_id = ${tenantId} AND is_active = true`,
      tx.$queryRaw<{ user_id: string; outcomes: unknown }[]>`
        SELECT user_id, body -> 'ideaOutcomes' AS outcomes
        FROM mentor_reviews
        WHERE tenant_id = ${tenantId}
          AND week_start >= ${since}
          AND body ? 'ideaOutcomes'`,
    ]);
    if (!Array.isArray(users) || users.length === 0) return [];
    const outcomesByUser = new Map<string, MentorIdeaOutcome[]>();
    for (const row of Array.isArray(reviews) ? reviews : []) {
      if (typeof row.user_id !== "string" || !Array.isArray(row.outcomes))
        continue;
      const list = outcomesByUser.get(row.user_id) ?? [];
      for (const raw of row.outcomes) {
        if (typeof raw !== "object" || raw === null) continue;
        const { key, change, date, before, after } = raw as Record<
          string,
          unknown
        >;
        if (typeof key !== "string") continue;
        const idea = ideaByKey(key);
        if (idea === null) continue;
        if (change !== "up" && change !== "flat" && change !== "down") continue;
        list.push({
          key,
          metric: idea.metric,
          text: idea.text,
          date: typeof date === "string" ? date : "",
          before: typeof before === "number" ? before : 0,
          after: typeof after === "number" ? after : 0,
          change,
        });
      }
      outcomesByUser.set(row.user_id, list);
    }
    return users
      .filter((u) => typeof u.id === "string")
      .map((u) => ({
        id: u.id,
        feedback: resolveIdeaFeedback(u.preferences),
        outcomes: outcomesByUser.get(u.id) ?? [],
      }));
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
      select: {
        id: true,
        kind: true,
        title: true,
        entityId: true,
        periodKey: true,
      },
    });
    // המזהה — זהות יציבה לחגיגה במסך; המיקום ברשימה משתנה כשמצטרפת הצלחה.
    // ליעד שהושג גם היעד והתקופה — כדי שהמסך לא יחגוג אותו פעמיים
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as MentorWinKind,
      title: r.title,
      ...(r.kind === "goal_reached"
        ? { goalId: r.entityId, periodKey: r.periodKey }
        : {}),
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
