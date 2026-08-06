import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { IdSchema, TenantPlanSchema, TenantStatusSchema } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailService } from "../../core/email.service";
import {
  PlatformSettingsService,
  type PlatformSettingKey,
} from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService } from "../auth/auth.service";
import {
  BackupsService,
  type BackupsOverview,
  type RestoreStatus,
} from "./backups.service";

/**
 * ניהול הפלטפורמה — הקמת משרדי תיווך חדשים מהממשק, בלי SSH.
 * גישה רק למי שמופיע ב-PLATFORM_ADMIN_EMAILS (בעל הפלטפורמה), בנוסף
 * להתחברות רגילה. כשהרשימה ריקה — המסך כבוי לגמרי.
 */

const CreateAgencySchema = z
  .object({
    name: z.string().min(2).max(120),
    ownerEmail: z.string().email().max(254),
    ownerName: z.string().min(2).max(120),
    plan: TenantPlanSchema.default("pro"),
  })
  .strict();

const UpdateAgencySchema = z
  .object({
    plan: TenantPlanSchema.optional(),
    status: TenantStatusSchema.optional(),
  })
  .strict();

/** ערך ריק = מחיקת ההגדרה מה-DB וחזרה למשתנה הסביבה (אם קיים). */
const UpdateSettingsSchema = z
  .object({
    postmarkServerToken: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    emailFrom: z.union([z.string().email().max(254), z.literal("")]).optional(),
    whatsappAppSecret: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    whatsappVerifyToken: z.union([z.string().min(16).max(200), z.literal("")]).optional(),
    loginOtpEnabled: z.boolean().optional(),
    googleClientId: z.union([z.string().min(10).max(200), z.literal("")]).optional(),
    googleClientSecret: z.union([z.string().min(10).max(200), z.literal("")]).optional(),
  })
  .strict();

/** שם קובץ גיבוי — הוולידציה המחייבת היא ב-BackupsService (רשימת היתר). */
const BackupNameSchema = z.object({ name: z.string().min(1).max(120) }).strict();

export interface AgencyRow {
  id: string;
  name: string;
  plan: string;
  status: string;
  userCount: number;
  createdAt: Date;
}

@Controller("platform")
export class PlatformController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly email: EmailService,
    private readonly backups: BackupsService,
  ) {}

  /** אימות מנהל פלטפורמה — מעבר להרשאות המשרד הרגילות. */
  private async requirePlatformAdmin(): Promise<void> {
    const admins = loadEnv().PLATFORM_ADMIN_EMAILS;
    if (admins.length === 0) throw new ForbiddenException("ניהול הפלטפורמה אינו מופעל");
    const { userId } = TenantContext.current();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user || !admins.includes(user.email.toLowerCase())) {
      throw new ForbiddenException("אין הרשאת ניהול פלטפורמה");
    }
  }

  @Get("agencies")
  async list(): Promise<AgencyRow[]> {
    await this.requirePlatformAdmin();
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        plan: true,
        status: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      status: t.status,
      userCount: t._count.users,
      createdAt: t.createdAt,
    }));
  }

  /** הקמת משרד חדש: Tenant + בעלים עם סיסמה זמנית (מוצגת פעם אחת). */
  @Post("agencies")
  async create(
    @Body(new ZodValidationPipe(CreateAgencySchema)) body: z.infer<typeof CreateAgencySchema>,
  ): Promise<{ tenantId: string; ownerEmail: string; tempPassword: string }> {
    await this.requirePlatformAdmin();
    const email = body.ownerEmail.toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new BadRequestException("האימייל כבר רשום במערכת");

    const tempPassword = `Mv-${randomBytes(9).toString("base64url")}`;
    const passwordHash = await AuthService.hashPassword(tempPassword);
    const tenantId = ulid();

    await this.prisma.$transaction([
      this.prisma.tenant.create({
        data: { id: tenantId, name: body.name, plan: body.plan, status: "active" },
      }),
      this.prisma.user.create({
        data: {
          id: ulid(),
          tenantId,
          name: body.ownerName,
          email,
          passwordHash,
          role: "owner",
          mustChangePassword: true,
        },
      }),
    ]);

    return { tenantId, ownerEmail: email, tempPassword };
  }

  /** מעבר מסלול / שינוי סטטוס (השהיה מנתקת את כל המשתמשים מיידית). */
  @Patch("agencies/:id")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateAgencySchema)) body: z.infer<typeof UpdateAgencySchema>,
  ): Promise<{ ok: true }> {
    await this.requirePlatformAdmin();
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { id: true } });
    if (!tenant) throw new BadRequestException("משרד לא נמצא");

    await this.prisma.tenant.update({
      where: { id },
      data: {
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    // השהיה — ניתוק מיידי של כל ה-sessions של המשרד
    if (body.status === "suspended") {
      const users = await this.prisma.user.findMany({
        where: { tenantId: id },
        select: { id: true },
      });
      await this.prisma.session.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
    }
    return { ok: true };
  }

  /**
   * הגדרות הפלטפורמה — מצב בלבד, בלי לחשוף ערכים. מפתחות שהוגדרו
   * במשתני סביבה מסומנים כמקור "env" (נשלטים מהשרת, לא מהמסך).
   */
  @Get("settings")
  async settings(): Promise<{
    postmark: { configured: boolean; source: "db" | "env" | "none"; emailFrom?: string };
    whatsapp: { configured: boolean; source: "db" | "env" | "none" };
    google: { configured: boolean; source: "db" | "env" | "none"; redirectUri: string };
    loginOtpEnabled: boolean;
  }> {
    await this.requirePlatformAdmin();
    const env = loadEnv();
    const dbKeys = await this.platformSettings.configuredKeys();
    const has = (k: PlatformSettingKey): boolean => dbKeys.includes(k);

    const postmarkDb = has("postmarkServerToken") && has("emailFrom");
    const postmarkEnv = env.POSTMARK_SERVER_TOKEN !== undefined && env.EMAIL_FROM !== undefined;
    const waDb = has("whatsappAppSecret") && has("whatsappVerifyToken");
    const waEnv = env.WHATSAPP_APP_SECRET !== undefined && env.WHATSAPP_VERIFY_TOKEN !== undefined;
    const googleDb = has("googleClientId") && has("googleClientSecret");
    const googleEnv = env.GOOGLE_CLIENT_ID !== undefined && env.GOOGLE_CLIENT_SECRET !== undefined;
    const otpDb = await this.platformSettings.get("loginOtpEnabled");

    return {
      postmark: {
        configured: postmarkDb || postmarkEnv,
        source: postmarkDb ? "db" : postmarkEnv ? "env" : "none",
        emailFrom: (await this.platformSettings.get("emailFrom")) ?? env.EMAIL_FROM,
      },
      whatsapp: {
        configured: waDb || waEnv,
        source: waDb ? "db" : waEnv ? "env" : "none",
      },
      google: {
        configured: googleDb || googleEnv,
        source: googleDb ? "db" : googleEnv ? "env" : "none",
        // הכתובת שחייבת להירשם ב-Google Cloud Console — מוצגת כדי
        // שלא יהיה צורך לנחש אותה
        redirectUri: `${env.WEB_ORIGIN}/api/v1/auth/google/callback`,
      },
      loginOtpEnabled: otpDb !== undefined ? otpDb === "true" : env.LOGIN_OTP_ENABLED,
    };
  }

  @Patch("settings")
  async updateSettings(
    @Body(new ZodValidationPipe(UpdateSettingsSchema)) body: z.infer<typeof UpdateSettingsSchema>,
  ): Promise<{ ok: true }> {
    await this.requirePlatformAdmin();
    const userId = TenantContext.current().userId;
    for (const [key, value] of Object.entries(body) as [PlatformSettingKey, string | boolean][]) {
      if (typeof value === "boolean") {
        await this.platformSettings.set(key, String(value), userId);
      } else if (value === "") {
        await this.platformSettings.remove(key); // ריק ⇒ חזרה למשתנה הסביבה
      } else {
        await this.platformSettings.set(key, value, userId);
      }
    }
    return { ok: true };
  }

  /** שליחת מייל בדיקה לכתובת של מנהל הפלטפורמה — אימות שהחיבור עובד. */
  @Post("settings/test-email")
  @HttpCode(200)
  async testEmail(): Promise<{ sentTo: string }> {
    await this.requirePlatformAdmin();
    const user = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true },
    });
    if (!user) throw new BadRequestException("משתמש לא נמצא");
    if (!(await this.email.isConfigured())) {
      throw new BadRequestException("אין ספק אימייל מוגדר — מלאו את פרטי Postmark ושמרו");
    }
    await this.email.sendTest(user.email);
    return { sentTo: user.email };
  }

  /** גרסה מותקנת + זמינות סוכן העדכון — למסך הפלטפורמה. */
  @Get("system")
  async systemInfo(): Promise<{ version: string; updateAvailable: boolean }> {
    await this.requirePlatformAdmin();
    const env = loadEnv();
    return {
      version: env.APP_VERSION,
      updateAvailable: env.UPDATER_URL !== undefined && env.UPDATE_SECRET !== undefined,
    };
  }

  /**
   * עדכון גרסה בלחיצת כפתור — **בעל הפלטפורמה בלבד**. הקריאה מגיעה
   * לסוכן העדכון שרץ לצד המערכת (infra/updater), שמושך תמונות עדכניות
   * ומרים אותן מחדש. ההפעלה מחדש היא של כל השרת, כלומר של כל המשרדים
   * יחד — ולכן זו לא פעולה של מנהל משרד.
   */
  @Post("system/update")
  @HttpCode(200)
  async triggerUpdate(): Promise<{ status: "started" }> {
    await this.requirePlatformAdmin();
    const env = loadEnv();
    if (env.UPDATER_URL === undefined || env.UPDATE_SECRET === undefined) {
      throw new ServiceUnavailableException("עדכון מרחוק אינו מוגדר בסביבה זו");
    }
    let res: Response;
    try {
      res = await fetch(`${env.UPDATER_URL}/update`, {
        method: "POST",
        headers: { "x-update-secret": env.UPDATE_SECRET },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException("סוכן העדכון אינו זמין");
    }
    if (res.status === 409) throw new ConflictException("עדכון כבר רץ — המתינו לסיומו");
    if (!res.ok) throw new ServiceUnavailableException("סוכן העדכון החזיר שגיאה");
    return { status: "started" };
  }

  /** מצב הגיבויים: רשימה מקומית, חיווי טריות ומצב העותק מחוץ לשרת. */
  @Get("backups")
  async backupsOverview(): Promise<BackupsOverview> {
    await this.requirePlatformAdmin();
    return this.backups.overview();
  }

  /**
   * מחיקת גיבוי. השירות חוסם מחיקה של הדאמפ האחרון של המסד — ואם
   * הסנכרון החיצוני פעיל, העותק המרוחק עובר לארכיון ולא נמחק.
   */
  @Post("backups/delete")
  @HttpCode(200)
  async deleteBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ ok: true }> {
    await this.requirePlatformAdmin();
    await this.backups.remove(body.name);
    return { ok: true };
  }

  /**
   * שחזור מגיבוי — **בעל הפלטפורמה בלבד**, והפעולה ההרסנית ביותר
   * במערכת: היא מחליפה את הנתונים של כל המשרדים יחד ומפילה את
   * השירות לכמה דקות. סוכן העדכון לוקח דאמפ בטיחות לפני שהוא מתחיל.
   */
  @Post("backups/restore")
  @HttpCode(202)
  async restoreBackup(
    @Body(new ZodValidationPipe(BackupNameSchema)) body: z.infer<typeof BackupNameSchema>,
  ): Promise<{ status: "started" }> {
    await this.requirePlatformAdmin();
    await this.backups.startRestore(body.name);
    return { status: "started" };
  }

  @Get("backups/restore/status")
  async restoreStatus(): Promise<RestoreStatus> {
    await this.requirePlatformAdmin();
    return this.backups.restoreStatus();
  }
}
