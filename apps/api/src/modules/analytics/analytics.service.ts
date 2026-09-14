import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  boardMovement,
  boardScore,
  delta,
  boardGoal,
  periodEnd,
  periodStart,
  periodTitle,
  previousPeriodTitle,
  superlative,
  DEAL_STATUSES,
  formatPropertyAddress,
  partnerShare,
  type DealStatus,
  type BoardCounts,
  type BoardMetric,
  type BoardGoal,
  type BoardMovement,
  type BoardPeriod,
  type Superlative,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**תקרת השת״פים שמוצגים בלוח.**
 *
 * ‏המקטע הוא צילום ולא דוח: מנהל רוצה לראות מה קרה החודש, ולא
 * ‏לגלול מאתיים שורות. התקרה שומרת על זמן התגובה של העמוד, והמונה
 * ‏(„3 מתוך 12”) נשאר נכון בכל מקרה כי הוא נספר בנפרד.
 */
const PARTNER_ROWS_MAX = 50;

/**
 * חלון הדיווח בימים. null = מאז ומעולם.
 *
 * הבחנה שקובעת את נכונות הדוח: מדדי **מצב** (נכסים פעילים, קונים חמים,
 * לידים פתוחים, פגישות עתידיות) מתארים את הרגע הנוכחי ואינם מסוננים
 * לפי תקופה — "נכסים פעילים ב-30 הימים האחרונים" הוא מספר חסר משמעות.
 * מדדי **תנועה** (הצעות שנשלחו/נפתחו/עניינו, לידים שהומרו) כן מסוננים.
 */
export type ReportWindowDays = 30 | 90 | 365 | null;

export interface OfficeStats {
  /** מצב נוכחי — לא מושפע מהתקופה */
  properties: { total: number; active: number; needsCompletion: number };
  buyers: { total: number; hot: number };
  leads: { open: number; requiresHuman: number; converted: number };
  appointments: { upcoming: number };
  /** תנועה בתקופה שנבחרה */
  offers: { sent: number; opened: number; interested: number };
  /**
   * עסקאות שנסגרו בתקופה — נכסים שעברו ל"נמכר" או "הושכר".
   * זה המדד היחיד כאן שמודד **תוצאה** ולא פעילות, ולכן הוא ראשון
   * בדוח: מתווך שמסתכל על דוח רוצה לדעת כמה סגר, לא כמה שלח.
   */
  deals: { closed: number };
  /**
   * סיורים שהתקיימו בתקופה, ומתוכם כמה ללא תיעוד תוצאה. סיור בלי
   * תיעוד הוא ידע שאבד — הקונה אמר משהו והמערכת לא יודעת מה.
   */
  viewings: { held: number; missingOutcome: number };
  /**
   * ימים ממוצעים מיצירת הקונה ועד ההצעה הראשונה שנשלחה אליו.
   * null = טרם נשלחה אף הצעה בתקופה. מדד המהירות של המשרד —
   * קונה שמקבל הצעה באותו יום נסגר אחרת מקונה שממתין שבוע.
   */
  daysToFirstOffer: number | null;
  /** אחוז הצעות שנפתחו מתוך שנשלחו — מדד יעילות ההצעות */
  offerOpenRate: number;
  windowDays: ReportWindowDays;
}

/** ‏שורה אחת בטבלת התחרות. */
export interface BoardRow {
  userId: string;
  name: string;
  role: string;
  counts: BoardCounts;
  score: number;
  rank: number;
  movement: BoardMovement;
  /**
   * ‏היעד החודשי שהסוכן קבע במנטור, מדד מול אותו מדד.
   *
   * ‎`null` = לא קבע יעד שהטבלה יודעת למדוד, או שהלשונית אינה
   * ‏החודש — יעד חודשי מול מוני רבעון אינו אחוז שאומר משהו.
   */
  goal: BoardGoal | null;
}

export interface OfficeBoard {
  period: BoardPeriod;
  title: string;
  previousTitle: string;
  agents: number;
  rows: BoardRow[];
  superlatives: Superlative[];
  summary: { key: BoardMetric | "calls"; value: number; diff: number; percent: number | null }[];
}

export interface AgentPerformance {
  userId: string;
  name: string;
  role: string;
  buyers: number;
  leads: number;
  offersSent: number;
  /** כמה מההצעות שנשלחו הביאו לתגובת "מעוניין" */
  offersInterested: number;
  appointments: number;
}

/** גבול תחתון לחלון — undefined כשאין סינון. */
function since(windowDays: ReportWindowDays): Date | undefined {
  if (windowDays === null) return undefined;
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** תמונת מצב המשרד — כל המונים בשאילתות מצטברות, בלי לשלוף שורות. */
  async officeStats(windowDays: ReportWindowDays = 30): Promise<OfficeStats> {
    const tenantId = TenantContext.current().tenantId;
    const from = since(windowDays);
    const inWindow = from ? { createdAt: { gte: from } } : {};
    return this.prisma.withTenant(async (tx) => {
      const [
        propsTotal,
        propsActive,
        propsIncomplete,
        buyersTotal,
        buyersHot,
        leadsOpen,
        leadsRequiresHuman,
        leadsConverted,
        offersSent,
        offersOpened,
        offersInterested,
        appointmentsUpcoming,
        dealsClosed,
        viewingsHeld,
        viewingsMissingOutcome,
      ] = await Promise.all([
        tx.property.count({ where: { tenantId, deletedAt: null } }),
        tx.property.count({ where: { tenantId, deletedAt: null, status: "active" } }),
        tx.property.count({ where: { tenantId, deletedAt: null, readinessScore: { lt: 80 } } }),
        tx.buyer.count({ where: { tenantId, deletedAt: null } }),
        tx.buyer.count({ where: { tenantId, deletedAt: null, maturity: { in: ["very_hot", "hot"] } } }),
        tx.lead.count({
          where: { tenantId, status: { in: ["new", "in_progress", "waiting_customer"] } },
        }),
        tx.lead.count({ where: { tenantId, requiresHuman: true } }),
        tx.lead.count({ where: { tenantId, status: "converted", ...inWindow } }),
        tx.offer.count({ where: { tenantId, status: { not: "pending_approval" }, ...inWindow } }),
        // "נפתחה" לפי חותמת הפתיחה ההיסטורית — הצעה שנפתחה ואז נדחתה עדיין נספרת
        tx.offer.count({ where: { tenantId, firstOpenedAt: { not: null }, ...inWindow } }),
        tx.offer.count({ where: { tenantId, status: "interested", ...inWindow } }),
        tx.appointment.count({
          where: { tenantId, status: "scheduled", startsAt: { gte: new Date() } },
        }),
        // עסקאות: נמדדות לפי updatedAt ולא createdAt — מה שקובע הוא
        // מתי הנכס נסגר, לא מתי נקלט. נכס שנקלט בינואר ונמכר במרץ
        // שייך למרץ.
        tx.property.count({
          where: {
            tenantId,
            // נכס שנמחק אינו עסקה שנסגרה, גם אם הסטטוס שלו נשאר "נמכר"
            deletedAt: null,
            /* ‏אותה הגדרת „עסקה” שהלוח סופר — קטלוג אחד, לא רשימה שנכתבה שוב */
            status: { in: [...DEAL_STATUSES] },
            ...(from ? { updatedAt: { gte: from } } : {}),
          },
        }),
        tx.appointment.count({
          where: {
            tenantId,
            kind: "viewing",
            status: "completed",
            ...(from ? { startsAt: { gte: from } } : {}),
          },
        }),
        tx.appointment.count({
          where: {
            tenantId,
            kind: "viewing",
            status: "completed",
            outcome: null,
            ...(from ? { startsAt: { gte: from } } : {}),
          },
        }),
      ]);

      const daysToFirstOffer = await this.averageDaysToFirstOffer(tx, tenantId, from);

      return {
        deals: { closed: dealsClosed },
        viewings: { held: viewingsHeld, missingOutcome: viewingsMissingOutcome },
        daysToFirstOffer,
        properties: { total: propsTotal, active: propsActive, needsCompletion: propsIncomplete },
        buyers: { total: buyersTotal, hot: buyersHot },
        leads: { open: leadsOpen, requiresHuman: leadsRequiresHuman, converted: leadsConverted },
        offers: { sent: offersSent, opened: offersOpened, interested: offersInterested },
        appointments: { upcoming: appointmentsUpcoming },
        offerOpenRate: offersSent > 0 ? Math.round((offersOpened / offersSent) * 100) : 0,
        windowDays,
      };
    });
  }

  /**
   * ימים ממוצעים מיצירת הקונה ועד ההצעה הראשונה שנשלחה אליו.
   *
   * נמדד על ההצעה **הראשונה** לכל קונה ולא על כל הצעה: קונה שקיבל
   * חמש הצעות לאורך חודשיים היה מושך את הממוצע כלפי מעלה ומסתיר את
   * מה שהמדד בא לענות עליו — כמה מהר המשרד מגיב לקונה חדש.
   *
   * שאילתה גולמית אחת ולא שליפה לזיכרון: החישוב הוא צימוד של הצעות,
   * התאמות וקונים, ובמאגר של אלפי הצעות שליפה לצד הלקוח הייתה
   * מיותרת לגמרי.
   */
  private async averageDaysToFirstOffer(
    tx: Parameters<Parameters<PrismaService["withTenant"]>[0]>[0],
    tenantId: string,
    from: Date | undefined,
  ): Promise<number | null> {
    const rows = await tx.$queryRaw<{ avg_days: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (first_offer - b.created_at)) / 86400)::float AS avg_days
      FROM (
        SELECT m.buyer_id, MIN(o.sent_at) AS first_offer
        FROM offers o
        JOIN matches m ON m.id = o.match_id AND m.tenant_id = o.tenant_id
        WHERE o.tenant_id = ${tenantId}
          AND o.sent_at IS NOT NULL
          ${from ? Prisma.sql`AND o.sent_at >= ${from}` : Prisma.empty}
        GROUP BY m.buyer_id
      ) f
      JOIN buyers b ON b.id = f.buyer_id AND b.tenant_id = ${tenantId}
      -- הצעה שנשלחה לפני יצירת הקונה היא נתון פגום (ייבוא, תיקון
      -- ידני); היא הייתה מושכת את הממוצע למספר שלילי חסר משמעות
      WHERE f.first_offer >= b.created_at
    `;
    const avg = rows[0]?.avg_days;
    return avg === null || avg === undefined ? null : Math.round(avg * 10) / 10;
  }

  /** ביצועים לפי סוכן — לניהול צוות במסלול Agency (דורש users.manage). */
  async agentPerformance(windowDays: ReportWindowDays = 30): Promise<AgentPerformance[]> {
    const tenantId = TenantContext.current().tenantId;
    const from = since(windowDays);
    const inWindow = from ? { createdAt: { gte: from } } : {};
    return this.prisma.withTenant(async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, role: true },
      });

      const [buyersByUser, leadsByUser, apptByUser] = await Promise.all([
        tx.buyer.groupBy({
          by: ["ownerUserId"],
          where: { tenantId, deletedAt: null, ...inWindow },
          _count: { _all: true },
        }),
        tx.lead.groupBy({
          by: ["assignedToUserId"],
          where: { tenantId, ...inWindow },
          _count: { _all: true },
        }),
        tx.appointment.groupBy({
          by: ["createdBy"],
          where: { tenantId, ...inWindow },
          _count: { _all: true },
        }),
      ]);

      const buyerCount = new Map(buyersByUser.map((r) => [r.ownerUserId, r._count._all]));
      const leadCount = new Map(leadsByUser.map((r) => [r.assignedToUserId, r._count._all]));
      const apptCount = new Map(apptByUser.map((r) => [r.createdBy, r._count._all]));

      // הצעה משויכת לסוכן דרך בעל הקונה (buyer.ownerUserId) — שיוך יחיד
      // ודטרמיניסטי; לא JOIN דרך לידים שעלול לספור הצעה כמה פעמים
      // (ביקורת Codex, PR #6).
      // גבול התקופה מוזרק כפרמטר; NULL מבטל את התנאי בלי ענף SQL שני
      const offersFrom = from ?? null;
      const offersByAgent = await tx.$queryRaw<
        { agent: string; n: bigint; interested: bigint }[]
      >`
        SELECT b.owner_user_id AS agent,
               COUNT(o.id) AS n,
               COUNT(o.id) FILTER (WHERE o.status = 'interested') AS interested
        FROM offers o
        JOIN matches m ON m.id = o.match_id
        JOIN buyers b ON b.id = m.buyer_id
        WHERE o.tenant_id = ${tenantId}
          AND b.owner_user_id IS NOT NULL
          AND (${offersFrom}::timestamp IS NULL OR o.created_at >= ${offersFrom}::timestamp)
        GROUP BY b.owner_user_id`;
      const offerCount = new Map(offersByAgent.map((r) => [r.agent, Number(r.n)]));
      const interestedCount = new Map(
        offersByAgent.map((r) => [r.agent, Number(r.interested)]),
      );

      return users.map((u) => ({
        userId: u.id,
        name: u.name,
        role: u.role,
        buyers: buyerCount.get(u.id) ?? 0,
        leads: leadCount.get(u.id) ?? 0,
        offersSent: offerCount.get(u.id) ?? 0,
        offersInterested: interestedCount.get(u.id) ?? 0,
        appointments: apptCount.get(u.id) ?? 0,
      }));
    });
  }

  /**
   * ‎**„המשרד שלנו” — טבלת התחרות של סוכנות.**
   *
   * ## ‏למה זו מתודה נפרדת מ-`agentPerformance`
   *
   * ‏הדוח עונה על „מה קרה” (מונים, ממוצעים, אחוזי המרה) על חלון
   * ‏**מתגלגל** של 30/90 יום. המסך הזה עונה על „מי מוביל **החודש**”,
   * ‏ולכן הוא מודד **תקופה קלנדרית** בשעון ישראל ומשווה אותה
   * ‏לקודמת. אלה שתי שאלות ושני חלונות; מיזוג שלהן היה מחייב את
   * ‏אחת מהן להתפשר על הגבול שלה.
   *
   * ## ‏מה נספר, ולמי
   *
   * | מדד | הטבלה | השיוך |
   * | --- | --- | --- |
   * | שיחות | `calls` | `agent_user_id`, יוצאות בלבד |
   * | לידים | `leads` | `assigned_to_user_id` |
   * | נכסים | `properties` | `agent_user_id`, לפי מועד היצירה |
   * | פגישות | `appointments` | `owner_user_id` — **היומן של מי**, ולא מי הקליד |
   * | עסקאות | `properties` | `agent_user_id`, סטטוס נמכר/הושכר לפי מועד העדכון |
   *
   * ‎`owner_user_id` ולא `created_by` בפגישות: פגישה שמנהל קובע
   * ‏לסוכן היא של הסוכן, וספירתה למנהל הייתה נותנת לו את הנקודות
   * ‏על עבודה של מישהו אחר — במסך שכל תכליתו לומר מי עשה מה.
   *
   * ## ‏והתקופה הקודמת נמדדת במלואה
   *
   * ‏הדירוג הקודם מחושב מאותן שאילתות על החלון הקודם, ולא נשמר
   * ‏בטבלה: מיקום שמור מתיישן ברגע שסוכן מצטרף או עוזב, והתנועה
   * ‏שהמסך מציג הייתה מודדת מול צילום שגוי.
   */
  async board(period: BoardPeriod = "month", now = new Date()): Promise<OfficeBoard> {
    const tenantId = TenantContext.current().tenantId;
    const start = periodStart(period, now);
    const prevStart = periodStart(period, new Date(start.getTime() - 1));
    /*
     * ‎**גם החלון הנוכחי חסום מלמעלה.**
     *
     * ‏הפגישות מסוננות לפי `startsAt` — הזמן שנקבע, לא זמן
     * ‏ההתרחשות — ולכן חלון פתוח היה סופר עכשיו כל פגישה עתידית,
     * ‏מנפח את הניקוד ומשנה את הדירוג של התקופה המוצגת
     * ‏(ביקורת Codex). הגבול הוא **המוקדם מבין** סוף התקופה
     * ‏ועכשיו: פגישה שנקבעה ל-28 בחודש אינה ביצוע ב-5 בו.
     */
    const end = periodEnd(period, now);
    const until = now < end ? now : end;

    return this.prisma.withTenant(async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        /* ‎`createdAt` — כדי להבחין בין „חודש ראשון” ל„לא היה בדירוג” */
        select: { id: true, name: true, role: true, createdAt: true },
        orderBy: { name: "asc" },
      });

      const window = async (from: Date, to: Date): Promise<Map<string, BoardCounts>> => {
        const range = { gte: from, lt: to };
        const [calls, leads, properties, viewings, deals] = await Promise.all([
          tx.call.groupBy({
            by: ["agentUserId"],
            where: { tenantId, direction: "outgoing", occurredAt: range },
            _count: { _all: true },
          }),
          tx.lead.groupBy({
            by: ["assignedToUserId"],
            where: { tenantId, createdAt: range },
            _count: { _all: true },
          }),
          tx.property.groupBy({
            by: ["agentUserId"],
            where: { tenantId, deletedAt: null, createdAt: range },
            _count: { _all: true },
          }),
          tx.appointment.groupBy({
            by: ["ownerUserId"],
            where: { tenantId, startsAt: range, status: { not: "cancelled" } },
            _count: { _all: true },
          }),
          /*
           * ‎**„עסקה” מוגדרת פעם אחת** (`DEAL_STATUSES`), כי מקטע
           * ‏השת״פים למטה סופר את אותו הדבר. שתי רשימות שנכתבו
           * ‏ביד היו מציגות „3 שת״פים מתוך 12 עסקאות” על שני
           * ‏מכנים שונים — מספר שנראה אמין ואינו נכון.
           */
          tx.property.groupBy({
            by: ["agentUserId"],
            where: {
              tenantId,
              deletedAt: null,
              status: { in: [...DEAL_STATUSES] },
              updatedAt: range,
            },
            _count: { _all: true },
          }),
        ]);
        const map = new Map<string, BoardCounts>();
        const put = (
          id: string | null,
          key: keyof BoardCounts,
          n: number,
        ): void => {
          if (id === null) return;
          const row = map.get(id) ?? { calls: 0, leads: 0, properties: 0, viewings: 0, deals: 0 };
          row[key] += n;
          map.set(id, row);
        };
        for (const r of calls) put(r.agentUserId, "calls", r._count._all);
        for (const r of leads) put(r.assignedToUserId, "leads", r._count._all);
        for (const r of properties) put(r.agentUserId, "properties", r._count._all);
        for (const r of viewings) put(r.ownerUserId, "viewings", r._count._all);
        for (const r of deals) put(r.agentUserId, "deals", r._count._all);
        return map;
      };

      const [current, previous] = await Promise.all([
        window(start, until),
        window(prevStart, start),
      ]);

      /*
       * ‎**היעד החודשי — מהמנטור, ולא מטבלה שנייה.**
       *
       * ‏זה היעד ש**הסוכן קבע לעצמו**, וזו כל הסיבה שעמודת „יעד
       * ‏חודשי” בטבלה אינה מדד שהמנהל כפה. יעד שהסתיים
       * ‎(`endedAt`) אינו נספר: הוא של תקופה שנגמרה.
       *
       * ‎**ורק בלשונית החודש.** היעדים כאן הם `period: "month"`,
       * ‏והשוואה שלהם למונים של רבעון או שנה הייתה מציגה אחוז
       * ‏שאינו אומר דבר. `metric` נשלף כי ההשוואה היא מדד מול
       * ‏אותו מדד — ראו `boardGoal` (ביקורת Codex).
       */
      const goals =
        period === "month"
          ? await tx.mentorGoal.findMany({
              where: { tenantId, period: "month", endedAt: null },
              select: { userId: true, metric: true, target: true },
            })
          : [];
      const goalsBy = new Map<string, { metric: string; target: number }[]>();
      for (const goal of goals) {
        const list = goalsBy.get(goal.userId) ?? [];
        list.push({ metric: goal.metric, target: goal.target });
        goalsBy.set(goal.userId, list);
      }

      const empty: BoardCounts = { calls: 0, leads: 0, properties: 0, viewings: 0, deals: 0 };
      const ranked = (counts: Map<string, BoardCounts>): Map<string, number> => {
        const order = users
          .map((u) => ({ id: u.id, score: boardScore(counts.get(u.id) ?? empty) }))
          /* ‏מי שלא עשה דבר בתקופה אינו מדורג בה — אין לו ממה לזוז */
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score);
        return new Map(order.map((row, i) => [row.id, i + 1]));
      };
      const prevRank = ranked(previous);

      const rows = users
        .map((u) => {
          const counts = current.get(u.id) ?? empty;
          const score = boardScore(counts);
          return {
            userId: u.id,
            name: u.name,
            role: u.role,
            joinedAt: u.createdAt,
            counts,
            score,
          };
        })
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "he"));

      const total = rows.length;
      const rowsWithRank: BoardRow[] = rows.map((row, i) => ({
        ...row,
        rank: i + 1,
        /*
         * ‎**„חודש ראשון” נקבע מתאריך ההצטרפות, ולא מניקוד אפס.**
         * ‏סוכן ותיק שהיה חודש בחופשה יוצא גם הוא מהדירוג הקודם,
         * ‏ו„חודש ראשון” עליו הוא שקר (ביקורת Codex).
         */
        movement: boardMovement(
          i + 1,
          prevRank.get(row.userId) ?? null,
          total,
          row.joinedAt >= start,
        ),
        goal: boardGoal(row.counts, goalsBy.get(row.userId) ?? []),
      }));

      const sum = (map: Map<string, BoardCounts>, key: keyof BoardCounts): number =>
        [...map.values()].reduce((acc, row) => acc + row[key], 0);

      /*
       * ‎**שת״פים בתוך המשרד — עסקאות שנסגרו בשניים.**
       *
       * ‏אותו חלון ואותה הגדרת „עסקה” כמו בניקוד (`sold`/`rented`
       * ‏שעודכנו בתקופה) — שאלה אחת, תשובה אחת. הגדרה שנייה כאן
       * ‏הייתה מציגה „3 שת״פים מתוך 12 עסקאות” על שני מכנים שונים.
       *
       * ‎**והניקוד אינו נוגע בזה** (הכרעת בעל המוצר): `deals` למעלה
       * ‏ממשיך להיספר לפי `agentUserId` בלבד. הקריאה הזו נפרדת
       * ‏לגמרי ואינה נכנסת ל-`window`.
       */
      const partnered = await tx.property.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: [...DEAL_STATUSES] },
          updatedAt: { gte: start, lt: until },
          partnerUserId: { not: null },
        },
        select: {
          id: true,
          city: true,
          street: true,
          houseNumber: true,
          status: true,
          updatedAt: true,
          agentUserId: true,
          partnerUserId: true,
        },
        orderBy: { updatedAt: "desc" },
        /* ‏מקטע ולא דוח: תקרה שומרת על זמן התגובה של הלוח */
        take: PARTNER_ROWS_MAX,
      });
      const names = new Map(users.map((u) => [u.id, u.name]));
      const partnerDeals = partnered.map((row) => ({
        propertyId: row.id,
        address: formatPropertyAddress({
          city: row.city ?? undefined,
          street: row.street ?? undefined,
          houseNumber: row.houseNumber ?? undefined,
        }),
        status: row.status as DealStatus,
        closedAt: row.updatedAt,
        /*
         * ‏שם של מי שכבר אינו במשרד אינו נמצא ב-`users` (הרשימה
         * ‏מסוננת ל-`isActive`), ולכן „סוכן שעזב” ולא מזהה גולמי.
         */
        agentName: names.get(row.agentUserId ?? "") ?? "סוכן שעזב",
        partnerName: names.get(row.partnerUserId ?? "") ?? "סוכן שעזב",
      }));

      return {
        period,
        title: periodTitle(period, now),
        previousTitle: previousPeriodTitle(period, now),
        agents: total,
        rows: rowsWithRank,
        superlatives: (["leads", "calls", "deals", "properties"] as const)
          .map((metric) => superlative(metric, rows))
          .filter((item): item is Superlative => item !== null),
        summary: (["calls", "leads", "properties", "deals"] as const).map((key) => ({
          key,
          value: sum(current, key),
          ...delta(sum(current, key), sum(previous, key)),
        })),
        partners: {
          deals: partnerDeals,
          /* ‏„3 מתוך 12” — המכנה הוא אותו `deals` שהניקוד סופר */
          share: partnerShare(partnerDeals.length, sum(current, "deals")),
        },
      };
    });
  }
}
