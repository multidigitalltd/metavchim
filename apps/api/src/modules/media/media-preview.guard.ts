import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../../core/prisma.service";
import { TenantContext } from "../../common/tenant-context";

/**
 * תצוגה מקדימה — נתיבי רכש המדיה של המשרד פתוחים למנהל הפלטפורמה בלבד.
 *
 * המסך קיים ועובד, אבל בעל הפלטפורמה עוד מתקן בו דברים לפני שמשרדים
 * מזמינים בו בכסף אמיתי. ה-web מציג לשאר „בקרוב” (`media/layout.tsx`);
 * השער הזה הוא מה שמונע ממי שיודע את הכתובת לעקוף את המסך ולהזמין
 * בכל זאת. אותו מקור אמת כמו `PlatformAdminGuard` — `PLATFORM_ADMIN_EMAILS`.
 *
 * זה **אינו** `@PlatformAdmin()`: הצהרות הגישה על הנתיבים
 * (`billing.manage` להזמנה בתשלום, כל משתמש מחובר להפניה) נשארות
 * כפי שיהיו אחרי ההשקה, והשער יושב מעליהן. להשקה — מסירים את
 * `@UseGuards(MediaPreviewGuard)` מהבקר ומוחקים את הקובץ הזה.
 */
@Injectable()
export class MediaPreviewGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(): Promise<boolean> {
    const admins = loadEnv().PLATFORM_ADMIN_EMAILS;
    const { userId } = TenantContext.current();
    const user =
      admins.length === 0
        ? null
        : await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user === null || !admins.includes(user.email.toLowerCase())) {
      throw new ForbiddenException("רכש מדיה ייפתח בקרוב");
    }
    return true;
  }
}
