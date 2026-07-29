import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { computeReadiness, type Page, type PropertyFields } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";
import { MatchingService } from "../matching/matching.service";
import { fieldsToColumns, rowToFields, type PropertyDto } from "./property.mapper";

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly matching: MatchingService,
    private readonly contacts: ContactsService,
  ) {}

  async create(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    /** בעל הנכס (המוכר) — נקשר כ-contact לפי טלפון (docs/03: אדם אחד) */
    owner?: { name: string; phone: string };
  }): Promise<PropertyDto> {
    const id = await this.persist(input);
    // חישוב התאמות — סינכרוני בשלב זה; יעבור לתור BullMQ עם עליית ה-Workers (docs/07 §5).
    await this.matching.recomputeForProperty(id);
    return this.getById(id);
  }

  /**
   * ייבוא בכמות (docs/08 §6): ההצלחה נקבעת בגבול הטרנזקציה — ברגע שהנכס
   * נשמר הוא "נוצר", גם אם חישוב ההתאמות שאחריו נכשל זמנית (best-effort;
   * יחושב מחדש בעריכה הבאה). כך אין דיווח-כזב של נכס שכבר קיים ואין כפילויות
   * בניסיון חוזר. גם חוסך N חישובי-התאמה סינכרוניים בבקשה אחת (docs/07 §5).
   */
  async createForImport(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    /** שימור סטטוס בייבוא-חזרה של קובץ מיוצא (Round-trip); ברירת מחדל: טיוטה. */
    status?: string;
  }): Promise<string> {
    const id = await this.persist(input);
    try {
      await this.matching.recomputeForProperty(id);
    } catch {
      // הנכס כבר נשמר; חישוב ההתאמות אינו חלק מהצלחת היצירה.
    }
    return id;
  }

  /** יוצר את רשומת הנכס בטרנזקציה יחידה ומחזיר את המזהה — גבול ההצלחה. */
  private async persist(input: {
    fields: PropertyFields;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    status?: string;
    owner?: { name: string; phone: string };
  }): Promise<string> {
    const tenantId = TenantContext.current().tenantId;
    const id = ulid();
    const readiness = computeReadiness(input.fields, {
      hasTitle: Boolean(input.marketingTitle),
      hasDescription: Boolean(input.marketingDescription),
    });

    await this.prisma.withTenant(async (tx) => {
      const ownerContact = input.owner
        ? await this.contacts.findOrCreateByPhone(tx, input.owner)
        : null;
      await tx.property.create({
        data: {
          id,
          tenantId,
          ownerContactId: ownerContact?.id ?? null,
          status: input.status ?? "draft",
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

    return id;
  }

  async update(id: string, patch: Partial<PropertyFields> & {
    status?: string;
    marketingTitle?: string;
    marketingDescription?: string;
    internalNotes?: string;
    owner?: { name: string; phone: string };
  }): Promise<PropertyDto> {
    const tenantId = TenantContext.current().tenantId;
    const { status, marketingTitle, marketingDescription, internalNotes, owner, ...fieldPatch } =
      patch;

    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.property.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException("נכס לא נמצא");

      const ownerContact = owner ? await this.contacts.findOrCreateByPhone(tx, owner) : null;
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
          ...(ownerContact ? { ownerContactId: ownerContact.id } : {}),
          readinessScore: readiness.score,
        },
      });
      // נכס שיצא משיווק — ההתאמות המוצעות מתבטלות; אין להציע נכס שנמכר
      // (ביקורת Codex, PR #1). החלטות ידניות (offered/dismissed) נשמרות כהיסטוריה.
      if (status !== undefined && !["draft", "active"].includes(status)) {
        await tx.match.deleteMany({ where: { propertyId: id, status: "suggested" } });
        // מעבר אמיתי החוצה משיווק — סגירת מעגל מול קונים מעוניינים:
        // Worker יוצר משימות "הצע חלופה" לסוכנים (docs/01 — שום עסקה
        // לא נופלת בין הכיסאות)
        if (["draft", "active"].includes(existing.status)) {
          await this.outbox.emit(tx, "property.delisted", {
            propertyId: id,
            tenantId,
            newStatus: status,
          });
        }
      }
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
      const ownerContact = row.ownerContactId
        ? await this.contacts.getById(tx, row.ownerContactId)
        : null;
      return {
        ...fields,
        id: row.id,
        status: row.status,
        marketingTitle: row.marketingTitle ?? undefined,
        marketingDescription: row.marketingDescription ?? undefined,
        internalNotes: row.internalNotes ?? undefined,
        readinessScore: row.readinessScore,
        missingFields: readiness.missingFields,
        ...(ownerContact
          ? { ownerContact: { id: ownerContact.id, name: ownerContact.name, phone: ownerContact.phone } }
          : {}),
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
      // גם מחיקה רכה היא ירידה משיווק — קונים מעוניינים מקבלים משימת
      // חלופה בדיוק כמו במכירה (ביקורת Codex, PR #21)
      if (["draft", "active"].includes(existing.status)) {
        await this.outbox.emit(tx, "property.delisted", {
          propertyId: id,
          tenantId: TenantContext.current().tenantId,
          newStatus: "archived",
        });
      }
      await this.audit.record(tx, { action: "property.delete", entityType: "property", entityId: id });
    });
  }
}
