import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ulid } from "ulid";
import { BuyerRequirementsSchema, scoreMatch, type BuyerRequirements } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { rowToFields } from "../properties/property.mapper";

/** שורת נכס כפי ש-Prisma מחזירה — הטיפוס נגזר ולא מועתק ידנית. */
type PropertyRow = Parameters<typeof rowToFields>[0];

const INITIAL_CREDITS = 20;
const COOP_OFFER_COST = 1;
/** עיגול תקציב כלפי מעלה ל-100 אלף ₪ — אנונימיזציה (docs/04 §7) */
const BUDGET_ROUND_AGOROT = 10_000_000;

/** נכס שלי שמתאים לביקוש ברשת — כדי שלא צריך לנחש מתוך רשימה. */
export interface DemandMatchDto {
  propertyId: string;
  title: string;
  score: number;
  explanation: string;
}

export interface SharedDemandDto {
  id: string;
  cities: string[];
  dealType: string;
  budgetMaxAgorot: number;
  roomsMin?: number;
  roomsMax?: number;
  mustFeatures: string[];
  source: string;
  status: string;
  /** true אם הביקוש שלי — רק אז יש קישור לקונה */
  mine: boolean;
  originBuyerId?: string;
  createdAt: Date;
  /** הנכסים שלי שמתאימים — מחושב במנוע ההתאמות, לא ניחוש */
  myMatches?: DemandMatchDto[];
}

export interface CoopOfferDto {
  id: string;
  demandId: string;
  direction: "incoming" | "outgoing";
  presentation: Record<string, unknown>;
  status: string;
  createdAt: Date;
}

@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** שיתוף קונה כביקוש אנונימי: בלי שם, בלי טלפון, תקציב מעוגל. */
  async shareBuyer(buyerId: string): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      const buyer = await tx.buyer.findFirst({
        where: { id: buyerId, tenantId, deletedAt: null },
      });
      if (!buyer) throw new NotFoundException("קונה לא נמצא");

      const existing = await tx.sharedDemand.findFirst({
        where: { tenantId, originBuyerId: buyerId, status: "active" },
        select: { id: true },
      });
      if (existing) throw new BadRequestException("הקונה כבר משותף ברשת");

      const requirements = BuyerRequirementsSchema.parse(buyer.requirements);
      const roundedBudget =
        Math.ceil(Number(buyer.budgetMaxAgorot) / BUDGET_ROUND_AGOROT) * BUDGET_ROUND_AGOROT;

      await tx.sharedDemand.create({
        data: {
          id,
          tenantId,
          originBuyerId: buyerId,
          cities: requirements.cities,
          dealType: buyer.dealType,
          budgetMaxAgorot: BigInt(roundedBudget),
          roomsMin: buyer.roomsMin,
          roomsMax: buyer.roomsMax,
          mustFeatures: Object.entries(requirements.features)
            .filter(([, level]) => level === "must")
            .map(([feature]) => feature),
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.share",
        entityType: "shared_demand",
        entityId: id,
        metadata: { buyerId },
      });
    });

    return this.getDemand(id);
  }

  async unshare(demandId: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.sharedDemand.updateMany({
        where: { id: demandId, tenantId, status: "active" },
        data: { status: "closed" },
      });
      if (result.count === 0) throw new NotFoundException("ביקוש לא נמצא");
      await this.audit.record(tx, {
        action: "collaboration.unshare",
        entityType: "shared_demand",
        entityId: demandId,
      });
    });
  }

  /** פיד הביקושים: הרשת כולה (כולל שלי, מסומנים). קריאת הרשת רצה כ-withNetwork. */
  async listDemands(): Promise<SharedDemandDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withNetworkRead((tx) =>
      tx.sharedDemand.findMany({
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );

    /*
     * לכל ביקוש מחושבות ההתאמות מתוך הנכסים *שלי* — בדיוק אותו מנוע
     * שמשמש את ההתאמות הפנימיות. בלי זה המתווך היה בוחר נכס מרשימה
     * נפתחת של עשרות, מנחש, ומבזבז קרדיט על נכס שלא מתאים.
     *
     * הנכסים נטענים פעם אחת לכל הרשימה; הניקוד עצמו הוא פונקציה
     * טהורה בזיכרון.
     */
    const myProperties = await this.prisma.withTenant((tx) =>
      tx.property.findMany({
        // נכס שנמכר או ירד משיווק לא אמור להיות מוצע לרשת
        where: { tenantId, deletedAt: null, status: "active" },
        take: 200,
      }),
    );

    return rows.map((row) => {
      const dto = this.toDemandDto(row, tenantId);
      if (dto.mine) return dto;
      const matches = this.matchOwnProperties(myProperties, row);
      return matches.length > 0 ? { ...dto, myMatches: matches } : dto;
    });
  }

  /** שלוש ההתאמות הטובות ביותר מבין הנכסים שלי, מעל סף שווה-הצגה. */
  private matchOwnProperties(
    properties: PropertyRow[],
    demand: {
      cities: string[];
      dealType: string;
      budgetMaxAgorot: bigint;
      roomsMin: Prisma.Decimal | null;
      roomsMax: Prisma.Decimal | null;
      mustFeatures: string[];
    },
  ): DemandMatchDto[] {
    const requirements = {
      cities: demand.cities,
      neighborhoods: [],
      dealType: demand.dealType,
      propertyTypes: [],
      budgetMaxAgorot: Number(demand.budgetMaxAgorot),
      ...(demand.roomsMin !== null ? { roomsMin: Number(demand.roomsMin) } : {}),
      ...(demand.roomsMax !== null ? { roomsMax: Number(demand.roomsMax) } : {}),
      features: Object.fromEntries(demand.mustFeatures.map((f) => [f, "must"])),
    } as unknown as BuyerRequirements;

    return properties
      .map((property) => {
        const result = scoreMatch(rowToFields(property), requirements);
        return { property, result };
      })
      .filter(({ result }) => !result.excluded && result.score >= 70)
      .sort((a, b) => b.result.score - a.result.score)
      .slice(0, 3)
      .map(({ property, result }) => ({
        propertyId: property.id,
        title:
          property.marketingTitle ??
          ([property.street, property.city].filter(Boolean).join(", ") || "נכס"),
        score: result.score,
        explanation: result.explanation,
      }));
  }

  private async getDemand(id: string): Promise<SharedDemandDto> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant((tx) =>
      tx.sharedDemand.findFirst({ where: { id, tenantId } }),
    );
    if (!row) throw new NotFoundException("ביקוש לא נמצא");
    return this.toDemandDto(row, tenantId);
  }

  /** הצעת נכס לביקוש רשת — עולה קרדיט; חשיפה מדורגת בלי כתובת מדויקת. */
  async offerProperty(demandId: string, propertyId: string): Promise<CoopOfferDto> {
    const ctx = TenantContext.current();
    const id = ulid();

    // הביקוש נקרא בהקשר רשת (ייתכן ששייך לסוכנות אחרת)
    const demand = await this.prisma.withNetworkRead((tx) =>
      tx.sharedDemand.findFirst({ where: { id: demandId, status: "active" } }),
    );
    if (!demand) throw new NotFoundException("הביקוש לא נמצא או נסגר");
    if (demand.tenantId === ctx.tenantId) {
      throw new BadRequestException("זה ביקוש שלך — ההתאמות הפנימיות כבר כיסו אותו");
    }

    await this.prisma.withTenant(async (tx) => {
      const property = await tx.property.findFirst({
        where: {
          id: propertyId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: { in: ["draft", "active"] },
        },
      });
      if (!property) throw new NotFoundException("נכס לא נמצא או אינו משווק");

      const balance = await this.balanceInTx(tx, ctx.tenantId);
      if (balance < COOP_OFFER_COST) {
        throw new BadRequestException("אין מספיק קרדיטים — ניתן לרכוש בהגדרות");
      }

      // חשיפה מדורגת: שכונה+מאפיינים; בלי רחוב, בלי בעלים (docs/04 §7)
      const presentation = {
        city: property.city ?? undefined,
        neighborhood: property.neighborhood ?? undefined,
        rooms: property.rooms === null ? undefined : Number(property.rooms),
        areaSqm: property.areaSqm ?? undefined,
        floor: property.floor ?? undefined,
        priceAgorot: property.priceAgorot === null ? undefined : Number(property.priceAgorot),
        title: property.marketingTitle ?? undefined,
      };

      await tx.coopOffer.create({
        data: {
          id,
          demandId,
          fromTenantId: ctx.tenantId,
          toTenantId: demand.tenantId,
          propertyId,
          presentation,
          creditsCost: COOP_OFFER_COST,
        },
      });
      await tx.creditLedger.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          kind: "coop_offer",
          amount: -COOP_OFFER_COST,
          refId: id,
        },
      });
      await this.audit.record(tx, {
        action: "collaboration.offer",
        entityType: "coop_offer",
        entityId: id,
        metadata: { demandId, propertyId },
      });
      // ההתראה מנותבת לסוכנות המקבלת — tenantId של האירוע הוא היעד
      await tx.outboxEvent.create({
        data: {
          id: ulid(),
          tenantId: demand.tenantId,
          name: "coop_offer.sent",
          payload: { coopOfferId: id, tenantId: demand.tenantId, fromTenantId: ctx.tenantId },
        },
      });
    });

    return {
      id,
      demandId,
      direction: "outgoing",
      presentation: {},
      status: "sent",
      createdAt: new Date(),
    };
  }

  /** הצעות שיתוף — נכנסות (על הביקושים שלי) ויוצאות (ששלחתי). */
  async listCoopOffers(): Promise<CoopOfferDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.coopOffer.findMany({
        where: { OR: [{ toTenantId: tenantId }, { fromTenantId: tenantId }] },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      demandId: row.demandId,
      direction: row.toTenantId === tenantId ? "incoming" : "outgoing",
      presentation: row.presentation as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
    }));
  }

  /** תגובת הסוכנות המקבלת להצעת שיתוף — מעוניין/דחייה. */
  async respondToCoopOffer(id: string, response: "interested" | "declined"): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const result = await tx.coopOffer.updateMany({
        where: { id, toTenantId: tenantId, status: "sent" },
        data: { status: response },
      });
      if (result.count === 0) throw new NotFoundException("הצעת שיתוף לא נמצאה");
      await this.audit.record(tx, {
        action: `collaboration.${response}`,
        entityType: "coop_offer",
        entityId: id,
      });
    });
  }

  async credits(): Promise<{ balance: number }> {
    const tenantId = TenantContext.current().tenantId;
    const balance = await this.prisma.withTenant(async (tx) => {
      const hasAny = await tx.creditLedger.findFirst({
        where: { tenantId },
        select: { id: true },
      });
      if (!hasAny) {
        // מענק פתיחה חד-פעמי — נרשם כתנועה, לא כיתרה קסומה
        await tx.creditLedger.create({
          data: { id: ulid(), tenantId, kind: "initial_grant", amount: INITIAL_CREDITS },
        });
      }
      return this.balanceInTx(tx, tenantId);
    });
    return { balance };
  }

  private async balanceInTx(tx: TenantTx, tenantId: string): Promise<number> {
    const agg = await tx.creditLedger.aggregate({
      where: { tenantId },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  private toDemandDto(
    row: {
      id: string;
      tenantId: string;
      originBuyerId: string | null;
      cities: string[];
      dealType: string;
      budgetMaxAgorot: bigint;
      roomsMin: unknown;
      roomsMax: unknown;
      mustFeatures: string[];
      source: string;
      status: string;
      createdAt: Date;
    },
    viewerTenantId: string,
  ): SharedDemandDto {
    const mine = row.tenantId === viewerTenantId;
    return {
      id: row.id,
      cities: row.cities,
      dealType: row.dealType,
      budgetMaxAgorot: Number(row.budgetMaxAgorot),
      roomsMin: row.roomsMin === null ? undefined : Number(row.roomsMin),
      roomsMax: row.roomsMax === null ? undefined : Number(row.roomsMax),
      mustFeatures: row.mustFeatures,
      source: row.source,
      status: row.status,
      mine,
      // הקישור לקונה נחשף רק לסוכנות המקור — לעולם לא לרשת (docs/04 §7)
      originBuyerId: mine ? (row.originBuyerId ?? undefined) : undefined,
      createdAt: row.createdAt,
    };
  }
}
