import { Injectable } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  scoreMatch,
  MATCH_THRESHOLDS,
  type BuyerRequirements,
} from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { rowToFields } from "../properties/property.mapper";

export interface MatchDto {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  computedAt: Date;
}

/** שורה במסך ההתאמות הדו-צדי (אפיון §15, מסך 4). */
export interface EnrichedMatchDto extends MatchDto {
  property: { address: string; title?: string; priceAgorot?: number };
  /** שם הקונה — רק אם למשתמש יש הרשאה אליו; אחרת מוצג "קונה של סוכן אחר" */
  buyerName: string | null;
}

/**
 * מנוע ההתאמות (docs/07 §5) — צנרת שני שלבים:
 * 1. סינון גס ב-SQL (עיר, תקציב, סוג עסקה) — מצמצם למועמדים רלוונטיים.
 * 2. ניקוד מפורט בפונקציה הטהורה scoreMatch — עם הסבר בעברית.
 *
 * סטטוסים ידניים (dismissed/offered) לעולם לא נדרסים ע"י חישוב מחדש —
 * החלטת המתווך גוברת על האלגוריתם.
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly contacts: ContactsService,
  ) {}

  /**
   * כל ההתאמות הפתוחות במשרד — מסך ההתאמות הדו-צדי. שם הקונה נחשף
   * רק למי שמורשה לקונה (בעלות או view_all) — אין דליפת PII בין סוכנים.
   */
  async listAll(query: {
    minScore: number;
    limit: number;
    propertyId?: string;
  }): Promise<EnrichedMatchDto[]> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.match.findMany({
        where: {
          tenantId,
          status: { not: "dismissed" },
          score: { gte: query.minScore },
          ...(query.propertyId ? { propertyId: query.propertyId } : {}),
        },
        orderBy: { score: "desc" },
        take: query.limit,
      });
      if (rows.length === 0) return [];

      const properties = await tx.property.findMany({
        where: { tenantId, id: { in: [...new Set(rows.map((r) => r.propertyId))] } },
        select: {
          id: true, street: true, neighborhood: true, city: true,
          marketingTitle: true, priceAgorot: true,
        },
      });
      const propertyById = new Map(properties.map((p) => [p.id, p]));

      const visibleBuyers = await tx.buyer.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(rows.map((r) => r.buyerId))] },
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { id: true, contactId: true },
      });
      const buyerNameById = new Map<string, string>();
      for (const buyer of visibleBuyers) {
        const contact = await this.contacts.getById(tx, buyer.contactId);
        if (contact) buyerNameById.set(buyer.id, contact.name);
      }

      return rows.map((row) => {
        const property = propertyById.get(row.propertyId);
        return {
          ...toMatchDto(row),
          property: {
            address: property
              ? [property.street, property.neighborhood, property.city].filter(Boolean).join(", ")
              : "נכס",
            title: property?.marketingTitle ?? undefined,
            priceAgorot:
              property === undefined || property.priceAgorot === null
                ? undefined
                : Number(property.priceAgorot),
          },
          buyerName: buyerNameById.get(row.buyerId) ?? null,
        };
      });
    });
  }

  async recomputeForProperty(propertyId: string): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: { id: propertyId, tenantId, deletedAt: null },
      });
      if (
        !property ||
        property.city === null ||
        property.priceAgorot === null ||
        property.dealType === null
      ) {
        return 0; // בלי עיר, מחיר וסוג עסקה אין סינון אמין — יחושב כשיושלם
      }
      const fields = rowToFields(property);

      // שלב 1 — סינון גס: עיר, סוג עסקה, ותקציב עם מרווח הגמישות (7%)
      const candidates = await tx.buyer.findMany({
        where: {
          tenantId,
          deletedAt: null,
          dealType: property.dealType,
          cities: { has: property.city },
          budgetMaxAgorot: { gte: BigInt(Math.floor(Number(property.priceAgorot) / 1.07)) },
        },
        select: { id: true, requirements: true },
      });

      let kept = 0;
      for (const candidate of candidates) {
        const parsed = BuyerRequirementsSchema.safeParse(candidate.requirements);
        if (!parsed.success) continue;
        kept += await this.upsertMatch(tx, propertyId, candidate.id, fields, parsed.data);
      }

      // נכס שהשתנה (עיר אחרת, מחיר עלה): קונים שיצאו מהסינון הגס לא
      // נבדקים ב-upsertMatch — ההתאמות הישנות שלהם נמחקות כאן.
      await tx.match.deleteMany({
        where: {
          tenantId,
          propertyId,
          status: "suggested",
          buyerId: { notIn: candidates.map((c) => c.id) },
        },
      });

      await this.outbox.emit(tx, "matches.computed", { tenantId, propertyId, matchCount: kept });
      return kept;
    });
  }

  async recomputeForBuyer(buyerId: string): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({ where: { id: buyerId, tenantId, deletedAt: null } });
      if (!buyer) return 0;
      const parsed = BuyerRequirementsSchema.safeParse(buyer.requirements);
      if (!parsed.success) return 0;
      const requirements = parsed.data;

      const candidates = await tx.property.findMany({
        where: {
          tenantId,
          deletedAt: null,
          status: { in: ["draft", "active"] },
          city: { in: requirements.cities },
          ...(requirements.dealType ? { dealType: requirements.dealType } : {}),
          priceAgorot: { lte: BigInt(Math.floor(Number(requirements.budgetMaxAgorot) * 1.07)) },
        },
      });

      let kept = 0;
      for (const property of candidates) {
        kept += await this.upsertMatch(tx, property.id, buyerId, rowToFields(property), requirements);
      }
      // דרישות שצומצמו (עיר הוסרה, תקציב ירד): נכסים שיצאו מהסינון הגס
      // לא נבדקים ב-upsertMatch — ההתאמות הישנות שלהם נמחקות כאן.
      // התאמות שהמתווך נגע בהן (הוצעו/נדחו) לא נמחקות — כמו ב-upsertMatch.
      await tx.match.deleteMany({
        where: {
          tenantId,
          buyerId,
          status: "suggested",
          propertyId: { notIn: candidates.map((p) => p.id) },
        },
      });
      await this.outbox.emit(tx, "matches.computed", { tenantId, buyerId, matchCount: kept });
      return kept;
    });
  }

  private async upsertMatch(
    tx: TenantTx,
    propertyId: string,
    buyerId: string,
    fields: ReturnType<typeof rowToFields>,
    requirements: BuyerRequirements,
  ): Promise<number> {
    const tenantId = TenantContext.current().tenantId;
    const result = scoreMatch(fields, requirements);
    const existing = await tx.match.findUnique({
      where: { tenantId_propertyId_buyerId: { tenantId, propertyId, buyerId } },
      select: { id: true, status: true },
    });

    if (result.excluded || result.score < MATCH_THRESHOLDS.review) {
      // התאמה שאינה רלוונטית עוד — מוסרת רק אם המתווך לא נגע בה
      if (existing && existing.status === "suggested") {
        await tx.match.delete({ where: { id: existing.id } });
      }
      return 0;
    }

    if (existing) {
      await tx.match.update({
        where: { id: existing.id },
        data: {
          score: result.score,
          breakdown: result.breakdown as object[],
          explanation: result.explanation,
          computedAt: new Date(),
        },
      });
    } else {
      await tx.match.create({
        data: {
          id: ulid(),
          tenantId,
          propertyId,
          buyerId,
          score: result.score,
          breakdown: result.breakdown as object[],
          explanation: result.explanation,
          status: "suggested",
          computedAt: new Date(),
        },
      });
    }
    return 1;
  }

  async listForProperty(propertyId: string): Promise<MatchDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.match.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          propertyId,
          status: { not: "dismissed" },
        },
        orderBy: { score: "desc" },
        take: 100,
      });
      return rows.map(toMatchDto);
    });
  }

  async listForBuyer(buyerId: string): Promise<MatchDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.match.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          buyerId,
          status: { not: "dismissed" },
        },
        orderBy: { score: "desc" },
        take: 100,
      });
      return rows.map(toMatchDto);
    });
  }
}

function toMatchDto(row: {
  id: string;
  propertyId: string;
  buyerId: string;
  score: number;
  explanation: string;
  status: string;
  computedAt: Date;
}): MatchDto {
  return {
    id: row.id,
    propertyId: row.propertyId,
    buyerId: row.buyerId,
    score: row.score,
    explanation: row.explanation,
    status: row.status,
    computedAt: row.computedAt,
  };
}
