import type { PrismaService } from "../core/prisma.service";
import { TenantContext } from "./tenant-context";

/**
 * ‎**רשימת אנשי המשרד — שאילתה אחת, ושני שערים שונים.**
 *
 * ‏עד כה היא ישבה ב-`TasksService.assignees()` מאחורי `tasks.assign`,
 * ‏וזה נכון **לשיוך משימה**: הטלת עבודה על מישהו היא פעולה של מי
 * ‏שרשאי להטיל.
 *
 * ‏אבל סימון **סוכן שותף על עסקה** אינו שיוך: הוא אינו מעביר בעלות,
 * ‏אינו משנה מי רואה מה, ואינו נוגע בניקוד. הוא תיעוד של מה שקרה,
 * ‏וכל מי שרשאי לערוך את הנכס רשאי לרשום אותו (הכרעת בעל המוצר).
 *
 * ‎**ולכן השאילתה יצאה לכאן ולא הועתקה.** שני עותקים של „מי במשרד”
 * ‏היו נפרדים ביום שמישהו יוסיף תנאי לאחד מהם — למשל הסתרת משתמש
 * ‏מושהה — והמסך אחד היה מציע את מי שהשני כבר לא.
 *
 * ‎**מה זה חושף, ומה לא.** שם של עמית באותו משרד בלבד: `tenantId`
 * ‏מה-`TenantContext`, ו-RLS מעליו. זה מה שכבר מוצג היום בכל כרטיס
 * ‏נכס („הסוכן המטפל”), ואין בו שום נתון של לקוח, של סוכן אחר או
 * ‏של משרד אחר.
 */
export async function officeMembers(
  prisma: PrismaService,
): Promise<{ id: string; name: string }[]> {
  const tenantId = TenantContext.current().tenantId;
  return prisma.user.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}
