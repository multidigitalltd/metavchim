import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { OutboxService } from "../../core/outbox.service";
import { PrismaService } from "../../core/prisma.service";

export interface AppointmentDto {
  id: string;
  kind: string;
  title?: string;
  leadId?: string;
  propertyId?: string;
  buyerId?: string;
  startsAt: Date;
  endsAt?: Date;
  status: string;
  outcome?: string;
  notes?: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  liked: "אהב את הנכס",
  not_fit: "לא מתאים",
  negotiating: 'עוברים למו"מ',
  needs_other: "צריך נכס אחר",
};

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: {
    kind: string;
    title?: string;
    leadId?: string;
    propertyId?: string;
    buyerId?: string;
    startsAt: Date;
    durationMinutes: number;
    notes?: string;
  }): Promise<AppointmentDto> {
    const ctx = TenantContext.current();
    const id = ulid();
    const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

    await this.prisma.withTenant(async (tx) => {
      // קישורים חייבים להיות ישויות של הדייר — ידיעת ID אינה הרשאה
      if (input.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: input.leadId, tenantId: ctx.tenantId },
          select: { id: true },
        });
        if (!lead) throw new NotFoundException("ליד לא נמצא");
      }
      if (input.propertyId) {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!property) throw new NotFoundException("נכס לא נמצא");
      }
      if (input.buyerId) {
        const buyer = await tx.buyer.findFirst({
          where: { id: input.buyerId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!buyer) throw new NotFoundException("קונה לא נמצא");
      }

      await tx.appointment.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          kind: input.kind,
          title: input.title ?? null,
          leadId: input.leadId ?? null,
          propertyId: input.propertyId ?? null,
          buyerId: input.buyerId ?? null,
          startsAt: input.startsAt,
          endsAt,
          notes: input.notes ?? null,
          /*
           * יומן של מי. `createdBy` הוא "מי הקליד" ואינו אותו דבר:
           * מנהל שקובע סיור לסוכן צריך שהאירוע יופיע ביומן של הסוכן.
           * כרגע הם זהים — השדה קיים כדי שהעברת בעלות תהיה שינוי
           * ערך ולא שינוי מודל.
           */
          ownerUserId: ctx.userId,
          createdBy: ctx.userId,
        },
      });
      if (input.leadId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: input.leadId,
            kind: "system",
            content: `נקבעה פגישה (${input.kind}) ל-${input.startsAt.toISOString()}`,
            createdBy: ctx.userId,
          },
        });
      }
      await this.audit.record(tx, {
        action: "appointment.create",
        entityType: "appointment",
        entityId: id,
      });
      await this.outbox.emit(tx, "appointment.scheduled", {
        appointmentId: id,
        tenantId: ctx.tenantId,
        startsAt: input.startsAt,
        kind: input.kind,
        endsAt: new Date(input.startsAt.getTime() + input.durationMinutes * 60_000),
      });
    });

    return this.getById(id);
  }

  /** עדכון סטטוס/תוצאה — פולו-אפ "איך היה הסיור?" (אפיון §13). */
  async update(
    id: string,
    patch: { status?: string; outcome?: string; notes?: string },
  ): Promise<AppointmentDto> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.appointment.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!existing) throw new NotFoundException("פגישה לא נמצאה");

      // תוצאות הסיור (אהב/לא מתאים...) הן ספציפיות לנכס — רק לסוג viewing
      if (patch.outcome && existing.kind !== "viewing") {
        throw new BadRequestException("תוצאת סיור זמינה רק לפגישות מסוג סיור בנכס");
      }

      await tx.appointment.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.outcome !== undefined ? { outcome: patch.outcome, status: "completed" } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          /*
           * איפוס חותמת הסנכרון = "צריך דחיפה מחדש".
           *
           * זו הדרך שבה סורק היומן יודע שהשורה השתנתה. ההשוואה
           * החלופית — googleSyncedAt מול updatedAt — נשמעת מדויקת
           * יותר וברירה: כל כתיבה שולית מזיזה את updatedAt, כולל זו
           * של הדחיפה עצמה, וייצרה דחיפה נצחית.
           */
          googleSyncedAt: null,
        },
      });

      // תוצאת סיור מתועדת בציר הזמן של הליד ושל הקונה — ההיסטוריה במקום אחד
      if (patch.outcome && existing.leadId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            leadId: existing.leadId,
            kind: "system",
            content: `סיכום פגישה: ${OUTCOME_LABELS[patch.outcome] ?? patch.outcome}`,
            createdBy: ctx.userId,
          },
        });
      }
      if (patch.outcome && existing.buyerId) {
        await tx.interaction.create({
          data: {
            id: ulid(),
            tenantId: ctx.tenantId,
            buyerId: existing.buyerId,
            kind: "system",
            content: `סיכום סיור: ${OUTCOME_LABELS[patch.outcome] ?? patch.outcome}`,
            createdBy: ctx.userId,
          },
        });
      }
      // סיכום הסיור — או ביטולו — סוגר את משימת הפולו-אפ אוטומטית;
      // אין טעם לרדוף אחרי "איך היה?" על סיור שלא התקיים
      if (patch.outcome || patch.status === "cancelled" || patch.status === "no_show") {
        await tx.task.updateMany({
          where: { tenantId: ctx.tenantId, sourceKey: `viewing:${id}`, status: "open" },
          data: { status: "done" },
        });
      }
      await this.audit.record(tx, {
        action: "appointment.update",
        entityType: "appointment",
        entityId: id,
        metadata: { changedFields: Object.keys(patch) },
      });
    });
    return this.getById(id);
  }

  async getById(id: string): Promise<AppointmentDto> {
    return this.prisma.withTenant(async (tx) => {
      const row = await tx.appointment.findFirst({
        where: { id, tenantId: TenantContext.current().tenantId },
      });
      if (!row) throw new NotFoundException("פגישה לא נמצאה");
      return toDto(row);
    });
  }

  async list(query: { from: Date; to: Date }): Promise<AppointmentDto[]> {
    return this.prisma.withTenant(async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          tenantId: TenantContext.current().tenantId,
          startsAt: { gte: query.from, lte: query.to },
        },
        orderBy: { startsAt: "asc" },
        take: 200,
      });
      return rows.map(toDto);
    });
  }
}

function toDto(row: {
  id: string;
  kind: string;
  title: string | null;
  leadId: string | null;
  propertyId: string | null;
  buyerId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  status: string;
  outcome: string | null;
  notes: string | null;
}): AppointmentDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? undefined,
    leadId: row.leadId ?? undefined,
    propertyId: row.propertyId ?? undefined,
    buyerId: row.buyerId ?? undefined,
    startsAt: row.startsAt,
    endsAt: row.endsAt ?? undefined,
    status: row.status,
    outcome: row.outcome ?? undefined,
    notes: row.notes ?? undefined,
  };
}
