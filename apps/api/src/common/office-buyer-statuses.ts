import { officeStatuses, type OfficeBuyerStatus } from "@metavchim/shared";
import type { Prisma } from "@prisma/client";
import type { TenantTx } from "../core/prisma.service";

/**
 * ‎**רשימת הסטטוסים של המשרד — היכן היא יושבת ולמה.**
 *
 * ## למה ב-`tenants.settings` ולא בטבלה
 *
 * זו רשימה של עד עשרים שורות, נקראת בכל טעינת כרטיס ונכתבת פעם
 * בכמה חודשים. טבלה ייעודית הייתה מוסיפה מיגרציה, מדיניות RLS,
 * ניקוי במחיקת משרד, וגיבוי — כדי לשמור מה שכבר נשמר לצידה: כל
 * שאר הגדרות המשרד יושבות בדיוק שם.
 *
 * ## למה פונקציה ולא קריאה בכל אתר
 *
 * הקריאה היא **שני** דברים: שליפה, ופענוח סלחני של מה שנשמר
 * (`officeStatuses`). אתר שיעשה רק את הראשון יקבל `unknown` ויפרש
 * אותו בעצמו — וזה בדיוק המקום שבו רשומה פגומה אחת מפילה מסך.
 */
export const OFFICE_STATUS_SETTING_KEY = "buyerStatuses";

/**
 * ‎**חייב לרוץ בהקשר הדייר.** הקריאה מגבילה ל-`tenantId` במפורש כי
 * ‎`tenants` אינה טבלה עם RLS לפי דייר — היא הטבלה שמגדירה אותם.
 */
export async function readOfficeStatuses(
  tx: Pick<TenantTx, "tenant">,
  tenantId: string,
): Promise<OfficeBuyerStatus[]> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  return officeStatuses(settings[OFFICE_STATUS_SETTING_KEY]);
}

/**
 * כתיבה חוזרת של הרשימה בלבד, בלי לגעת בשאר ההגדרות.
 *
 * ‎**קריאה-שינוי-כתיבה על אותו אובייקט JSON**, ולכן היא חייבת לרוץ
 * בתוך אותה טרנזקציה שבה נקראה הרשימה: שתי עריכות מקבילות של
 * הגדרות שונות היו דורסות זו את זו.
 */
export async function writeOfficeStatuses(
  tx: Pick<TenantTx, "tenant">,
  tenantId: string,
  list: readonly OfficeBuyerStatus[],
): Promise<void> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>) };
  settings[OFFICE_STATUS_SETTING_KEY] = list as unknown as Prisma.InputJsonValue;
  await tx.tenant.update({
    where: { id: tenantId },
    data: { settings: settings as Prisma.InputJsonObject },
  });
}
