import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

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
            status: { in: ["sold", "rented"] },
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
}
