import { Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * משימות ותזכורות (docs/01 — מודול 7): רשימת "לעשות" אישית — כל סוכן
 * רואה ומנהל את המשימות שלו בלבד (assignedToUserId = המשתמש הנוכחי).
 * משימה עם מועד יעד רושמת אירוע Outbox שמתוזמן כתזכורת בצינור ההתראות.
 */

export interface TaskDto {
  id: string;
  title: string;
  notes?: string;
  dueAt?: Date;
  status: string;
  entityType?: string;
  entityId?: string;
  createdAt: Date;
}

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date | null;
  status: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    dueAt: row.dueAt ?? undefined,
    status: row.status,
    entityType: row.entityType ?? undefined,
    entityId: row.entityId ?? undefined,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    title: string;
    notes?: string;
    dueAt?: Date;
    entityType?: string;
    entityId?: string;
  }): Promise<TaskDto> {
    const ctx = TenantContext.current();
    const id = ulid();

    const row = await this.prisma.withTenant(async (tx) => {
      const created = await tx.task.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          assignedToUserId: ctx.userId,
          title: input.title,
          notes: input.notes ?? null,
          dueAt: input.dueAt ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        },
      });
      await this.audit.record(tx, { action: "task.create", entityType: "task", entityId: id });
      if (input.dueAt && input.dueAt.getTime() > Date.now()) {
        await this.outbox.emit(tx, "task.created", {
          taskId: id,
          tenantId: ctx.tenantId,
          assignedToUserId: ctx.userId,
          title: input.title,
          dueAt: input.dueAt,
        });
      }
      return created;
    });
    return toDto(row);
  }

  /**
   * רשימת המשימות של המשתמש הנוכחי בלבד — הפתוחות (עד 200, לפי מועד)
   * ואחריהן האחרונות שבוצעו (עד 50). שתי שאילתות נפרדות כדי שהמגבלה
   * לעולם לא תדחוק משימות פתוחות החוצה (ביקורת Codex, PR #13).
   */
  async list(status?: string): Promise<TaskDto[]> {
    const ctx = TenantContext.current();
    const base = { tenantId: ctx.tenantId, assignedToUserId: ctx.userId };
    const rows = await this.prisma.withTenant(async (tx) => {
      if (status) {
        return tx.task.findMany({
          where: { ...base, status },
          orderBy: { dueAt: { sort: "asc", nulls: "last" } },
          take: 200,
        });
      }
      const [open, done] = await Promise.all([
        tx.task.findMany({
          where: { ...base, status: "open" },
          orderBy: { dueAt: { sort: "asc", nulls: "last" } },
          take: 200,
        }),
        tx.task.findMany({
          where: { ...base, status: "done" },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
      ]);
      return [...open, ...done];
    });
    return rows.map(toDto);
  }

  async update(
    id: string,
    patch: { title?: string; notes?: string; dueAt?: Date | null; status?: string },
  ): Promise<TaskDto> {
    const ctx = TenantContext.current();
    const row = await this.prisma.withTenant(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id, tenantId: ctx.tenantId, assignedToUserId: ctx.userId },
      });
      if (!existing) throw new NotFoundException("משימה לא נמצאה");

      const updated = await tx.task.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
      });
      await this.audit.record(tx, { action: "task.update", entityType: "task", entityId: id });

      // מועד חדש בעתיד למשימה פתוחה — תזכורת חדשה; הישנה תדולג בזמן ריצה
      // (ה-Worker משווה את מועד הירי ל-dueAt הנוכחי).
      const dueChanged =
        patch.dueAt instanceof Date && patch.dueAt.getTime() !== existing.dueAt?.getTime();
      if (dueChanged && patch.dueAt && patch.dueAt.getTime() > Date.now() && updated.status === "open") {
        await this.outbox.emit(tx, "task.created", {
          taskId: id,
          tenantId: ctx.tenantId,
          assignedToUserId: ctx.userId,
          title: updated.title,
          dueAt: patch.dueAt,
        });
      }
      return updated;
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id, tenantId: ctx.tenantId, assignedToUserId: ctx.userId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("משימה לא נמצאה");
      await tx.task.delete({ where: { id } });
      await this.audit.record(tx, { action: "task.delete", entityType: "task", entityId: id });
    });
  }
}
