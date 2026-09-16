import { Injectable, NotFoundException } from "@nestjs/common";
import {
  PROPERTY_CHECKS,
  propertyChecksProgress,
  propertyCheckTaskSourceKey,
  propertyCheckTaskTitle,
  type PropertyCheckKey,
  type PropertyChecksProgress,
  type PropertyCheckStatus,
  type PropertyCheckUpdate,
} from "@metavchim/shared";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import { TasksService, type TaskDto } from "../tasks/tasks.service";

/**
 * תיק הבדיקות של הנכס (docs/03 — property_checks).
 *
 * הרשימה סגורה בחבילה המשותפת; כאן רק **המצב** של כל בדיקה. הקריאה
 * ממזגת את הרשימה עם השורות שסומנו, כך שנכס חדש מציג אחת-עשרה
 * בדיקות „לא נבדק” בלי שורה אחת במסד. הכתיבה היא upsert על
 * ‎(נכס, בדיקה) — סימון חוזר מעדכן, ורושם מי ומתי.
 *
 * ## הגשר למשימות
 *
 * בדיקה שטרם נעשתה הופכת למשימה דרך `TasksService` — אותו שירות
 * שהמסך והסוכן משתמשים בו — עם `sourceKey` לפי הבדיקה. שני סוכנים
 * שלוחצים על אותה בדיקה מקבלים משימה אחת, לא שתיים.
 */

export interface PropertyCheckDto {
  key: PropertyCheckKey;
  title: string;
  why: string;
  href: string | null;
  status: PropertyCheckStatus;
  note: string | null;
  checkedAt: Date | null;
  /** שם מי שסימן לאחרונה — או `null` כשטרם סומן או שהמשתמש נמחק */
  checkedBy: string | null;
}

export interface PropertyChecksDto {
  items: PropertyCheckDto[];
  progress: PropertyChecksProgress;
}

@Injectable()
export class PropertyChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tasks: TasksService,
  ) {}

  async list(propertyId: string): Promise<PropertyChecksDto> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant(async (tx) => {
      await PropertyChecksService.assertProperty(tx, tenantId, propertyId);
      return tx.propertyCheck.findMany({ where: { tenantId, propertyId } });
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const userIds = [...new Set(rows.map((row) => row.checkedByUserId).filter((id): id is string => id !== null))];
    const users =
      userIds.length === 0
        ? []
        : await this.prisma.withTenant((tx) => tx.user.findMany({ where: { id: { in: userIds }, tenantId }, select: { id: true, name: true } }));
    const names = new Map(users.map((user) => [user.id, user.name]));

    const items: PropertyCheckDto[] = PROPERTY_CHECKS.map((def) => {
      const row = byKey.get(def.key);
      return {
        key: def.key,
        title: def.title,
        why: def.why,
        href: def.href,
        status: (row?.status as PropertyCheckStatus | undefined) ?? "unchecked",
        note: row?.note ?? null,
        checkedAt: row?.checkedAt ?? null,
        checkedBy: row?.checkedByUserId === null || row === undefined ? null : (names.get(row.checkedByUserId) ?? null),
      };
    });
    return { items, progress: propertyChecksProgress(items) };
  }

  async update(propertyId: string, key: PropertyCheckKey, input: PropertyCheckUpdate): Promise<PropertyChecksDto> {
    const { tenantId, userId } = TenantContext.current();
    const note = input.note === undefined || input.note === "" ? null : input.note;
    await this.prisma.withTenant(async (tx) => {
      await PropertyChecksService.assertProperty(tx, tenantId, propertyId);
      // „לא נבדק” מאפס את החותמת: אין מי שאמר שזה תקין
      const stamp = input.status === "unchecked" ? { checkedByUserId: null, checkedAt: null } : { checkedByUserId: userId, checkedAt: new Date() };
      await tx.propertyCheck.upsert({
        where: { tenantId_propertyId_key: { tenantId, propertyId, key } },
        create: { id: ulid(), tenantId, propertyId, key, status: input.status, note, ...stamp },
        update: { status: input.status, note, ...stamp },
      });
      await this.audit.record(tx, {
        action: "property.check_updated",
        entityType: "property",
        entityId: propertyId,
        metadata: { key, status: input.status },
      });
    });
    return this.list(propertyId);
  }

  /**
   * בדיקה שטרם נעשתה ⟵ משימה על הנכס, פעם אחת.
   *
   * ‎**הנעילה כאן, לא ב-`TasksService`.** הדדופ שם הוא „קרא ואז
   * כתוב” תחת READ COMMITTED, ושני סוכנים שלוחצים באותה שנייה
   * עוברים שניהם את הקריאה (ביקורת Codex). נעילת advisory על
   * ‏(משרד, נכס, בדיקה) מסדרת אותם בתור: השני נכנס אחרי שהראשון
   * כבר כתב, ורואה את המשימה הקיימת. הנעילה מוחזקת עד סוף
   * הטרנזקציה החיצונית, כלומר גם לאורך הכתיבה הפנימית.
   */
  async toTask(propertyId: string, key: PropertyCheckKey): Promise<TaskDto> {
    const tenantId = TenantContext.current().tenantId;
    return this.prisma.withTenant(async (tx) => {
      await PropertyChecksService.assertProperty(tx, tenantId, propertyId);
      const lockKey = `property-check-task:${tenantId}:${propertyId}:${key}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return this.tasks.create({
        title: propertyCheckTaskTitle(key),
        entityType: "property",
        entityId: propertyId,
        sourceKey: propertyCheckTaskSourceKey(key),
      });
    });
  }

  private static async assertProperty(tx: TenantTx, tenantId: string, propertyId: string): Promise<void> {
    const property = await tx.property.findFirst({ where: { id: propertyId, tenantId, deletedAt: null }, select: { id: true } });
    if (!property) throw new NotFoundException("נכס לא נמצא");
  }
}
