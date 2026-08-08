import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { IdSchema, UserRoleSchema } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { onboardingSteps, type OnboardingProgress } from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService } from "../auth/auth.service";
import { LoginThrottleService } from "../auth/login-throttle.service";

const TenantSettingsSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    /** המספר העסקי לוואטסאפ — ספרות בלבד; "" מנתק את השיוך */
    whatsappNumber: z.union([z.string().regex(/^\d{9,15}$/u), z.literal("")]).optional(),
    /* פרטי המשרד שנכנסים לנוסחי ההסכמים. מספר רישיון התיווך הוא
       פרט חובה בהזמנה בכתב לפי חוק המתווכים במקרקעין. */
    licenseNumber: z.union([z.string().max(40), z.literal("")]).optional(),
    officeAddress: z.union([z.string().max(200), z.literal("")]).optional(),
    officePhone: z.union([z.string().max(30), z.literal("")]).optional(),
    /* ברירות המחדל לנוסחי ההסכמים. דמי התיווך ומועד התשלום הם פרטי
       חובה בתקנות, ושער ההחתמה יוצר הסכם בלי שאיש הזין אותם — בלי
       ברירת מחדל ברמת המשרד הוא לא יכול לייצר מסמך תקף כלל. */
    defaultCommission: z.union([z.string().max(80), z.literal("")]).optional(),
    defaultPaymentTerms: z.union([z.string().max(120), z.literal("")]).optional(),
  })
  .strict();

// owner אינו ניתן להקצאה דרך ה-API — מוקם בהקמת הסוכנות בלבד
const AssignableRoleSchema = UserRoleSchema.exclude(["owner"]);

const CreateUserSchema = z
  .object({
    name: z.string().min(2).max(120),
    email: z.string().email().max(254),
    role: AssignableRoleSchema,
  })
  .strict();

const UpdateUserSchema = z
  .object({
    role: AssignableRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const AuditQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();

export interface TeamUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt?: Date;
  /** נעול זמנית בגלל ניסיונות התחברות כושלים — ניתן לשחרור ע"י המנהל */
  locked: boolean;
}

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  @Get("tenant")
  @RequireCapability("settings.manage")
  async tenant(): Promise<{
    name: string;
    whatsappNumber?: string;
    plan: string;
    leadWebhookKey?: string;
    licenseNumber?: string;
    officeAddress?: string;
    officePhone?: string;
    defaultCommission?: string;
    defaultPaymentTerms?: string;
  }> {
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, plan: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    return {
      name: tenant?.name ?? "",
      whatsappNumber:
        typeof settings["whatsappNumber"] === "string" ? settings["whatsappNumber"] : undefined,
      plan: tenant?.plan ?? "basic",
      leadWebhookKey:
        typeof settings["leadWebhookKey"] === "string" ? settings["leadWebhookKey"] : undefined,
      licenseNumber:
        typeof settings["licenseNumber"] === "string" ? settings["licenseNumber"] : undefined,
      officeAddress:
        typeof settings["officeAddress"] === "string" ? settings["officeAddress"] : undefined,
      officePhone:
        typeof settings["officePhone"] === "string" ? settings["officePhone"] : undefined,
      defaultCommission:
        typeof settings["defaultCommission"] === "string"
          ? settings["defaultCommission"]
          : undefined,
      defaultPaymentTerms:
        typeof settings["defaultPaymentTerms"] === "string"
          ? settings["defaultPaymentTerms"]
          : undefined,
    };
  }

  /**
   * הפעלה/חידוש של מפתח קליטת הלידים מהאתר — מזהה את המשרד בנקודת
   * הקצה הציבורית ‎/public/leads/:key. חידוש מבטל את המפתח הקודם
   * (טופס ישן באתר יפסיק לעבוד עד עדכון).
   */
  @Post("lead-webhook")
  @RequireCapability("settings.manage")
  async regenerateLeadWebhook(): Promise<{ key: string }> {
    const tenantId = TenantContext.current().tenantId;
    const key = randomBytes(24).toString("base64url"); // 32 תווים
    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = { ...((current?.settings ?? {}) as Record<string, unknown>) };
    settings["leadWebhookKey"] = key;
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { settings: settings as object },
    });
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.lead_webhook_regenerate",
        entityType: "tenant",
        entityId: tenantId,
      }),
    );
    return { key };
  }

  @Patch("tenant")
  @RequireCapability("settings.manage")
  async updateTenant(
    @Body(new ZodValidationPipe(TenantSettingsSchema)) body: z.infer<typeof TenantSettingsSchema>,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;

    // מספר וואטסאפ ייחודי בין משרדים — אחרת הודעות לקוחות ינותבו למשרד
    // שגוי (ביקורת Codex, PR #5). אינדקס DB ייחודי משמש כקו הגנה שני.
    if (body.whatsappNumber) {
      const taken = await this.prisma.tenant.findFirst({
        where: {
          id: { not: tenantId },
          settings: { path: ["whatsappNumber"], equals: body.whatsappNumber },
        },
        select: { id: true },
      });
      if (taken) throw new BadRequestException("המספר כבר משויך למשרד אחר");
    }

    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = { ...((current?.settings ?? {}) as Record<string, unknown>) };

    /*
     * כל השדות שיושבים ב-settings עוברים באותה לולאה.
     *
     * קודם רק whatsappNumber נכתב, ושלושת פרטי המשרד נבלעו בשקט: הם
     * עברו ולידציה, חזרו ב-GET, ומעולם לא נשמרו. משתמש שמילא מספר
     * רישיון, שמר, וראה "נשמר" — קיבל שדה ריק בטעינה הבאה. שמירה
     * שמדווחת הצלחה ולא כותבת גרועה משדה שלא קיים.
     *
     * מחרוזת ריקה מוחקת את המפתח (ניקוי שדה), ולא שומרת "" —
     * כדי שהתבניות יראו "חסר" ולא ידפיסו רישיון ריק בהסכם.
     */
    const SETTINGS_FIELDS = [
      "whatsappNumber",
      "licenseNumber",
      "officeAddress",
      "officePhone",
      "defaultCommission",
      "defaultPaymentTerms",
    ] as const;
    let settingsTouched = false;
    for (const field of SETTINGS_FIELDS) {
      const value = body[field];
      if (value === undefined) continue;
      settingsTouched = true;
      if (value === "") delete settings[field];
      else settings[field] = value;
    }

    try {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(settingsTouched ? { settings: settings as object } : {}),
        },
      });
    } catch {
      // מרוץ מול משרד אחר — האינדקס הייחודי ב-DB חסם
      throw new BadRequestException("המספר כבר משויך למשרד אחר");
    }
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "settings.update",
        entityType: "tenant",
        entityId: tenantId,
        metadata: { changedFields: Object.keys(body) },
      }),
    );
    return { ok: true };
  }

  @Get("users")
  @RequireCapability("users.manage")
  async users(): Promise<TeamUserDto[]> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
    });
    return Promise.all(
      rows.map(async (u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ?? undefined,
        locked: await this.loginThrottle.isLocked(u.email),
      })),
    );
  }

  /**
   * שחרור נעילת התחברות — משתמש שננעל אחרי יותר מדי ניסיונות שגויים
   * לא צריך לחכות 15 דקות; המנהל משחרר אותו כאן.
   */
  @Post("users/:id/unlock")
  @RequireCapability("users.manage")
  @HttpCode(200)
  async unlockUser(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ ok: true }> {
    const tenantId = TenantContext.current().tenantId;
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { email: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");
    await this.loginThrottle.unlockEmail(target.email);
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "users.unlock",
        entityType: "user",
        entityId: id,
      }),
    );
    return { ok: true };
  }

  /** הוספת איש צוות: סיסמה זמנית מוצגת פעם אחת בלבד — לא נשמרת בגלוי. */
  @Post("users")
  @RequireCapability("users.manage")
  async createUser(
    @Body(new ZodValidationPipe(CreateUserSchema)) body: z.infer<typeof CreateUserSchema>,
  ): Promise<{ user: TeamUserDto; tempPassword: string }> {
    const tenantId = TenantContext.current().tenantId;
    const email = body.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException("האימייל כבר רשום במערכת");

    const tempPassword = `Mv-${randomBytes(9).toString("base64url")}`;
    const id = ulid();
    const passwordHash = await AuthService.hashPassword(tempPassword);
    // יצירה + Audit בטרנזקציה אחת — אין חשבון בלי רישום (ביקורת Codex)
    await this.prisma.withTenant(async (tx) => {
      await tx.user.create({
        data: {
          id,
          tenantId,
          name: body.name,
          email,
          role: body.role,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await this.audit.record(tx, {
        action: "users.create",
        entityType: "user",
        entityId: id,
        metadata: { role: body.role },
      });
    });
    return {
      user: { id, name: body.name, email, role: body.role, isActive: true, locked: false },
      tempPassword,
    };
  }

  @Patch("users/:id")
  @RequireCapability("users.manage")
  async updateUser(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: z.infer<typeof UpdateUserSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    if (id === ctx.userId) {
      throw new BadRequestException("אי אפשר לשנות את המשתמש של עצמך מכאן");
    }
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { role: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");
    if (target.role === "owner") {
      throw new BadRequestException("אי אפשר לשנות את בעל המשרד");
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    if (body.isActive === false) {
      // ניתוק מיידי: משתמש שהושבת לא ממשיך לעבוד עם Session חי
      await this.prisma.session.deleteMany({ where: { userId: id } });
    }
    await this.prisma.withTenant((tx) =>
      this.audit.record(tx, {
        action: "users.update",
        entityType: "user",
        entityId: id,
        metadata: { changedFields: Object.keys(body) },
      }),
    );
    return { ok: true };
  }

  /** "מי ראה מה, מי שלח מה, ומתי" (אפיון §19) — יומן הביקורת של המשרד. */
  @Get("audit")
  @RequireCapability("audit.view")
  async auditLog(
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: z.infer<typeof AuditQuerySchema>,
  ): Promise<{ items: { action: string; entityType: string; userName?: string; createdAt: Date }[] }> {
    const tenantId = TenantContext.current().tenantId;
    const rows = await this.prisma.withTenant((tx) =>
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: query.limit,
        select: { action: true, entityType: true, userId: true, createdAt: true },
      }),
    );
    const userIds = [...new Set(rows.map((r) => r.userId).filter((u): u is string => u !== null))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return {
      items: rows.map((r) => ({
        action: r.action,
        entityType: r.entityType,
        userName: r.userId ? nameById.get(r.userId) : undefined,
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * סטטוס חיבור הוואטסאפ של המשרד — מה מוגדר, מה חסר, והאם זורמות
   * הודעות בפועל (ההודעה הנכנסת האחרונה). משמש את מסך ההגדרות כדי
   * שהמתווך יידע בדיוק איפה החיבור עומד בלי לנחש.
   */
  @Get("whatsapp-status")
  @RequireCapability("settings.manage")
  async whatsappStatus(): Promise<{
    serverConfigured: boolean;
    numberConfigured: boolean;
    lastInboundAt?: Date;
  }> {
    const env = loadEnv();
    const tenantId = TenantContext.current().tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const numberConfigured = typeof settings["whatsappNumber"] === "string";

    // ההודעה הנכנסת האחרונה — ההוכחה שהחיבור חי מקצה לקצה
    const lastInbound = await this.prisma.withTenant((tx) =>
      tx.interaction.findFirst({
        // נכנסות בלבד — הצעה שנשלחה בוואטסאפ היא direction:out ולא
        // מעידה שה-webhook מ-Meta עובד (ביקורת Codex)
        where: { tenantId, kind: "whatsapp", direction: "in" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    );

    return {
      serverConfigured:
        env.WHATSAPP_APP_SECRET !== undefined && env.WHATSAPP_VERIFY_TOKEN !== undefined,
      numberConfigured,
      /*
       * כתובת ה-Webhook **אינה** מוחזרת כאן.
       *
       * היא מוגדרת פעם אחת במטא לכל הפלטפורמה, ולמנהל משרד אין אפליקציית
       * Meta שאפשר להזין אותה בה. הצגתה לו רק שידרה שיש כאן משהו שהוא
       * צריך לעשות — ובמקביל חשפה פרט תפעולי של הפלטפורמה לכל דייר.
       * מקומה במסך /platform, שם היא באמת ניתנת לפעולה.
       */
      lastInboundAt: lastInbound?.createdAt,
    };
  }

  /**
   * הגרסה המותקנת — לתצוגה בלבד, לכל מי שרשאי לראות הגדרות. *הפעלת*
   * העדכון עברה ל-/platform: השרת משותף לכל המשרדים, ומנהל משרד אחד
   * שלוחץ "עדכן" היה מפעיל מחדש את השירות לכולם.
   */
  @Get("system")
  @RequireCapability("settings.manage")
  systemInfo(): { version: string } {
    return { version: loadEnv().APP_VERSION };
  }

  /**
   * "מה נשאר להפעיל" — מסך הקליטה של משרד חדש.
   *
   * מוצג לכל מי שרואה את הדשבורד ולא רק למנהל: סוכן שמגלה שאפשר
   * לקלוט נכס בדיבור מאמץ את המערכת מהר יותר. הצעדים עצמם מוגדרים
   * בלוגיקה משותפת (packages/shared — onboarding.ts).
   */
  @AnyAuthenticated()
  @Get("onboarding")
  async onboarding(): Promise<OnboardingProgress> {
    const tenantId = TenantContext.current().tenantId;
    const env = loadEnv();

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, settings: true },
    });
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    const filled = (key: string): boolean =>
      typeof settings[key] === "string" && (settings[key] as string).trim() !== "";

    const [activeUsers, properties, buyers] = await Promise.all([
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.withTenant((tx) => tx.property.count({ where: { tenantId, deletedAt: null } })),
      this.prisma.withTenant((tx) => tx.buyer.count({ where: { tenantId, deletedAt: null } })),
    ]);

    return onboardingSteps({
      // מספר הרישיון הוא פרט חובה בהזמנה בכתב — בלעדיו ההסכמים פגומים
      officeProfileComplete:
        (tenant?.name ?? "").trim() !== "" && filled("licenseNumber") && filled("officePhone"),
      activeUsers,
      properties,
      buyers,
      leadWebhookConfigured: filled("leadWebhookKey"),
      whatsappConfigured: filled("whatsappNumber"),
      transcriptionAvailable: env.STT_URL !== undefined && env.STT_SECRET !== undefined,
    });
  }
}
