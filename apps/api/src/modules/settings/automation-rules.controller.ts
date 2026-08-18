import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AUTOMATION_TRIGGERS,
  AutomationRuleInputSchema,
  ruleRejectionReason,
  type AutomationRuleInput,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { AutomationQuotaService } from "../../core/automation-quota.service";
import { PrismaService } from "../../core/prisma.service";

/**
 * אוטומציות שהמשרד בונה בעצמו.
 *
 * `settings.manage` ולא יכולת חדשה: אוטומציה פותחת משימות לסוכנים
 * ושולחת התראות בשם המשרד, כלומר היא הגדרה משרדית — אותה רמה בדיוק
 * של חסימת מודול או משקלי התאמה. יכולת נפרדת הייתה מרמזת שמדובר
 * בפעולה יומיומית של סוכן, וזה לא המקרה.
 */

const IdSchema = z.string().length(26);

/*
 * שער המסלול על כל הסעיף. בעל הפלטפורמה מחליט אילו מסלולים כוללים
 * בניית אוטומציות, ומשרד שאין לו את התכונה אינו רואה את המסך ואינו
 * מגיע לנתיבים — כולל קריאה, כדי שלא יראה כללים שהוא אינו יכול
 * לנהל.
 */
@RequireFeature("automations")
@Controller("settings/automation-rules")
export class AutomationRulesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly quota: AutomationQuotaService,
  ) {}

  /**
   * הקטלוג **ורשימת הכללים יחד**.
   *
   * המסך צריך את שניהם כדי לצייר שורה אחת (תווית הטריגר, תווית
   * השדה), ושתי קריאות היו מייצרות מצב ביניים שבו הכללים הגיעו
   * והקטלוג לא — כלומר רשימה של מפתחות באנגלית.
   */
  @Get()
  @RequireCapability("settings.manage")
  async list(): Promise<{
    triggers: typeof AUTOMATION_TRIGGERS;
    rules: {
      id: string;
      name: string;
      enabled: boolean;
      trigger: string;
      conditions: unknown;
      action: unknown;
      createdAt: Date;
    }[];
    /** הסוכנים שאפשר להטיל עליהם — פעילים בלבד. */
    users: { id: string; name: string }[];
    /** המכסה של המסלול והשימוש בפועל — כולל המשימות הקבועות. */
    quota: { used: number; limit: number | null };
  }> {
    const tenantId = TenantContext.current().tenantId;
    const [rules, users] = await Promise.all([
      this.prisma.withTenant((tx) =>
        tx.automationRule.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            enabled: true,
            trigger: true,
            conditions: true,
            action: true,
            createdAt: true,
          },
        }),
      ),
      this.prisma.withTenant((tx) =>
        tx.user.findMany({
          where: { tenantId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ),
    ]);
    return {
      triggers: AUTOMATION_TRIGGERS,
      rules,
      users,
      quota: await this.quota.status(tenantId),
    };
  }

  @Post()
  @RequireCapability("settings.manage")
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(AutomationRuleInputSchema)) body: AutomationRuleInput,
  ): Promise<{ id: string }> {
    await this.assertValid(body);
    // המכסה לפני האימות היקר? לא — האימות זול, והודעת "המסלול מלא"
    // צריכה להגיע רק אחרי שברור שהכלל עצמו תקין
    await this.quota.assertCanAdd();
    const { tenantId, userId } = TenantContext.current();
    const id = ulid();

    await this.prisma.withTenant(async (tx) => {
      await tx.automationRule.create({
        data: {
          id,
          tenantId,
          name: body.name,
          enabled: body.enabled,
          trigger: body.trigger,
          conditions: body.conditions,
          action: body.action,
          createdBy: userId,
        },
      });
      await this.audit.record(tx, {
        action: "automation_rule.create",
        entityType: "automation_rule",
        entityId: id,
        metadata: { name: body.name, trigger: body.trigger },
      });
    });
    return { id };
  }

  @Patch(":id")
  @RequireCapability("settings.manage")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(AutomationRuleInputSchema)) body: AutomationRuleInput,
  ): Promise<{ ok: true }> {
    await this.assertValid(body);
    const tenantId = TenantContext.current().tenantId;

    await this.prisma.withTenant(async (tx) => {
      /*
       * `updateMany` עם `tenantId` ולא `update` לפי מזהה בלבד.
       * ה-RLS כבר מגביל, אבל שער מפורש בשאילתה עולה כלום ומגן גם
       * ביום שבו מישהו יקרא לזה מהקשר אחר.
       */
      const changed = await tx.automationRule.updateMany({
        where: { id, tenantId },
        data: {
          name: body.name,
          enabled: body.enabled,
          trigger: body.trigger,
          conditions: body.conditions,
          action: body.action,
        },
      });
      if (changed.count === 0) throw new BadRequestException("האוטומציה לא נמצאה");
      await this.audit.record(tx, {
        action: "automation_rule.update",
        entityType: "automation_rule",
        entityId: id,
        metadata: { name: body.name, enabled: body.enabled },
      });
    });
    return { ok: true };
  }

  @Delete(":id")
  @RequireCapability("settings.manage")
  @HttpCode(200)
  async remove(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      const deleted = await tx.automationRule.deleteMany({ where: { id, tenantId } });
      if (deleted.count === 0) throw new BadRequestException("האוטומציה לא נמצאה");
      await this.audit.record(tx, {
        action: "automation_rule.delete",
        entityType: "automation_rule",
        entityId: id,
        metadata: {},
      });
    });
    return { ok: true };
  }

  /**
   * אימות מהותי מעבר לצורה.
   *
   * Zod מוודא שהמבנה תקין; זה מוודא שהוא **הגיוני** — שהטריגר קיים,
   * שהשדה שייך לו, ושהאופרטור מתאים לסוגו. כלל ששמור עם טריגר שאינו
   * קיים לעולם לא ירוץ ולעולם לא יאמר למה, ושגיאה בשמירה עדיפה על
   * אוטומציה שקטה שאינה עובדת.
   *
   * הנמען מאומת מול משתמשי המשרד: מזהה של סוכן ממשרד אחר היה יוצר
   * משימות שאיש אינו רואה.
   */
  private async assertValid(rule: AutomationRuleInput): Promise<void> {
    const reason = ruleRejectionReason(rule);
    if (reason !== null) throw new BadRequestException(reason);

    const tenantId = TenantContext.current().tenantId;
    const targetUserId =
      rule.action.kind === "task" ? rule.action.assignedToUserId : rule.action.userId;
    const user = await this.prisma.withTenant((tx) =>
      tx.user.findFirst({
        where: { id: targetUserId, tenantId, isActive: true },
        select: { id: true },
      }),
    );
    if (!user) throw new BadRequestException("המשתמש שנבחר אינו פעיל במשרד");
  }
}
