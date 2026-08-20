import type { PrismaService } from "../../core/prisma.service";
import type { StorageService } from "../../core/storage.service";

/**
 * המשרד המפרסם, לכל מודעה בפיד הרשת — שם ולוגו.
 *
 * מודעה בלי משרד היא מודעה שקשה להחליט עליה: מי שעומד להציע נכס
 * או קונה רוצה לדעת עם מי הוא עומד לשתף פעולה — וזה מידע על *משרד*,
 * לא על הלקוח. פרטי הלקוח נשארים חסויים בדיוק כמו קודם.
 *
 * הלוגו מצטרף לשם מאותה סיבה בדיוק, והוא מה שהופך רשימת שורות ללוח
 * שאפשר לסרוק בעין: משרד מזוהה נבחר לפני משרד אנונימי.
 *
 * שאילתה אחת לכל הפיד ולא שם לכל שורה — זה ה-N+1 שכבר תוקן פעם
 * אחת במודול הזה, ואין סיבה להחזיר אותו בשביל שם.
 *
 * `tenants` אינה תחת RLS (תשתית ולא תוכן עסקי — ראו מיגרציית ה-RLS),
 * ולכן הקריאה ישירה ולא דרך הקשר דייר.
 *
 * מזהי דיירים סינתטיים — ביקושי Kanko יושבים על `KANKO_TENANT_ID` —
 * אינם בטבלה וחוזרים חסרים. זו התוצאה הנכונה: להם המסך מציג את תג
 * המקור החיצוני, שהוא מה שהם באמת, ולא שם של משרד תיווך.
 */
export interface OfficeBadge {
  name: string;
  /**
   * כתובת חתומה קצרת-חיים ללוגו, כשיש.
   *
   * נחתמת בזמן הקריאה ולא נשמרת: כתובת חתומה שנשמרת בטבלה פגה
   * אחרי שעה ומשאירה תמונה שבורה במודעה — בדיוק כמו בתמונות הנכס.
   */
  logoUrl?: string;
}

export async function officeBadges(
  prisma: PrismaService,
  storage: StorageService,
  tenantIds: readonly string[],
): Promise<Map<string, OfficeBadge>> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return new Map();

  const rows = await prisma.tenant.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, settings: true },
  });

  const badges = await Promise.all(
    rows.map(async (row) => {
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const logoKey = settings["logoKey"];
      /*
       * לוגו שאי אפשר לחתום אינו מפיל את המודעה — היא פשוט מוצגת
       * בלי לוגו. מודעה בלי תמונה שווה יותר משגיאת שרת.
       */
      const logoUrl =
        typeof logoKey === "string" && logoKey !== ""
          ? await storage.signedGetUrl(logoKey).catch(() => null)
          : null;
      const badge: OfficeBadge = {
        name: row.name,
        ...(logoUrl === null ? {} : { logoUrl }),
      };
      return [row.id, badge] as const;
    }),
  );
  return new Map(badges);
}
