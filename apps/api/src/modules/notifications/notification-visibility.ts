import type { Prisma } from "@prisma/client";
import { incomingCallTitle, missedCallTitle } from "@metavchim/shared";
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
 * ‎**שורה משרדית נכתבה כשהלקוח היה גלוי לכל המשרד** (ביקורת Codex,
 * ‏P1). כשמנהל שולל אחר כך `properties.view_all` מסוכן, הכתיבה
 * ‏מצנזרת מאותו רגע והלאה — והשורות **שכבר במסד** ממשיכות לשאת את
 * ‏שם הלקוח, את הטלפון, את המצביע, ולעיתים גם קישור טופס נושא־אסימון.
 * ‏`visible()` החזירה אותן כמות שהן לכל אנשי המשרד.
 *
 * ‏מיגרציה שמוחקת או משכתבת שורות ברגע השלילה הייתה **ביטוי שני**
 * ‏של אותו כלל: היא הייתה צריכה לרוץ מחדש בכל שינוי הרשאה, בכל
 * ‏העברת בעלות ובכל מחיקת כרטיס — ולפספס באחד מהם. הגבול נאכף
 * ‏בקריאה, שם הוא נשאל ממילא בכל פעם מחדש.
 *
 * ‏שורה משרדית **שנכתבה מצונזרת** אינה נושאת מצביע כלל, ולכן היא
 * ‏עוברת כאן בלי לגעת בה: אין בה למה לעגן את השאלה, ואין בה מה
 * ‏להסתיר.
 */

export function notificationVisibility(): Prisma.NotificationWhereInput {
  const ctx = TenantContext.current();
  return { tenantId: ctx.tenantId, OR: [{ userId: null }, { userId: ctx.userId }] };
}

/**
 * ‎**הכותרת שנשארת כשאין הרשאה לתוכן.**
 *
 * ‏אותן כותרות בדיוק שהכתיבה מייצרת כשהיא מצנזרת מראש
 * ‏(`publicNotification(true, …)`), ולכן שורה ישנה ושורה חדשה
 * ‏נראות זהות במסך — ובדיקה אוכפת את השוויון הזה, אחרת אלה שני
 * ‏ניסוחים של „איך נראית התראה בלי זהות”.
 *
 * ‎**וסוג שאינו בטבלה מקבל את הנוסח הכללי.** זו ברירת המחדל
 * ‏הזהירה: סוג חדש שיישכח כאן יאבד את הכותרת שלו למי שאינו רשאי,
 * ‏במקום לדלוף.
 */
const PUBLIC_TITLES: Record<string, string> = {
  incoming_call: incomingCallTitle(null, null),
  call_missed: missedCallTitle(null, null),
};

export function publicNotificationTitle(type: string): string {
  return PUBLIC_TITLES[type] ?? "התראה חדשה";
}

/**
 * ‏השדות שהצנזורה נוגעת בהם. כל קורא שולף את כולם — גם זיכרון
 * ‏הסוכן, שמשתמש במצביע בלבד — כדי שתהיה **צורה אחת** שעוברת
 * ‏בשער, ולא שתי דרכים לקרוא התראה.
 */
export interface RedactableNotification {
  userId: string | null;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

/** ‏המצביעים שמובילים לאדם. „נכס” אינו כאן — הוא אינו כרטיס לקוח. */
const CONTACT_ANCHORS = new Set(["contact", "lead", "buyer"]);

/**
 * ‎**התראה משרדית שמצביעה על אדם — רק למי שרשאי לראות אותו.**
 *
 * ‏שורה אישית אינה נבדקת: היא הגיעה לנמען שלה, וזה כבר התנאי.
 * ‏שורה משרדית בלי מצביע אינה נבדקת: אין בה עוגן, וממילא אין בה
 * ‏זהות. מה שנבדק הוא בדיוק החתך שדלף.
 *
 * ‏מי שרואה את כל הלקוחות (`visibleContactIds` מחזירה `null`) אינו
 * ‏משלם ולו שאילתה אחת — וזו ברירת המחדל של כל תפקיד קיים, ולכן
 * ‏המסלול הזה אינו נוגע במשרד שלא הפעיל הפרדה.
 */
export async function redactUnauthorizedNotifications<T extends RedactableNotification>(
  tx: TenantTx,
  tenantId: string,
  rows: readonly T[],
): Promise<T[]> {
  const anchored = rows.filter(
    (row) =>
      row.userId === null &&
      row.entityId !== null &&
      row.entityType !== null &&
      CONTACT_ANCHORS.has(row.entityType),
  );
  if (anchored.length === 0) return [...rows];

  const allowed = await visibleContactIds(tx, tenantId);
  if (allowed === null) return [...rows];
  const allowedSet = new Set(allowed);

  /*
   * ‏המצביע אינו תמיד מזהה לקוח: „ליד” ו„קונה” הם כרטיסים שמובילים
   * ‏אליו. שתי שאילתות לכל הרשימה, ולא אחת לשורה.
   */
  const idsOf = (kind: string): string[] => [
    ...new Set(
      anchored.filter((row) => row.entityType === kind).map((row) => row.entityId as string),
    ),
  ];
  const leadIds = idsOf("lead");
  const buyerIds = idsOf("buyer");
  const [leads, buyers] = await Promise.all([
    leadIds.length === 0
      ? []
      : tx.lead.findMany({
          where: { tenantId, id: { in: leadIds } },
          select: { id: true, contactId: true },
        }),
    buyerIds.length === 0
      ? []
      : tx.buyer.findMany({
          where: { tenantId, id: { in: buyerIds } },
          select: { id: true, contactId: true },
        }),
  ]);
  const contactOf = new Map<string, string | null>();
  for (const row of leads) contactOf.set(`lead:${row.id}`, row.contactId);
  for (const row of buyers) contactOf.set(`buyer:${row.id}`, row.contactId);

  return rows.map((row) => {
    if (row.userId !== null || row.entityId === null || row.entityType === null) return row;
    if (!CONTACT_ANCHORS.has(row.entityType)) return row;
    const contactId =
      row.entityType === "contact"
        ? row.entityId
        : (contactOf.get(`${row.entityType}:${row.entityId}`) ?? null);
    /*
     * ‎**כרטיס שנעלם מצונזר גם הוא.** שורה שהמצביע שלה אינו מוביל
     * ‏עוד לאדם אינה „בטוחה” — היא בדיוק השורה שאי אפשר לבדוק,
     * ‏והכותרת שלה נשארה מלאה.
     */
    if (contactId !== null && allowedSet.has(contactId)) return row;
    return {
      ...row,
      title: publicNotificationTitle(row.type),
      body: null,
      entityType: null,
      entityId: null,
    };
  });
}
