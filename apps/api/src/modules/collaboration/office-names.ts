import type { PrismaService } from "../../core/prisma.service";

/**
 * שם המשרד המפרסם, לכל מודעה בפיד הרשת.
 *
 * מודעה בלי שם משרד היא מודעה שקשה להחליט עליה: מי שעומד להציע נכס
 * או קונה רוצה לדעת עם מי הוא עומד לשתף פעולה — וזה מידע על *משרד*,
 * לא על הלקוח. פרטי הלקוח נשארים חסויים בדיוק כמו קודם.
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
export async function officeNames(
  prisma: PrismaService,
  tenantIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(tenantIds)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.tenant.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}
