import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  BuyerRequirementsSchema,
  type BuyerRequirements,
  type Page,
} from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { MatchingService } from "../matching/matching.service";

export interface BuyerDto {
  id: string;
  contact: { id: string; name: string; phone: string };
  requirements: BuyerRequirements;
  financing: string;
  maturity: string;
  source: string;
  agentNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BuyersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
  ) {}

  async create(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<BuyerDto> {
    const id = await this.persist(input);
    await this.matching.recomputeForBuyer(id);
    return this.getById(id);
  }

  /**
   * ייבוא בכמות (docs/08 §6): ההצלחה נקבעת בגבול הטרנזקציה — ברגע שהקונה
   * נשמר הוא "נוצר", גם אם חישוב ההתאמות שאחריו נכשל זמנית (best-effort;
   * יחושב מחדש בעריכה הבאה). מונע דיווח-כזב וכפילויות בניסיון חוזר.
   */
  async createForImport(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<string> {
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForBuyer(id);
    } catch {
      // הקונה כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  /** יוצר את רשומת הקונה (+ איש הקשר) בטרנזקציה יחידה — גבול ההצלחה. */
  private async persist(input: {
    contactName: string;
    contactPhone: string;
    requirements: BuyerRequirements;
    financing?: string;
    maturity?: string;
    source: string;
    agentNotes?: string;
  }): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      const contact = await this.contacts.findOrCreateByPhone(tx, {
        name: input.contactName,
        phone: input.contactPhone,
      });
      await tx.buyer.create({
        data: {
          id,
          tenantId,
          contactId: contact.id,
          ownerUserId: TenantContext.current().userId,
          cities: input.requirements.cities,
          dealType: input.requirements.dealType,
          budgetMinAgorot:
            input.requirements.budgetMinAgorot === undefined
              ? null
              : BigInt(input.requirements.budgetMinAgorot),
          budgetMaxAgorot: BigInt(input.requirements.budgetMaxAgorot),
          roomsMin: input.requirements.roomsMin ?? null,
          roomsMax: input.requirements.roomsMax ?? null,
          requirements: input.requirements as object,
          financing: input.financing ?? "unknown",
          maturity: input.maturity ?? "interested",
          source: input.source,
          agentNotes: input.agentNotes ?? null,
        },
      });
      await this.audit.record(tx, { action: "buyer.create", entityType: "buyer", entityId: id });
      await this.outbox.emit(tx, "buyer.updated", {
        buyerId: id,
        tenantId,
        changedFields: ["created"],
      });
    });

    return id;
  }

  async update(
    id: string,
    patch: {
      requirements?: BuyerRequirements;
      financing?: string;
      maturity?: string;
      agentNotes?: string;
    },
  ): Promise<BuyerDto> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.buyer.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("קונה לא נמצא");

      await tx.buyer.update({
        where: { id },
        data: {
          ...(patch.requirements
            ? {
                cities: patch.requirements.cities,
                dealType: patch.requirements.dealType,
                budgetMinAgorot:
                  patch.requirements.budgetMinAgorot === undefined
                    ? null
                    : BigInt(patch.requirements.budgetMinAgorot),
                budgetMaxAgorot: BigInt(patch.requirements.budgetMaxAgorot),
                roomsMin: patch.requirements.roomsMin ?? null,
                roomsMax: patch.requirements.roomsMax ?? null,
                requirements: patch.requirements as object,
              }
            : {}),
          ...(patch.financing !== undefined ? { financing: patch.financing } : {}),
          ...(patch.maturity !== undefined
            ? { maturity: patch.maturity, maturityOverridden: true }
            : {}),
          ...(patch.agentNotes !== undefined ? { agentNotes: patch.agentNotes } : {}),
        },
      });
      await this.audit.record(tx, {
        action: "buyer.update",
        entityType: "buyer",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
      await this.outbox.emit(tx, "buyer.updated", {
        buyerId: id,
        tenantId,
        changedFields: Object.keys(patch),
      });
    });

    if (patch.requirements) {
      await this.matching.recomputeForBuyer(id);
    }
    return this.getById(id);
  }

  async getById(id: string): Promise<BuyerDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.buyer.findFirst({
        where: {
          id,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
      });
      if (!row) throw new NotFoundException("קונה לא נמצא");
      const contact = await this.contacts.getById(tx, row.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");
      return this.toDto(row, contact);
    });
  }

  async list(query: { maturity?: string; cursor?: string; limit: number }): Promise<Page<BuyerDto>> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.buyer.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
          ...(query.maturity ? { maturity: query.maturity } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const items: BuyerDto[] = [];
      for (const row of page) {
        const contact = await this.contacts.getById(tx, row.contactId);
        if (contact) items.push(this.toDto(row, contact));
      }
      return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    });
  }

  private toDto(
    row: {
      id: string;
      requirements: unknown;
      financing: string;
      maturity: string;
      source: string;
      agentNotes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
    contact: { id: string; name: string; phone: string },
  ): BuyerDto {
    return {
      id: row.id,
      contact,
      requirements: BuyerRequirementsSchema.parse(row.requirements),
      financing: row.financing,
      maturity: row.maturity,
      source: row.source,
      agentNotes: row.agentNotes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
