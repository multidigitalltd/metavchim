import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import {
  CAPABILITIES,
  IdSchema,
  PLAN_FEATURES,
  UserRoleSchema,
  clearEffect,
  describeOverride,
  isOverrideActive,
  limitState,
  overrideRejectionReason,
  resolveCapabilities,
  type Capability,
  type LimitState,
} from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { onboardingSteps, type OnboardingProgress } from "@metavchim/shared";
import { AnyAuthenticated, RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PlanCatalogService } from "../../core/plan-catalog.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
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
  })
  .strict();

// owner אינו ניתן להקצאה דרך ה-API — מוקם בהקמת הסוכנות בלבד
const AssignableRoleSchema = UserRoleSchema.exclude(["owner"]);

/**
 * שינוי הרשאות: רשימת יכולות ולא יכולת בודדת, כדי שחסימת מודול שלם
 * תהיה פעולה אחת בטרנזקציה אחת. `clear` מחזיר לברירת המחדל של התפקיד.
 */
const SetCapabilitiesSchema = z
  .object({
    capabilities: z.array(z.enum(CAPABILITIES)).min(1).max(CAPABILITIES.length),
    effect: z.enum(["grant", "deny", "clear"]),
    /** ISO; null/חסר = לצמיתות */
    expiresAt: z.string().datetime().nullish(),
    reason: z.string().max(200).optional(),
  })
  .strict();

type UserCapabilitiesDto = {
  userId: string;
  name: string;
  role: string;
  protected: boolean;
  effective: string[];
  overrides: {
    capability: string;
    effect: string;
    expiresAt?: string;
    reason?: string;
    description: string;
    active: boolean;
  }[];
};

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
    private readonly plans: PlanCatalogService,
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
    };
  }

  /**
   * המסלול של המשרד — מה כלול בו ואיפה הוא עומד מול המגבלות.
   *
   * `@AnyAuthenticated` ולא `settings.manage`: זו לא הגדרה אלא מידע
   * שכל מי שנתקל בקיר במסך צריך לראות. סוכן שלוחץ "ייצוא" ומקבל
   * חסימה זכאי לדעת שזה המסלול ולא תקלה.
   *
   * המחירים לא מוחזרים כאן — זה מסך של מה מותר, לא של כמה זה עולה.
   */
  @Get("plan")
  @AnyAuthenticated()
  async plan(): Promise<{
    code: string;
    name: string;
    description: string;
    /**
     * false = קוד המסלול של המשרד אינו נפתר לשום הגדרה.
     *
     * זה לא "בלי מגבלות" אלא מצב תקלה: האכיפה חוסמת כל הוספה, ולכן
     * מסך שמציג "ללא הגבלה" היה סותר את מה שהמשתמש חווה בפועל
     * (ביקורת Codex).
     */
    resolved: boolean;
    features: { code: string; label: string; description: string; included: boolean }[];
    limits: {
      users: { used: number; limit: number | null; state: LimitState };
      properties: { used: number; limit: number | null; state: LimitState };
    };
  }> {
    const tenantId = TenantContext.current().tenantId;
    /*
     * ספירת הנכסים דרך `withTenant`, ובנפרד ממוני המשתמשים.
     *
     * `properties` תחת FORCE RLS, ולכן `_count` דרך הלקוח הישיר החזיר
     * **אפס** — המסך היה מדווח שאין נכסים בכלל, גם למשרד עם מאות.
     * `users` מחוץ ל-RLS (ראו הערה ב-schema.prisma) ולכן נשאר כאן
     * (ביקורת Codex — הפעם החמישית שהתבנית הזו חוזרת).
     *
     * הסינונים זהים לאלה של האכיפה: משתמש פעיל בלבד, ונכס שאינו
     * בארכיון.
     */
    const [plan, tenant, users, properties] = await Promise.all([
      this.plans.forTenant(tenantId),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { plan: true } }),
      this.prisma.user.count({ where: { tenantId, isActive: true } }),
      this.prisma.withTenant((tx) =>
        tx.property.count({ where: { tenantId, deletedAt: null } }),
      ),
    ]);
    /*
     * מסלול שלא נפתר מוצג כחסום ולא כ"ללא הגבלה".
     *
     * `null` במגבלה פירושו ללא הגבלה, וזו בדיוק התשובה ההפוכה
     * מהמציאות: האכיפה דוחה כל הוספה. `blocked: true` עם `limit: 0`
     * הוא הייצוג הכן של המצב.
     */
    const unresolved: LimitState = { blocked: true, remaining: 0, percent: 100, warn: true };
    const limitFor = (used: number, limit: number | null): LimitState =>
      plan === undefined ? unresolved : limitState(used, limit);

    return {
      code: plan?.code ?? (tenant?.plan ?? ""),
      // מסלול לא מוכר לא נופל אלא מוצג ככזה: הוא מצב תקלה שדורש
      // טיפול של בעל הפלטפורמה, ומסך ריק לא היה מסגיר אותו
      name: plan?.name ?? "מסלול לא מוגדר",
      description: plan?.description ?? "",
      resolved: plan !== undefined,
      features: PLAN_FEATURES.map((feature) => ({
        ...feature,
        included: plan?.features.includes(feature.code) ?? false,
      })),
      limits: {
        users: {
          used: users,
          limit: plan?.maxUsers ?? null,
          state: limitFor(users, plan?.maxUsers ?? null),
        },
        properties: {
          used: properties,
          limit: plan?.maxProperties ?? null,
          state: limitFor(properties, plan?.maxProperties ?? null),
        },
      },
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

  /**
   * ההרשאות בפועל של איש צוות אחד — התפקיד, החריגים, והתוצאה.
   *
   * המסך צריך את שלושתם: התפקיד כדי להראות מאיפה התחלנו, החריגים
   * כדי להראות מה המנהל שינה ועד מתי, והתוצאה כדי שלא יצטרך לחשב
   * בעצמו מה יוצא מהצירוף.
   */
  @Get("users/:id/capabilities")
  @RequireCapability("users.manage")
  async userCapabilities(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<UserCapabilitiesDto> {
    const tenantId = TenantContext.current().tenantId;
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: { id: true, name: true, role: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");

    const rows = await this.prisma.withTenant((tx) =>
      tx.userCapability.findMany({
        where: { userId: id, tenantId },
        select: { capability: true, effect: true, expiresAt: true, reason: true },
        orderBy: { capability: "asc" },
      }),
    );
    const now = new Date();
    const overrides = rows.map((row) => ({
      capability: row.capability as Capability,
      effect: row.effect === "grant" ? ("grant" as const) : ("deny" as const),
      expiresAt: row.expiresAt,
    }));

    return {
      userId: target.id,
      name: target.name,
      role: target.role,
      // בעל המשרד מוגן בשרת; המסך מקבל את הדגל כדי להסביר למה
      protected: target.role === "owner" || target.id === TenantContext.current().userId,
      effective: [...resolveCapabilities(target.role, overrides, now)],
      overrides: rows.map((row, index) => ({
        capability: row.capability,
        effect: row.effect,
        expiresAt: row.expiresAt?.toISOString(),
        reason: row.reason ?? undefined,
        description: describeOverride(overrides[index]!, now),
        active: isOverrideActive(overrides[index]!, now),
      })),
    };
  }

  /**
   * שינוי הרשאות של איש צוות — יכולת בודדת או מודול שלם.
   *
   * הרשימה במקום ערך יחיד היא מה שמאפשר "חסום את מודול הנכסים
   * לשבוע" בפעולה אחת ובטרנזקציה אחת, במקום ארבע קריאות שיכולות
   * להיכשל באמצע ולהשאיר חצי מודול חסום.
   *
   * שלוש מגבלות ההגנה (לא על עצמך, לא על בעל המשרד, ואי אפשר להעניק
   * מה שאין לך) נאכפות כאן בשרת ולא רק במסך — הנימוק המלא יושב
   * ב-overrideRejectionReason.
   */
  @Put("users/:id/capabilities")
  @RequireCapability("users.manage")
  async setUserCapabilities(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SetCapabilitiesSchema)) body: z.infer<typeof SetCapabilitiesSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    const target = await this.prisma.user.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, role: true },
    });
    if (!target) throw new BadRequestException("משתמש לא נמצא");

    /*
     * הבדיקה נעשית לפי מה שהשינוי *עושה בפועל*, לא לפי שמו.
     *
     * ניקוי חריג אינו ניטרלי: מחיקת חסימה על יכולת שהתפקיד כן נותן
     * מחזירה גישה — כלומר היא הענקה. בלי ההבחנה הזו מנהל שנחסמה
     * ממנו יכולת יכול היה לנקות אותה אצל מנהל אחר ולהחזיר גישה
     * שהוא עצמו אינו רשאי להעניק (ביקורת Codex).
     */
    const current = await this.prisma.withTenant((tx) =>
      tx.userCapability.findMany({
        where: { userId: id, tenantId: ctx.tenantId, capability: { in: body.capabilities } },
        select: { capability: true, effect: true },
      }),
    );
    const currentEffect = new Map(
      current.map((row) => [row.capability, row.effect === "grant" ? "grant" : "deny"] as const),
    );

    for (const capability of body.capabilities) {
      const effect =
        body.effect === "clear"
          ? clearEffect(target.role, capability, currentEffect.get(capability) ?? null)
          : body.effect;
      const reason = overrideRejectionReason({
        actorUserId: ctx.userId,
        actorCapabilities: ctx.capabilities,
        targetUserId: target.id,
        targetRole: target.role,
        capability,
        effect,
      });
      if (reason) throw new BadRequestException(reason);
    }

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("מועד סיום החסימה חייב להיות בעתיד");
    }

    await this.prisma.withTenant(async (tx) => {
      for (const capability of body.capabilities) {
        if (body.effect === "clear") {
          await tx.userCapability.deleteMany({
            where: { userId: id, tenantId: ctx.tenantId, capability },
          });
          continue;
        }
        // upsert ידני על צמד (משתמש, יכולת): שינוי חוזר מעדכן שורה
        // אחת ולא מערים שורות סותרות
        const updated = await tx.userCapability.updateMany({
          where: { userId: id, tenantId: ctx.tenantId, capability },
          data: { effect: body.effect, expiresAt, reason: body.reason ?? null },
        });
        if (updated.count === 0) {
          await tx.userCapability.create({
            data: {
              id: ulid(),
              tenantId: ctx.tenantId,
              userId: id,
              capability,
              effect: body.effect,
              expiresAt,
              reason: body.reason ?? null,
              createdBy: ctx.userId,
            },
          });
        }
      }
      await this.audit.record(tx, {
        action: `users.capabilities.${body.effect}`,
        entityType: "user",
        entityId: id,
        metadata: {
          capabilities: body.capabilities,
          expiresAt: expiresAt?.toISOString() ?? null,
          reason: body.reason ?? null,
        },
      });
    });

    return { ok: true };
  }

  /** הוספת איש צוות: סיסמה זמנית מוצגת פעם אחת בלבד — לא נשמרת בגלוי. */
  /**
   * מכסת המשתמשים הפעילים של המסלול.
   *
   * נבדקת על **המושב הבא** ולא על המצב הקיים: משרד שהמכסה שלו הוקטנה
   * ממשיך לעבוד עם מי שכבר יש לו, ורק תפיסת מושב נוסף נחסמת. חסימת
   * הקיימים הייתה מנתקת סוכנים באמצע יום עבודה בגלל שינוי תמחור.
   *
   * נקראת משתי נקודות ולא רק מיצירה: **הפעלה מחדש של משתמש מושבת
   * תופסת מושב בדיוק כמו יצירה**. בלי זה אפשר היה להשבית סוכן, ליצור
   * מחליף, ולהפעיל את הראשון בחזרה — ולעבור את המכסה בלי שום חסימה
   * (ביקורת Codex).
   *
   * הטבלה users מחוץ ל-RLS (ראו הערה ב-schema.prisma), ולכן הספירה
   * הישירה כאן תקפה — התנאי `tenantId` הוא זה שמבודד.
   */
  private async assertSeatAvailable(tx: TenantTx, tenantId: string): Promise<void> {
    const plan = await this.plans.forTenant(tenantId, tx);
    // מסלול שאי אפשר לפתור חוסם ולא פותח — ראו properties.service
    if (plan === undefined) {
      throw new BadRequestException("המסלול של המשרד אינו מוגדר — פנו לתמיכה");
    }
    if (plan.maxUsers === null) return;
    /*
     * מנעול ייעוץ ברמת הדייר, בתוך הטרנזקציה שכותבת.
     *
     * שתי בקשות מקבילות שספרו את אותו מצב לפני שאחת מהן כתבה היו
     * שתיהן עוברות, והמכסה הייתה נחצית בשקט (ביקורת Codex).
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${tenantId}`}))`;
    const used = await tx.user.count({ where: { tenantId, isActive: true } });
    if (limitState(used, plan.maxUsers).blocked) {
      throw new BadRequestException(
        `מסלול "${plan.name}" כולל ${plan.maxUsers} משתמשים. לתוספת משתמשים יש לשדרג מסלול.`,
      );
    }
  }

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
      // המכסה נבדקת באותה טרנזקציה שיוצרת, אחרי נעילת הדייר
      await this.assertSeatAvailable(tx, tenantId);
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
    await this.prisma.withTenant(async (tx) => {
      /*
       * המנעול נלקח **לפני** קריאת המצב, והמצב נקרא בתוך הטרנזקציה.
       *
       * קריאה מחוץ לנעילה יכולה להתיישן: הבקשה רואה את המשתמש כפעיל,
       * בקשה אחרת משביתה אותו ויוצרת מחליף עד המכסה, ואז הבקשה הזו
       * מדלגת על הבדיקה — כי לפי מה שהיא קראה זו לא הפעלה מחדש —
       * ומחזירה אותו לפעילות מעל המכסה (ביקורת Codex).
       *
       * pg_advisory_xact_lock ניתן לנעילה חוזרת באותה טרנזקציה, ולכן
       * assertSeatAvailable שלוקח אותו שוב אינו נחסם.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seat-quota:${ctx.tenantId}`}))`;
      const target = await tx.user.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: { role: true, isActive: true },
      });
      if (!target) throw new BadRequestException("משתמש לא נמצא");
      if (target.role === "owner") {
        throw new BadRequestException("אי אפשר לשנות את בעל המשרד");
      }
      // הפעלה מחדש תופסת מושב — אותה מכסה בדיוק כמו ביצירה
      if (body.isActive === true && !target.isActive) {
        await this.assertSeatAvailable(tx, ctx.tenantId);
      }
      await tx.user.update({
        where: { id },
        data: {
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
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
