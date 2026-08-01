import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { IdSchema, TenantPlanSchema, TenantStatusSchema } from "@metavchim/shared";
import { loadEnv } from "../../config/env";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import { AuthService } from "../auth/auth.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
}
