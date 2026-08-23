import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ulid } from "ulid";
import {
  describeRecurrence,
  nextOccurrenceUtc,
  recurrenceRejectionReason,
  toJerusalemWall,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { AutomationQuotaService } from "../../core/automation-quota.service";
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

function ruleOf(row: {
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
     *
     * `nextOccurrenceUtc` ולא `nextOccurrence`: זו אותה פונקציה
     * בדיוק שהסורק מריץ, כולל התרגום משעון ישראל. הגרסה הטהורה
     * מדברת שעון-קיר, ותהליך ה-API רץ ב-UTC — כלומר כלל של 09:00
     * היה מוצג כ-12:00 בדיוק בזמן שהסורק מריץ אותו ב-09:00
     * (ביקורת Codex).
     */
    nextRunAt: row.isActive ? nextOccurrenceUtc(rule, row.lastRunAt ?? row.createdAt) : null,
  };
}

@Injectable()
export class RecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: AutomationQuotaService,
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
      /*
       * אותה מכסה בדיוק של הכללים שהמשרד בונה — מונה אחד לשני
       * הסוגים — ובתוך הטרנזקציה שיוצרת, עם נעילה לפי המשרד. כך
       * כלל ומשימה קבועה שנוצרים בו-זמנית מסתדרים בתור במקום
       * לעבור שניהם.
       */
      await this.quota.assertCanAddWithin(tx, tenantId);
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
        data: this.columns(input, existing),
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

  /**
   * השהיה והפעלה מחדש — נתיב נפרד ולא עריכה מלאה.
   *
   * שתי סיבות, ושתיהן התגלו בביקורת:
   *
   * 1. `update` הוא **החלפה** של כל השדות. מסך שרצה רק להשהות ושלח
   *    את שאר השדות "כמו שהם" היה מאבד את `assignedToUserId` —
   *    כלומר כלל של סוכן אחד היה הופך בשקט לכלל של כל המשרד.
   *
   * 2. **הפעלה מחדש מאפסת את נקודת הייחוס.** כלל שהושהה לחודש
   *    שומר `lastRunAt` ישן, והסורק היה רואה את כל המופעים שהוחמצו
   *    כמאחרים — ויוצר אותם אחד-אחד בסריקות הבאות, כלומר מציף את
   *    הסוכנים במשימות מהעבר. השהיה אינה מוחקת את ההיסטוריה
   *    (`lastRunAt` נשמר כמות שהוא), ורק ההפעלה מקדמת אותה.
   */
  async setActive(id: string, isActive: boolean): Promise<RecurrenceDto> {
    const tenantId = TenantContext.current().tenantId;
    const row = await this.prisma.withTenant(async (tx) => {
      const existing = await tx.taskRecurrence.findFirst({ where: { id, tenantId } });
      if (!existing) throw new NotFoundException("הכלל לא נמצא");
      const updated = await tx.taskRecurrence.update({
        where: { id },
        data: {
          isActive,
          ...(isActive && !existing.isActive ? { lastRunAt: new Date() } : {}),
        },
      });
      await this.audit.record(tx, {
        action: isActive ? "task_recurrence.activate" : "task_recurrence.pause",
        entityType: "task_recurrence",
        entityId: id,
        metadata: { title: existing.title },
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

  /** ימי השבוע לשמירה — ריק נופל לקיים, ואם אין — ליום הנוכחי. */
  private weekdayAnchor(sent: number[] | undefined, existing: number[] | undefined): number[] {
    const chosen = [...new Set(sent ?? [])].sort();
    if (chosen.length > 0) return chosen;
    if (existing && existing.length > 0) return existing;
    return [toJerusalemWall(new Date()).getDay()];
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

  /**
   * העמודות לשמירה.
   *
   * `existing` מועבר בעדכון, וקיים כדי שעוגן שלא נשלח יישמר ולא
   * יחושב מחדש: PATCH שמשנה רק כותרת היה מזיז את כל המופעים העתידיים
   * ליום העריכה (ביקורת Codex).
   */
  private columns(
    input: RecurrenceInput,
    existing?: { dayOfMonth: number | null; weekdays: number[]; isActive: boolean },
  ): {
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
      /*
       * **כל עוגן נשמר במפורש ולעולם לא נגזר ממצב משתנה.**
       *
       * זו הייתה מחלקת התקלות של הכלל הזה: `nextOccurrence` יודע
       * לגזור יום בחודש או יום בשבוע מנקודת הייחוס כשהם חסרים, אבל
       * נקודת הייחוס זזה — בהפעלה מחדש, אחרי כל מופע, ובכל עריכה.
       * התוצאה הייתה כלל נודד: 31 בינואר שנתקע על ה-28, וכלל שבועי
       * שעבר ליום שבו הופעל מחדש (ביקורת Codex).
       *
       * לכן: יום בחודש נשמר תמיד לכלל חודשי, ויום בשבוע נשמר תמיד
       * לכלל שבועי. `existing` גובר על ברירת המחדל, כדי ש-PATCH
       * שמשנה רק כותרת לא יזיז את הלוח.
       */
      weekdays:
        input.frequency === "weekly"
          ? this.weekdayAnchor(input.weekdays, existing?.weekdays)
          : [],
      dayOfMonth:
        input.frequency === "monthly"
          ? (input.dayOfMonth ??
            existing?.dayOfMonth ??
            toJerusalemWall(new Date()).getDate())
          : null,
      hour: input.hour,
      minute: input.minute,
      assignedToUserId: input.assignedToUserId ?? null,
      /*
       * עריכה לעולם לא משנה את מצב ההפעלה.
       *
       * הפעלה עוברת דרך `PATCH /:id/active` בלבד, כי רק שם נקודת
       * הייחוס מתאפסת — בלעדיה כלל שהושהה לחודש היה מייצר את כל
       * המופעים שהוחמצו (ביקורת Codex). הכלל נוצר פעיל, ומשם רק
       * הנתיב הייעודי נוגע בשדה.
       */
      isActive: existing?.isActive ?? true,
    };
  }
}
