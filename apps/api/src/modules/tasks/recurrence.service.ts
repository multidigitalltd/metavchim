import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  describeRecurrence,
  nextOccurrence,
  recurrenceRejectionReason,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * כללי המשימות האוטומטיות של המשרד.
 *
 * הכלל שייך למשרד והמשימות שנוצרות ממנו שייכות לסוכן — ולכן ניהול
 * הכללים דורש `settings.manage`, בעוד המשימה עצמה נשארת אישית כמו כל
 * משימה אחרת.
 *
 * היצירה בפועל רצה מה-Worker (`recurring-tasks` בסורק הכללי), ולא
 * כאן: זו עבודה מתוזמנת שצריכה לרוץ גם כשאיש לא פתח את המערכת.
 */

export interface RecurrenceDto {
  id: string;
  title: string;
  notes?: string;
  frequency: RecurrenceFrequency;
  weekdays: number[];
  dayOfMonth?: number;
  hour: number;
  minute: number;
  assignedToUserId?: string;
  isActive: boolean;
  lastRunAt?: Date;
  /** תיאור בעברית — כדי שהמסך לא יפענח שדות בעצמו. */
  description: string;
  /** מתי המופע הבא, לפי המצב הנוכחי; null כשהכלל כבוי. */
  nextRunAt: Date | null;
}

export interface RecurrenceInput {
  title: string;
  notes?: string;
  frequency: RecurrenceFrequency;
  weekdays?: number[];
  dayOfMonth?: number;
  hour: number;
  minute: number;
  assignedToUserId?: string | null;
  isActive?: boolean;
}

interface RecurrenceRow {
  id: string;
  title: string;
  notes: string | null;
  frequency: string;
  weekdays: number[];
  dayOfMonth: number | null;
  hour: number;
  minute: number;
  assignedToUserId: string | null;
  isActive: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
}

export function ruleOf(row: {
  frequency: string;
  weekdays: number[];
  dayOfMonth: number | null;
  hour: number;
  minute: number;
}): RecurrenceRule {
  return {
    frequency: row.frequency as RecurrenceFrequency,
    weekdays: row.weekdays,
    ...(row.dayOfMonth !== null ? { dayOfMonth: row.dayOfMonth } : {}),
    hour: row.hour,
    minute: row.minute,
  };
}

function toDto(row: RecurrenceRow): RecurrenceDto {
  const rule = ruleOf(row);
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    frequency: rule.frequency,
    weekdays: row.weekdays,
    ...(row.dayOfMonth !== null ? { dayOfMonth: row.dayOfMonth } : {}),
    hour: row.hour,
    minute: row.minute,
    assignedToUserId: row.assignedToUserId ?? undefined,
    isActive: row.isActive,
    lastRunAt: row.lastRunAt ?? undefined,
    description: describeRecurrence(rule),
    /*
     * המופע הבא נמדד מהריצה האחרונה, ובכלל חדש — מרגע היצירה.
     * זו אותה נקודת ייחוס שהסורק משתמש בה, כדי שמה שהמסך מבטיח יהיה
     * מה שבאמת יקרה.
     */
    nextRunAt: row.isActive ? nextOccurrence(rule, row.lastRunAt ?? row.createdAt) : null,
  };
}

@Injectable()
export class RecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RecurrenceDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.taskRecurrence.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } }),
    );
    return rows.map(toDto);
  }

  async create(input: RecurrenceInput): Promise<RecurrenceDto> {
    const { tenantId, userId } = TenantContext.current();
    this.assertValid(input);
    const id = ulid();
    const row = await this.prisma.withTenant(async (tx) => {
      await this.assertAssigneeInTenant(tenantId, input.assignedToUserId);
      const created = await tx.taskRecurrence.create({
        data: {
          id,
          tenantId,
          ...this.columns(input),
          createdBy: userId,
        },
      });
      await this.audit.record(tx, {
        action: "task_recurrence.create",
        entityType: "task_recurrence",
        entityId: id,
        metadata: { title: input.title, frequency: input.frequency },
      });
      return created;
    });
    return toDto(row);
  }

  async update(id: string, input: RecurrenceInput): Promise<RecurrenceDto> {
    const tenantId = TenantContext.current().tenantId;
    this.assertValid(input);
    const row = await this.prisma.withTenant(async (tx) => {
      const existing = await tx.taskRecurrence.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException("הכלל לא נמצא");
      await this.assertAssigneeInTenant(tenantId, input.assignedToUserId);
      const updated = await tx.taskRecurrence.update({
        where: { id },
        data: this.columns(input),
      });
      await this.audit.record(tx, {
        action: "task_recurrence.update",
        entityType: "task_recurrence",
        entityId: id,
        metadata: { title: input.title },
      });
      return updated;
    });
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const existing = await tx.taskRecurrence.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException("הכלל לא נמצא");
      /*
       * מחיקת הכלל אינה נוגעת במשימות שכבר נוצרו ממנו.
       * הן כבר על שולחן העבודה של הסוכן, ולפעמים כבר בוצעו בחלקן —
       * מחיקה רטרואקטיבית הייתה מוחקת עבודה אמיתית.
       */
      await tx.taskRecurrence.delete({ where: { id } });
      await this.audit.record(tx, {
        action: "task_recurrence.delete",
        entityType: "task_recurrence",
        entityId: id,
        metadata: { title: existing.title },
      });
    });
  }

  private assertValid(input: RecurrenceInput): void {
    const reason = recurrenceRejectionReason({
      frequency: input.frequency,
      weekdays: input.weekdays,
      ...(input.dayOfMonth !== undefined ? { dayOfMonth: input.dayOfMonth } : {}),
      hour: input.hour,
      minute: input.minute,
    });
    if (reason !== null) throw new BadRequestException(reason);
  }

  /**
   * הסוכן שהוקצה חייב להיות במשרד הזה.
   *
   * המזהה מגיע מהבקשה, והטבלה users מחוץ ל-RLS — בלי הבדיקה אפשר
   * היה לשייך כלל של משרד אחד לסוכן של משרד אחר, ולייצר לו משימות.
   */
  private async assertAssigneeInTenant(
    tenantId: string,
    userId: string | null | undefined,
  ): Promise<void> {
    if (!userId) return;
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException("הסוכן שנבחר אינו במשרד");
  }

  private columns(input: RecurrenceInput): {
    title: string;
    notes: string | null;
    frequency: string;
    weekdays: number[];
    dayOfMonth: number | null;
    hour: number;
    minute: number;
    assignedToUserId: string | null;
    isActive: boolean;
  } {
    return {
      title: input.title.trim(),
      notes: input.notes?.trim() || null,
      frequency: input.frequency,
      // ימי שבוע רק לכלל שבועי — שאריות משינוי תדירות היו מבלבלות
      // גם את המסך וגם את החישוב
      weekdays: input.frequency === "weekly" ? [...new Set(input.weekdays ?? [])].sort() : [],
      dayOfMonth: input.frequency === "monthly" ? (input.dayOfMonth ?? null) : null,
      hour: input.hour,
      minute: input.minute,
      assignedToUserId: input.assignedToUserId ?? null,
      isActive: input.isActive ?? true,
    };
  }
}
