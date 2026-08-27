import { Controller, Get, HttpCode, Param, Patch, Query } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AnyAuthenticated } from "../../common/auth.decorators";
import { NotificationsService, type NotificationDto } from "./notifications.service";

const ListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
  .strict();

export type { NotificationDto };

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @AnyAuthenticated()
  @Get()
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<{ items: NotificationDto[]; unreadCount: number }> {
    return this.notifications.list(query.limit);
  }

  @AnyAuthenticated()
  @Patch(":id/read")
  @HttpCode(200)
  async markRead(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.notifications.markRead(id);
    return { ok: true };
  }

  @AnyAuthenticated()
  @Patch("read-all")
  @HttpCode(200)
  async markAllRead(): Promise<{ ok: true }> {
    await this.notifications.markAllRead();
    return { ok: true };
  }
}
