import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnv } from "../config/env";
import { PrismaService } from "../core/prisma.service";
import { PLATFORM_ADMIN_KEY } from "./auth.decorators";
import { TenantContext } from "./tenant-context";

/**
 * ניהול הפלטפורמה — מעל כל הדיירים: הקמת משרדים, הגדרות מערכת, מחיקה
 * ושחזור של גיבויים, ועדכון גרסה על המכונה עצמה. זהו המשטח המסוכן
 * ביותר במערכת.
 *
 * עד כה כל אחד משנים-עשר הנתיבים קרא בעצמו ל-`requirePlatformAdmin()`
 * בשורה הראשונה. זה עבד — בדקתי, אף אחד לא פוספס — אבל זה דפוס שבו
 * *הוספת* נתיב היא ההזדמנות לשכוח, ומחיר השכחה כאן הוא שחזור גיבוי
 * או הקמת משרד ע"י סוכן רגיל. שער ברמת המחלקה הופך את זה מ"צריך
 * לזכור" ל"צריך להשבית במפורש".
 *
 * ההרשאה נבדקת מול PLATFORM_ADMIN_EMAILS ולא נשמרת ב-Session, ולכן
 * הסרת כתובת אינה ממתינה לפקיעת ה-Session של אותו אדם. היא כן דורשת
 * הפעלה מחדש של התהליך: `loadEnv()` ממטמן את הסביבה בעלייה.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const admins = loadEnv().PLATFORM_ADMIN_EMAILS;
    // רשימה ריקה = המסך כבוי לגמרי, ולא "פתוח לכולם"
    if (admins.length === 0) throw new ForbiddenException("ניהול הפלטפורמה אינו מופעל");

    const { userId } = TenantContext.current();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user || !admins.includes(user.email.toLowerCase())) {
      throw new ForbiddenException("אין הרשאת ניהול פלטפורמה");
    }
    return true;
  }
}
