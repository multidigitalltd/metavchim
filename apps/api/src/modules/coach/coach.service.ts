import { Injectable } from "@nestjs/common";
import {
  buildRecommendations,
  computeReadiness,
  type CoachRecommendation,
  type CoachSignals,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ownershipFilter } from "../../common/ownership";
import { PrismaService } from "../../core/prisma.service";
import { rowToFields } from "../properties/property.mapper";

/**
 * אוסף את האותות מהדאטה של הדייר (מכבד בעלות — סוכן רואה המלצות על
 * הישויות שלו) ומזין את מנוע הכללים הטהור מ-shared.
 */
@Injectable()
export class CoachService {
  constructor(private readonly prisma: PrismaService) {}

  async recommendations(): Promise<CoachRecommendation[]> {
    const tenantId = TenantContext.current().tenantId;
    const signals = await this.prisma.withTenant(async (tx): Promise<CoachSignals> => {
      const buyerScope = ownershipFilter("buyers.view_all", "ownerUserId");
      const leadScope = ownershipFilter("leads.view_all", "assignedToUserId");

      // קונים חמים בלי הצעה כלל
      const hotBuyers = await tx.buyer.findMany({
        where: { tenantId, deletedAt: null, maturity: { in: ["very_hot", "hot"] }, ...buyerScope },
        select: { id: true },
      });
      const offers = await tx.offer.findMany({ where: { tenantId }, select: { matchId: true } });
      const offeredMatches = await tx.match.findMany({
        where: { tenantId, id: { in: offers.map((o) => o.matchId) } },
        select: { buyerId: true },
      });
      const offeredBuyerIds = new Set(offeredMatches.map((m) => m.buyerId));
      const hotBuyersWithoutOffer = hotBuyers.filter((b) => !offeredBuyerIds.has(b.id)).length;

      // נכסים פעילים עם התאמות מוצעות שטרם נשלחו
      const activeProps = await tx.property.findMany({
        where: { tenantId, deletedAt: null, status: { in: ["draft", "active"] } },
      });
      const propertiesWithUnsentMatches: CoachSignals["propertiesWithUnsentMatches"] = [];
      const incompleteProperties: CoachSignals["incompleteProperties"] = [];
      for (const prop of activeProps) {
        const matchCount = await tx.match.count({
          where: { tenantId, propertyId: prop.id, status: "suggested" },
        });
        const title =
          prop.marketingTitle ?? ([prop.street, prop.city].filter(Boolean).join(", ") || "נכס");
        if (matchCount > 0) {
          propertiesWithUnsentMatches.push({ propertyId: prop.id, title, matchCount });
        }
        const readiness = computeReadiness(rowToFields(prop), {
          hasTitle: Boolean(prop.marketingTitle),
          hasDescription: Boolean(prop.marketingDescription),
        });
        if (readiness.missingFields.length > 0) {
          incompleteProperties.push({
            propertyId: prop.id,
            title,
            missingCount: readiness.missingFields.length,
          });
        }
      }

      // הצעות שנפתחו 3+ פעמים ולא הביעו עניין
      const hesitating = await tx.offer.findMany({
        where: { tenantId, openCount: { gte: 3 }, status: { in: ["opened", "sent", "delivered"] } },
        orderBy: { openCount: "desc" },
        take: 10,
      });
      const hesitatingOffers: CoachSignals["hesitatingOffers"] = [];
      for (const offer of hesitating) {
        const presentation = offer.presentation as { title?: string };
        hesitatingOffers.push({
          offerId: offer.id,
          propertyTitle: presentation.title ?? "נכס",
          openCount: offer.openCount,
        });
      }

      // לידים דחופים
      const urgent = await tx.lead.findMany({
        where: { tenantId, requiresHuman: true, status: { in: ["new", "in_progress"] }, ...leadScope },
        take: 5,
      });
      const urgentLeads: CoachSignals["urgentLeads"] = urgent.map((l) => ({
        leadId: l.id,
        // אין צורך בשם המלא כאן — ה-UI מקשר לליד; מונע פענוח PII מיותר
        contactName: "לקוח",
      }));

      // סיורים שהסתיימו בלי סיכום תוצאה
      const pastViewings = await tx.appointment.findMany({
        where: {
          tenantId,
          kind: "viewing",
          status: "scheduled",
          startsAt: { lt: new Date() },
          outcome: null,
        },
        take: 5,
      });
      const pastViewingsWithoutOutcome: CoachSignals["pastViewingsWithoutOutcome"] = pastViewings.map(
        (a) => ({ appointmentId: a.id, title: a.title ?? "סיור" }),
      );

      return {
        hotBuyersWithoutOffer,
        propertiesWithUnsentMatches,
        hesitatingOffers,
        urgentLeads,
        incompleteProperties,
        pastViewingsWithoutOutcome,
      };
    });

    return buildRecommendations(signals);
  }
}
