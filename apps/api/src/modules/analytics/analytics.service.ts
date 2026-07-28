import { Injectable } from "@nestjs/common";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";

export interface OfficeStats {
  properties: { total: number; active: number; needsCompletion: number };
  buyers: { total: number; hot: number };
  leads: { open: number; requiresHuman: number; converted: number };
  offers: { sent: number; opened: number; interested: number };
  appointments: { upcoming: number };
  /** אחוז הצעות שנפתחו מתוך שנשלחו — מדד יעילות ההצעות */
  offerOpenRate: number;
}

export interface AgentPerformance {
  userId: string;
  name: string;
  role: string;
  buyers: number;
  leads: number;
  offersSent: number;
  appointments: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** תמונת מצב המשרד — כל המונים בשאילתות מצטברות, בלי לשלוף שורות. */
  async officeStats(): Promise<OfficeStats> {
    const tenantId = TenantContext.current().tenantId;
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
      ] = await Promise.all([
        tx.property.count({ where: { tenantId, deletedAt: null } }),
        tx.property.count({ where: { tenantId, deletedAt: null, status: "active" } }),
        tx.property.count({ where: { tenantId, deletedAt: null, readinessScore: { lt: 80 } } }),
        tx.buyer.count({ where: { tenantId, deletedAt: null } }),
        tx.buyer.count({ where: { tenantId, deletedAt: null, maturity: { in: ["very_hot", "hot"] } } }),
        tx.lead.count({ where: { tenantId, status: { in: ["new", "in_progress"] } } }),
        tx.lead.count({ where: { tenantId, requiresHuman: true } }),
        tx.lead.count({ where: { tenantId, status: "converted" } }),
        tx.offer.count({ where: { tenantId, status: { not: "pending_approval" } } }),
        tx.offer.count({ where: { tenantId, status: { in: ["opened", "interested"] } } }),
        tx.offer.count({ where: { tenantId, status: "interested" } }),
        tx.appointment.count({
          where: { tenantId, status: "scheduled", startsAt: { gte: new Date() } },
        }),
      ]);

      return {
        properties: { total: propsTotal, active: propsActive, needsCompletion: propsIncomplete },
        buyers: { total: buyersTotal, hot: buyersHot },
        leads: { open: leadsOpen, requiresHuman: leadsRequiresHuman, converted: leadsConverted },
        offers: { sent: offersSent, opened: offersOpened, interested: offersInterested },
        appointments: { upcoming: appointmentsUpcoming },
        offerOpenRate: offersSent > 0 ? Math.round((offersOpened / offersSent) * 100) : 0,
      };
    });
  }

  /** ביצועים לפי סוכן — לניהול צוות במסלול Agency (דורש users.manage). */
  async agentPerformance(): Promise<AgentPerformance[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const users = await tx.user.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, role: true },
      });

      const [buyersByUser, leadsByUser, apptByUser] = await Promise.all([
        tx.buyer.groupBy({
          by: ["ownerUserId"],
          where: { tenantId, deletedAt: null },
          _count: { _all: true },
        }),
        tx.lead.groupBy({
          by: ["assignedToUserId"],
          where: { tenantId },
          _count: { _all: true },
        }),
        tx.appointment.groupBy({
          by: ["createdBy"],
          where: { tenantId },
          _count: { _all: true },
        }),
      ]);

      const buyerCount = new Map(buyersByUser.map((r) => [r.ownerUserId, r._count._all]));
      const leadCount = new Map(leadsByUser.map((r) => [r.assignedToUserId, r._count._all]));
      const apptCount = new Map(apptByUser.map((r) => [r.createdBy, r._count._all]));

      // הצעות נספרות דרך הליד המשויך — groupBy עקיף, לכן שאילתה נפרדת קלה
      const offersByAgent = await tx.$queryRaw<{ agent: string; n: bigint }[]>`
        SELECT l.assigned_to_user_id AS agent, COUNT(o.id) AS n
        FROM offers o
        JOIN matches m ON m.id = o.match_id
        JOIN buyers b ON b.id = m.buyer_id
        JOIN leads l ON l.contact_id = b.contact_id
        WHERE o.tenant_id = ${tenantId} AND l.assigned_to_user_id IS NOT NULL
        GROUP BY l.assigned_to_user_id`;
      const offerCount = new Map(offersByAgent.map((r) => [r.agent, Number(r.n)]));

      return users.map((u) => ({
        userId: u.id,
        name: u.name,
        role: u.role,
        buyers: buyerCount.get(u.id) ?? 0,
        leads: leadCount.get(u.id) ?? 0,
        offersSent: offerCount.get(u.id) ?? 0,
        appointments: apptCount.get(u.id) ?? 0,
      }));
    });
  }
}
