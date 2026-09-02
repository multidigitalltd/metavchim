import { BadRequestException } from "@nestjs/common";

import type { TenantTx } from "../core/prisma.service";

/**
 * ‎**„של מי הכרטיס הזה?” — שם הסוכן, לשלושת סוגי הכרטיסים.**
 *
 * ## הבעיה
 *
 * לליד ולקונה כבר היה סוכן משויך במסד (`assignedToUserId`,
 * ‎`ownerUserId`), ולנכס לא היה כלל. בשלושת המקרים **אף מסך לא הציג
 * את זה** — כלומר במשרד עם כמה סוכנים, השאלה הראשונה שמנהל שואל על
 * כרטיס לא הייתה לה תשובה בשום מקום במערכת.
 *
 * ## למה פונקציה אחת ולא שליפה בכל שירות
 *
 * שלוש שליפות שאמורות להסכים הן שלוש שליפות שיפסיקו להסכים — אחת
 * תסנן משתמשים לא פעילים והשנייה לא, אחת תשלוף לכל שורה והשנייה
 * תאגד. וחשוב מזה: **שאילתה אחת לכל העמוד**. שליפת שם לכל שורה היא
 * N+1 שמתגלה רק כשלמשרד יש מאה נכסים.
 *
 * ## סוכן שאינו פעיל עוד
 *
 * ‎**נשלף בכל זאת.** הכרטיס שויך למי שכבר עזב, וזו עובדה היסטורית
 * שהמנהל צריך לראות — „לא משויך” על נכס שכן שויך היה מסתיר בדיוק
 * את מה שהוא מחפש: כרטיסים שנשארו בלי מטפל אחרי שסוכן עזב.
 */
export async function agentNames(
  tx: TenantTx,
  tenantId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))];
  if (unique.length === 0) return new Map();
  const rows = await tx.user.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * שם הסוכן לכרטיס אחד, לפי המפה שכבר נשלפה.
 *
 * ‎`undefined` = לא משויך, **או** משויך למי שאינו בטבלה עוד. המסך
 * אומר „לא משויך” בשני המקרים ואינו ממציא שם.
 */
export function agentNameOf(
  names: Map<string, string>,
  id: string | null | undefined,
): string | undefined {
  return id === null || id === undefined ? undefined : names.get(id);
}

/**
 * ‎**שיוך לאדם שאינו במשרד — נדחה בשרת, לא רק בבורר.**
 *
 * הבורר במסך מציג את אנשי המשרד, אבל הוא רשימה שנשלחה פעם אחת: מי
 * שעזב באמצע נשאר בה, ובקשה ישירה ל-API אינה עוברת דרכו כלל. בלי
 * הבדיקה הזו אפשר לשייך נכס לכל מזהה שהוא — כולל של משרד אחר, שאותו
 * ה-RLS אמנם מסתיר מקריאה, אבל כאן היה נכתב לעמודה בשקט.
 *
 * ‎`isActive` **אינו** נבדק: שיוך למי שהושבת זה עתה הוא מצב לגיטימי
 * שהמנהל מסדר אחר כך, ולא קלט שגוי.
 */
export async function assertAgentInOffice(
  tx: TenantTx,
  tenantId: string,
  agentUserId: string,
): Promise<void> {
  const found = await tx.user.findFirst({
    where: { tenantId, id: agentUserId },
    select: { id: true },
  });
  if (found === null) {
    throw new BadRequestException("הסוכן שנבחר אינו במשרד הזה");
  }
}
