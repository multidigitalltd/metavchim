import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { IdSchema, UserRoleSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import { AuthService } from "../auth/auth.service";

const TenantSettingsSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    /** המספר העסקי לוואטסאפ — ספרות בלבד; "" מנתק את השיוך */
    whatsappNumber: z.union([z.string().regex(/^\d{9,15}$/u), z.literal("")]).optional(),
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
}

@Controller("settings")
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get("tenant")
  @RequireCapability("settings.manage")
  async tenant(): Promise<{ name: string; whatsappNumber?: string; plan: string }> {
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
    };
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
    if (body.whatsappNumber !== undefined) {
      if (body.whatsappNumber === "") {
        delete settings["whatsappNumber"]; // ניתוק השיוך
      } else {
        settings["whatsappNumber"] = body.whatsappNumber;
      }
    }

    try {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.whatsappNumber !== undefined ? { settings: settings as object } : {}),
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
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt ?? undefined,
    }));
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
      user: { id, name: body.name, email, role: body.role, isActive: true },
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
}
