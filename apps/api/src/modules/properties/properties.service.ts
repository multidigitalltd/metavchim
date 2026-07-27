import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { computeReadiness, type Page, type PropertyFields } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { MatchingService } from "../matching/matching.service";
import { fieldsToColumns, rowToFields, type PropertyDto } from "./property.mapper";

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
  ) {}

  async create(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
  }): Promise<PropertyDto> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();
    const readiness = computeReadiness(input.fields, {
      hasTitle: Boolean(input.marketingTitle),
      hasDescription: Boolean(input.marketingDescription),
    });

    await this.prisma.withTenant(async (tx) => {
      await tx.property.create({
        data: {
          id,
          tenantId,
          status: "draft",
          marketingTitle: input.marketingTitle ?? null,
          marketingDescription: input.marketingDescription ?? null,
          internalNotes: input.internalNotes ?? null,
          readinessScore: readiness.score,
          ...(fieldsToColumns(input.fields) as object),
        },
      });
      await this.audit.record(tx, { action: "property.create", entityType: "property", entityId: id });
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(input.fields),
      });
      if (readiness.score >= 80) {
        await this.outbox.emit(tx, "property.ready", {
          propertyId: id,
          tenantId,
          readinessScore: readiness.score,
        });
      }
    });

    // חישוב התאמות — סינכרוני בשלב זה; יעבור לתור BullMQ עם עליית ה-Workers (docs/07 §5).
    await this.matching.recomputeForProperty(id);
    return this.getById(id);
  }

  async update(id: string, patch: Partial<PropertyFields> & {
    status?: string;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
  }): Promise<PropertyDto> {
    const tenantId = TenantContext.current().tenantId;
    const { status, marketingTitle, marketingDescription, internalNotes, ...fieldPatch } = patch;

    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");

      const mergedFields = { ...rowToFields(existing), ...fieldPatch };
      const readiness = computeReadiness(mergedFields, {
        hasTitle: Boolean(marketingTitle ?? existing.marketingTitle),
        hasDescription: Boolean(marketingDescription ?? existing.marketingDescription),
      });

      await tx.property.update({
        where: { id },
        data: {
          ...(fieldsToColumns(fieldPatch) as object),
          ...(status !== undefined ? { status } : {}),
          ...(marketingTitle !== undefined ? { marketingTitle } : {}),
          ...(marketingDescription !== undefined ? { marketingDescription } : {}),
          ...(internalNotes !== undefined ? { internalNotes } : {}),
          readinessScore: readiness.score,
        },
      });
      await this.audit.record(tx, {
        action: "property.update",
        entityType: "property",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
      await this.outbox.emit(tx, "property.updated", {
        propertyId: id,
        tenantId,
        changedFields: Object.keys(patch),
      });
    });

    await this.matching.recomputeForProperty(id);
    return this.getById(id);
  }

  async getById(id: string): Promise<PropertyDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!row) throw new NotFoundException("נכס לא נמצא");
      const fields = rowToFields(row);
      const readiness = computeReadiness(fields, {
        hasTitle: Boolean(row.marketingTitle),
        hasDescription: Boolean(row.marketingDescription),
      });
      return {
        ...fields,
        id: row.id,
        status: row.status,
        marketingTitle: row.marketingTitle ?? undefined,
        marketingDescription: row.marketingDescription ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        readinessScore: row.readinessScore,
        missingFields: readiness.missingFields,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
  }

  async list(query: { status?: string; city?: string; cursor?: string; limit: number }): Promise<Page<PropertyDto>> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.property.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.city ? { city: query.city } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" }, // ULID ממוין-זמן — חדש ראשון
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const items = rows.slice(0, query.limit).map((row) => {
        const fields = rowToFields(row);
        const readiness = computeReadiness(fields, {
          hasTitle: Boolean(row.marketingTitle),
          hasDescription: Boolean(row.marketingDescription),
        });
        return {
          ...fields,
          id: row.id,
          status: row.status,
          marketingTitle: row.marketingTitle ?? undefined,
          readinessScore: row.readinessScore,
          missingFields: readiness.missingFields,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } satisfies PropertyDto;
      });
      return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
    });
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");
      await tx.property.update({ where: { id }, data: { deletedAt: new Date(), status: "archived" } });
      await tx.match.deleteMany({ where: { propertyId: id, status: "suggested" } });
      await this.audit.record(tx, { action: "property.delete", entityType: "property", entityId: id });
    });
  }
}
