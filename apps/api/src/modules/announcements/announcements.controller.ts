import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { ANNOUNCEMENTS, type Announcement } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";

/**
 * מסך "מה חדש" (docs/09 שלב 2): התוכן חי בקוד (packages/shared) —
 * עדכון גרסה מוסיף רשומה לרשימה והבאנר קם מעצמו. השרת שומר רק את
 * סמן ה"נצפה" פר משתמש. כל משתמש מחובר — אין צורך ב-capability.
 */

const SeenSchema = z
  .object({
    // רק מזהה שקיים ברשימה — קלט חופשי לא נכתב על המשתמש
    id: z.string().refine((v) => ANNOUNCEMENTS.some((a) => a.id === v), "עדכון לא מוכר"),
  })
  .strict();

@Controller("announcements")
export class AnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<{ items: Announcement[]; lastSeenId: string | null }> {
    const ctx = TenantContext.current();
    const user = await this.prisma.withTenant((tx) =>
      tx.user.findFirst({
        where: { id: ctx.userId, tenantId: ctx.tenantId },
        select: { lastSeenAnnouncement: true },
      }),
    );
    return { items: ANNOUNCEMENTS, lastSeenId: user?.lastSeenAnnouncement ?? null };
  }

  @Post("seen")
  @HttpCode(200)
  async markSeen(
    @Body(new ZodValidationPipe(SeenSchema)) body: z.infer<typeof SeenSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    await this.prisma.withTenant((tx) =>
      tx.user.updateMany({
        where: { id: ctx.userId, tenantId: ctx.tenantId },
        data: { lastSeenAnnouncement: body.id },
      }),
    );
    return { ok: true };
  }
}
