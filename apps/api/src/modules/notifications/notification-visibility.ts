import type { Prisma } from "@prisma/client";
import {
  callLeadIds,
  notificationAnchor,
  notificationAnchorIds,
  notificationContactMap,
  redactNotification,
  type RedactableNotification,
} from "@metavchim/shared";
import { visibleContactIds } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import type { TenantTx } from "../../core/prisma.service";

/**
 * ‎**מי רואה איזו התראה — התנאי, והצנזורה שנדרשת אחריו.**
 *
 * ## ‏התנאי
 *
 * ‎`userId IS NULL OR userId = הנוכחי`. התראה אישית נראית לנמען
 * ‏בלבד; שורה בלי נמען היא **משרדית** ונראית לכולם.
 *
 * ‏הוא היה כתוב בארבעה מקומות — שלושה במסך ההתראות ואחד בזיכרון
 * ‏הסוכן — ואותה תבנית כבר נשברה כאן פעם אחת: תיקון עדכן שניים
 * ‏מתוך שלושה עותקים. כאן הוא נכתב פעם אחת.
 *
 * ## ‏ולמה לא די בתנאי
 *
 * ‏שורה נכתבת פעם אחת ונקראת לנצח, והכתיבה מצנזרת לפי ההרשאות של
 * ‏**רגע הכתיבה**. שלילת גישה, העברת בעלות ומחיקת כרטיס קורות
 * ‏אחריה. הכלל עצמו יושב ב-`@metavchim/shared` כי יש לו שלושה
 * ‏קוראים, ואחד מהם — סבב הוואטסאפ — רץ בתהליך העובד ואינו יכול
 * ‏לייבא מכאן.
 */

export function notificationVisibility(): Prisma.NotificationWhereInput {
  const ctx = TenantContext.current();
  return { tenantId: ctx.tenantId, OR: [{ userId: null }, { userId: ctx.userId }] };
}

/**
 * ‎**התראה שמצביעה על אדם — רק למי שרשאי לראות אותו.**
 *
 * ‏שורה בלי מצביע אינה נבדקת: אין בה עוגן, וממילא אין בה זהות. מי
 * ‏שרואה את כל הלקוחות אינו משלם ולו שאילתה אחת — וזו ברירת המחדל
 * ‏של כל תפקיד קיים, ולכן המסלול אינו נוגע במשרד שלא הפעיל הפרדה.
 *
 * ‏שאילתה אחת לכל סוג עוגן, ולא אחת לשורה.
 */
export async function redactUnauthorizedNotifications<T extends RedactableNotification>(
  tx: TenantTx,
  tenantId: string,
  rows: readonly T[],
): Promise<T[]> {
  if (!rows.some((row) => notificationAnchor(row) !== null)) return [...rows];
  const allowed = await visibleContactIds(tx, tenantId);
  if (allowed === null) return [...rows];
  const allowedSet = new Set(allowed);
  const { leadIds, buyerIds, callIds } = notificationAnchorIds(rows);
  const [buyers, calls] = await Promise.all([
    buyerIds.length === 0
      ? []
      : tx.buyer.findMany({
          where: { tenantId, id: { in: buyerIds } },
          select: { id: true, contactId: true },
        }),
    callIds.length === 0
      ? []
      : tx.call.findMany({
          where: { tenantId, id: { in: callIds } },
          select: { id: true, contactId: true, leadId: true },
        }),
  ]);
  /*
   * ‏הלידים נשלפים **אחרי** השיחות: שיחה ממספר לא מוכר נפתרת דרך
   * ‏הליד שלה, וליד כזה אינו עוגן בעצמו. שליפה במקביל הייתה
   * ‏מחמיצה אותו, וכל שיחה כזו הייתה נראית „בלי לקוח”.
   */
  const allLeadIds = [...new Set([...leadIds, ...callLeadIds(calls)])];
  const leads =
    allLeadIds.length === 0
      ? []
      : await tx.lead.findMany({
          where: { tenantId, id: { in: allLeadIds } },
          select: { id: true, contactId: true },
        });
  const contactOf = notificationContactMap(leads, buyers, calls);
  return rows.map((row) => redactNotification(row, allowedSet, contactOf));
}
