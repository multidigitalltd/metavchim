import type { Prisma } from "@prisma/client";
import type { TenantTx } from "../core/prisma.service";

/**
 * מחיקת חדרי עסקה שאיבדו את מה שהם עומדים עליו.
 *
 * ## למה פונקציה משותפת ולא שלוש
 *
 * חדר עסקה נמחק בשלושה מסלולים שונים — מחיקת קונה, מחיקת נכס
 * ומחיקת לקוח (זכות המחיקה) — ובכל אחד מהם צריך לקרות בדיוק אותו
 * דבר, ובאותו סדר. שלוש גרסאות היו נפרדות ביום שמישהו מוסיף טבלה
 * נלווית, וזו בדיוק הצורה שבה מחיקה מפסיקה להיות מחיקה.
 *
 * ## הסדר אינו נוחות
 *
 * `coop_deal_messages` מוחקת דרך פוליסת ה-DELETE שנגזרת מהחדר עצמו
 * (`EXISTS` על `coop_deals`). אחרי שהחדר נמחק אין שורה שממנה
 * הפוליסה תאשר, וה-`deleteMany` על השרשור היה מוחק אפס שורות
 * **בשקט** — תחת FORCE RLS זו התוצאה, לא שגיאה. לכן השרשור קודם.
 *
 * ## למה בכלל למחוק את החדר אצל שני הצדדים
 *
 * אותו נימוק שכבר הוכרע בהצעות ובפרסומים: חדר שנשאר חי אצל המשרד
 * השני הוא התכתבות על נכס או קונה שכבר אינם קיימים, ומי שנכנס
 * אליו מקבל „הנכס כבר אינו במאגר” בלי לדעת למה. מחיקה שאינה שלמה
 * אינה מחיקה.
 */
export async function deleteCoopDeals(
  tx: TenantTx,
  where: Prisma.CoopDealWhereInput,
): Promise<void> {
  const deals = await tx.coopDeal.findMany({ where, select: { id: true } });
  if (deals.length === 0) return;
  const ids = deals.map((deal) => deal.id);
  await tx.coopDealMessage.deleteMany({ where: { dealId: { in: ids } } });
  await tx.coopDeal.deleteMany({ where: { id: { in: ids } } });
}
