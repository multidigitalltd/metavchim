import { PrismaService } from "../core/prisma.service";
import { TenantContext } from "./tenant-context";

/**
 * ‏האימייל של מנהל הפלטפורמה הפועל — **מה שהופך „מנהל הפלטפורמה”
 * ‏לשם.**
 *
 * ‏פעולה שמנהל פלטפורמה עושה בשם משרד נרשמת ביומן של אותו משרד עם
 * ‎`userId: null`, כי לא משתמש של המשרד פעל בה. בלי הכתובת הזו
 * ‏השורה ביומן הייתה אומרת „מישהו”, וזו בדיוק השקיפות שהיא באה
 * ‏להחליף בה בקשת רשות מראש.
 *
 * ‎`PlatformAdminGuard` כבר שולף את אותה שורה כדי לאשר את הגישה,
 * ‏אבל אינו מותיר אותה מאחוריו; שליפה חוזרת כאן זולה ומדויקת יותר
 * ‏מהעברת מצב בין שער לקוד שרץ אחריו. מה שחשוב הוא שיש **הגדרה
 * ‏אחת**: קודם כל קורא כתב לעצמו את השורות האלה, והשני היה נופל
 * ‏על נסיגה אחרת.
 */
export async function actingPlatformAdminEmail(prisma: PrismaService): Promise<string> {
  const admin = await prisma.user.findUnique({
    where: { id: TenantContext.current().userId },
    select: { email: true },
  });
  return admin?.email ?? "platform";
}
