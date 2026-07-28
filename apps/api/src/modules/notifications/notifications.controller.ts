import { Controller, Get, HttpCode, Param, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";

const ListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
  .strict();

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  readAt?: Date;
  createdAt: Date;
}

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<{ items: NotificationDto[]; unreadCount: number }> {
    return this.prisma.withTenant(async (tx) => {
      const tenantId = TenantContext.current().tenantId;
      const [rows, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: query.limit,
        }),
        tx.notification.count({ where: { tenantId, readAt: null } }),
      ]);
      return {
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body ?? undefined,
          entityType: n.entityType ?? undefined,
          entityId: n.entityId ?? undefined,
          readAt: n.readAt ?? undefined,
          createdAt: n.createdAt,
        })),
        unreadCount,
      };
    });
  }

  @Patch(":id/read")
  @HttpCode(200)
  async markRead(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.prisma.withTenant((tx) =>
      tx.notification.updateMany({
        where: { id, tenantId: TenantContext.current().tenantId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return { ok: true };
  }

  @Patch("read-all")
  @HttpCode(200)
  async markAllRead(): Promise<{ ok: true }> {
    await this.prisma.withTenant((tx) =>
      tx.notification.updateMany({
        where: { tenantId: TenantContext.current().tenantId, readAt: null },
        data: { readAt: new Date() },
      }),
    );
    return { ok: true };
  }
}
