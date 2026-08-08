import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { OPEN_LEAD_STATUSES, type Page } from "@metavchim/shared";
import { assertLeadAccess, ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";
import { ContactsService } from "../contacts/contacts.service";

export interface LeadDto {
  id: string;
  contact: { id: string; name: string; phone: string };
  source: string;
  intent: string;
  status: string;
  requiresHuman: boolean;
  requiresHumanReason?: string;
  summary?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InteractionDto {
  id: string;
  kind: string;
  direction?: string;
  content: string;
  createdAt: Date;
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    contactName: string;
    contactPhone: string;
    source: string;
    intent: string;
    summary?: string;
    requiresHuman?: boolean;
    requiresHumanReason?: string;
  }): Promise<{ id: string; merged: boolean; visible: boolean }> {
    const ctx = TenantContext.current();
    const id = ulid();
    // ליד פתוח קיים לאותו איש קשר ⇒ לא מפצלים ציר זמן: הפנייה מצטרפת אליו
    let mergedInto: string | null = null;
    // המיזוג הוא כלל-משרדי, אבל הרשאת הצפייה לא — סוכן עם view_own שקלט
    // פנייה לליד של סוכן אחר לא ינווט אליו (ביקורת Codex)
    let mergedVisible = true;

    await this.prisma.withTenant(async (tx) => {
      const contact = await this.contacts.findOrCreateByPhone(tx, {
        name: input.contactName,
        phone: input.contactPhone,
      });
      // נעילה פר איש-קשר: שתי קליטות מקבילות לא יעברו שתיהן את בדיקת
      // "אין ליד פתוח" וייצרו כפילות — אין אילוץ ייחודיות בסכימה (ביקורת Codex)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-intake:${ctx.tenantId}:${contact.id}`}, 0))`;
      const open = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, contactId: contact.id, status: { in: [...OPEN_LEAD_STATUSES] } },
        select: { id: true, assignedToUserId: true },
      });
      if (open) {
        mergedInto = open.id;
        mergedVisible = ctx.capabilities.has("leads.view_all") || open.assignedToUserId === ctx.userId;
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: open.id,
            kind: "note",
            content: `פנייה נוספת נקלטה: ${input.summary?.trim() || "ללא פירוט"}`,
            createdBy: ctx.userId,
          },
        });
        // אסקלציה לא הולכת לאיבוד במיזוג: פנייה חוזרת שמסומנת "דורש
        // אדם" מדליקה את הדגל על הליד הקיים (ביקורת Codex)
        if (input.requiresHuman) {
          await tx.lead.update({
            where: { id: open.id },
            data: { requiresHuman: true, requiresHumanReason: input.requiresHumanReason ?? null },
          });
        }
        // הליד של סוכן אחר — הוא צריך לדעת שנקלטה פנייה בשמו
        if (!mergedVisible && open.assignedToUserId !== null) {
          await tx.notification.create({
            data: {
              id: ulid(),
              tenantId: ctx.tenantId,
              userId: open.assignedToUserId,
              type: "lead_repeat_inquiry",
              title: "📥 פנייה נוספת בליד שלך",
              body: `${input.contactName} פנה שוב — הפנייה נוספה לציר הזמן של הליד.`,
              entityType: "lead",
              entityId: open.id,
            },
          });
        }
        await this.audit.record(tx, {
          action: "lead.repeat_inquiry",
          entityType: "lead",
          entityId: open.id,
        });
        return;
      }
      // ליד חוזר: לאיש הקשר ליד קודם שנסגר — פנייה מחודשת היא איתות קנייה חזק
      const previous = await tx.lead.findFirst({
        where: { tenantId: ctx.tenantId, contactId: contact.id, status: { in: ["converted", "closed"] } },
        select: { id: true },
      });
      await tx.lead.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          contactId: contact.id,
          source: input.source,
          intent: input.intent,
          status: "new",
          assignedToUserId: ctx.userId,
          requiresHuman: input.requiresHuman ?? false,
          requiresHumanReason: input.requiresHumanReason ?? null,
          summary: input.summary ?? null,
        },
      });
      if (input.summary) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: id,
            kind: "note",
            content: input.summary,
            createdBy: ctx.userId,
          },
        });
      }
      if (previous) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: id,
            kind: "system",
            content: "🔁 ליד חוזר — לאיש הקשר ליד קודם שנסגר. ההיסטוריה המלאה בתיק הלקוח.",
            createdBy: ctx.userId,
          },
        });
        await tx.notification.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            type: "lead_returned",
            title: "🔁 ליד חוזר",
            body: `${input.contactName} פנה שוב אחרי שהליד הקודם נסגר — שווה עדיפות.`,
            entityType: "lead",
            entityId: id,
          },
        });
      }
      await this.audit.record(tx, { action: "lead.create", entityType: "lead", entityId: id });
      await this.outbox.emit(tx, "lead.created", {
        leadId: id,
        tenantId: ctx.tenantId,
        source: input.source,
        requiresHuman: input.requiresHuman ?? false,
      });
    });

    return { id: mergedInto ?? id, merged: mergedInto !== null, visible: mergedVisible };
  }

  async updateStatus(id: string, status: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      // הרשאה לפני הכתיבה: סוכן שאינו רואה את הליד גם אינו משנה אותו
      await assertLeadAccess(tx, ctx.tenantId, id);
      const lead = await tx.lead.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!lead) throw new NotFoundException("ליד לא נמצא");
      await tx.lead.update({
        where: { id },
        data: {
          status,
          requiresHuman: status === "new" ? lead.requiresHuman : false,
          ...(lead.firstResponseAt === null && status !== "new"
            ? { firstResponseAt: new Date() }
            : {}),
        },
      });
      await tx.interaction.create({
        data: {
          id: ulid(),
          tenantId: ctx.tenantId,
          leadId: id,
          kind: "status_change",
          content: status,
          createdBy: ctx.userId,
        },
      });
      // הליד טופל — משימת אסקלציית ה-SLA (אם נוצרה) נסגרת אוטומטית
      if (status !== "new") {
        await tx.task.updateMany({
          where: { tenantId: ctx.tenantId, sourceKey: `lead-sla:${id}`, status: "open" },
          data: { status: "done" },
        });
      }
      await this.audit.record(tx, {
        action: "lead.status",
        entityType: "lead",
        entityId: id,
        metadata: { status },
      });
    });
  }

  async addNote(id: string, content: string): Promise<InteractionDto> {
    const ctx = TenantContext.current();
    const noteId = ulid();
    await this.prisma.withTenant(async (tx) => {
      await assertLeadAccess(tx, ctx.tenantId, id);
      await tx.interaction.create({
        data: {
          id: noteId,
          tenantId: ctx.tenantId,
          leadId: id,
          kind: "note",
          content,
          createdBy: ctx.userId,
        },
      });
    });
    return { id: noteId, kind: "note", content, createdAt: new Date() };
  }

  async getById(id: string): Promise<{ lead: LeadDto; timeline: InteractionDto[] }> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const row = await tx.lead.findFirst({
        where: { id, tenantId, ...ownershipFilter("leads.view_all", "assignedToUserId") },
      });
      if (!row) throw new NotFoundException("ליד לא נמצא");
      const contact = await this.contacts.getById(tx, row.contactId);
      if (!contact) throw new NotFoundException("איש קשר לא נמצא");
      const interactions = await tx.interaction.findMany({
        where: { tenantId, leadId: id },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return {
        lead: toLeadDto(row, contact),
        timeline: interactions.map((i) => ({
          id: i.id,
          kind: i.kind,
          direction: i.direction ?? undefined,
          content: i.content,
          createdAt: i.createdAt,
        })),
      };
    });
  }

  async list(query: {
    status?: string;
    requiresHuman?: boolean;
    cursor?: string;
    limit: number;
  }): Promise<Page<LeadDto>> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const rows = await tx.lead.findMany({
        where: {
          tenantId,
          ...ownershipFilter("leads.view_all", "assignedToUserId"),
          ...(query.status ? { status: query.status } : {}),
          ...(query.requiresHuman !== undefined ? { requiresHuman: query.requiresHuman } : {}),
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: "desc" },
        take: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const items: LeadDto[] = [];
      for (const row of page) {
        const contact = await this.contacts.getById(tx, row.contactId);
        if (contact) items.push(toLeadDto(row, contact));
      }
      return { items, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
    });
  }
}

function toLeadDto(
  row: {
    id: string;
    source: string;
    intent: string;
    status: string;
    requiresHuman: boolean;
    requiresHumanReason: string | null;
    summary: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  contact: { id: string; name: string; phone: string },
): LeadDto {
  return {
    id: row.id,
    contact,
    source: row.source,
    intent: row.intent,
    status: row.status,
    requiresHuman: row.requiresHuman,
    requiresHumanReason: row.requiresHumanReason ?? undefined,
    summary: row.summary ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
