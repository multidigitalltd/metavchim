import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { ANNOUNCEMENTS, type Announcement } from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import { AnyAuthenticated } from "../../common/auth.decorators";

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

  @AnyAuthenticated()
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

  @AnyAuthenticated()
  @Post("seen")
  @HttpCode(200)
  async markSeen(
    @Body(new ZodValidationPipe(SeenSchema)) body: z.infer<typeof SeenSchema>,
  ): Promise<{ ok: true }> {
    const ctx = TenantContext.current();
    // הסמן רק מתקדם: לקוח ישן (טאב/מכשיר עם snapshot קודם) ששולח מזהה
    // ישן לא מזיז את הסמן אחורה ולא מחזיר באנרים שכבר נראו. ה-id ממוין
    // לקסיקוגרפית לפי זמן (YYYY-MM-DD-slug) — ההשוואה אטומית ב-DB
    // ולכן גם שני טאבים במקביל לא מתחרים (ביקורת Codex).
    await this.prisma.withTenant((tx) =>
      tx.user.updateMany({
        where: {
          id: ctx.userId,
          tenantId: ctx.tenantId,
          OR: [{ lastSeenAnnouncement: null }, { lastSeenAnnouncement: { lt: body.id } }],
        },
        data: { lastSeenAnnouncement: body.id },
      }),
    );
    return { ok: true };
  }
}
