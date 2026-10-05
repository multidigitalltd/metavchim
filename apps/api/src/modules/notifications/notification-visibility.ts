import type { Prisma } from "@prisma/client";
import {
  callLeadIds,
  notificationAnchor,
  notificationAnchorIds,
  notificationSubjectMap,
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
  const ctx = TenantContext.current();
  const allowed = await visibleContactIds(tx, tenantId);
  /*
   * ‎**גם למי שרואה את כל הלקוחות** (ביקורת Codex, P1): הבעלות על
   * ‏כרטיס מצמצמת, ולא רק שער הלקוח. בפועל מי שמחזיק את כל
   * ‏הלקוחות מחזיק גם `leads.view_all` ו-`buyers.view_all`, ולכן
   * ‏הוא עובר — אבל הכלל אינו נשען על הצירוף הזה.
   */
  const viewer = {
    allowed: allowed === null ? null : new Set(allowed),
    userId: ctx.userId,
    capabilities: ctx.capabilities,
  };
  const { leadIds, buyerIds, callIds } = notificationAnchorIds(rows);
  const [buyers, calls] = await Promise.all([
    buyerIds.length === 0
      ? []
      : tx.buyer.findMany({
          /*
           * ‎**כרטיס שהועבר לארכיון אינו נושא חי** (ביקורת Codex, P2).
           *
           * ‏`BuyersService.archive` מסמן `deletedAt` בלבד, וכל קריאה
           * ‏רגילה של קונה דורשת `deletedAt: null`. השליפה הזו לא, ולכן
           * ‏הכרטיס הארכיוני נפתר כנושא חי: אם הבעלים הקודם עדיין רואה
           * ‏את הלקוח דרך ליד או נכס אחר, האיחוד מאשר — והכותרת,
           * ‏התמצית והקישור המת של הקונה שורדים במקום להיצנזר.
           *
           * ‏„לא נמצא” הוא בדיוק המצב ש-`redactNotification` כבר יודע
           * ‏לטפל בו: עוגן שאינו נפתר מצונזר, ולא מוחזק כשורה בטוחה.
           */
          where: { tenantId, id: { in: buyerIds }, deletedAt: null },
          select: { id: true, contactId: true, ownerUserId: true },
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
          select: { id: true, contactId: true, assignedToUserId: true },
        });
  const subjects = notificationSubjectMap(leads, buyers, calls);
  return rows.map((row) => redactNotification(row, viewer, subjects));
}
