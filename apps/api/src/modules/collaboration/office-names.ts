import type { PrismaService } from "../../core/prisma.service";
import { officeLogoPath } from "./network-media";

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
   * נתיב ה-API ללוגו, כשיש — לא כתובת אחסון חתומה (ראו
   * `network-media.ts`). הדפדפן מושך אותו מאותו מקור, וה-API מזרים.
   */
  logoUrl?: string;
}

export async function officeBadges(
  prisma: PrismaService,
  tenantIds: readonly string[],
): Promise<Map<string, OfficeBadge>> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return new Map();

  const rows = await prisma.tenant.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, settings: true },
  });

  return new Map(
    rows.map((row) => {
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const logoKey = settings["logoKey"];
      /*
       * הנתיב נבנה רק כשיש מפתח: משרד בלי לוגו לא יקבל כתובת
       * שתחזיר 404 בכל טעינת פיד.
       */
      const hasLogo = typeof logoKey === "string" && logoKey !== "";
      const badge: OfficeBadge = {
        name: row.name,
        ...(hasLogo ? { logoUrl: officeLogoPath(row.id) } : {}),
      };
      return [row.id, badge] as const;
    }),
  );
}
