import { incomingCallTitle, missedCallTitle } from "./telephony.js";

/**
 * ‎**מה נשאר מהתראה כשהצופה אינו רשאי לראות את מי שהיא מדברת עליו.**
 *
 * ## ‏למה בקריאה, ולמה כאן
 *
 * ‏שורת התראה נכתבת פעם אחת ונקראת לנצח. הכתיבה כבר מצנזרת לפי
 * ‏ההרשאות **של רגע הכתיבה**, וזה אינו מספיק: מנהל ששולל גישה
 * ‏מסוכן, מעביר בעלות על כרטיס, או שכרטיס נמחק — כל אלה קורים
 * ‏אחרי. הגבול נאכף בקריאה, שם הוא נשאל ממילא בכל פעם מחדש.
 *
 * ‏והמודול הזה משותף כי יש **שלושה** קוראים ולא אחד: מסך ההתראות,
 * ‏זיכרון העוזר, וסבב הוואטסאפ שרץ בתהליך העובד. העובד אינו יכול
 * ‏לייבא מה-API, ולכן צנזורה שיושבת שם לבדה משאירה את ערוץ הדחיפה
 * ‏פתוח לרווחה (ביקורת Codex, P1).
 */

/**
 * ‎**המצביעים שמובילים לאדם.**
 *
 * ‎`call` נמצא כאן ולא בגלל שהוא כרטיס לקוח: התראת „השיחה
 * ‏תומללה” נושאת בגוף שלה את תמצית השיחה, והיא נכתבת ברמת המשרד
 * ‏(העובד מתמלל, אין לו `createdBy`). בלי המצביע הזה סוכן מוגבל
 * ‏קיבל את התמצית של שיחה עם לקוח שהוסתר ממנו (ביקורת Codex, P1).
 *
 * ‎„נכס” אינו כאן — הוא אינו כרטיס לקוח, והגישה אליו נבחנת
 * ‏בשאלה אחרת.
 */
export const NOTIFICATION_CONTACT_ANCHORS = ["contact", "lead", "buyer", "call"] as const;

export type NotificationAnchorKind = (typeof NOTIFICATION_CONTACT_ANCHORS)[number];

export interface RedactableNotification {
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface NotificationAnchor {
  kind: NotificationAnchorKind;
  id: string;
}

/** ‏העוגן שהשורה תלויה בו, או `null` כשאין לה כזה. */
export function notificationAnchor(row: RedactableNotification): NotificationAnchor | null {
  const { entityType, entityId } = row;
  if (entityType === null || entityId === null) return null;
  return (NOTIFICATION_CONTACT_ANCHORS as readonly string[]).includes(entityType)
    ? { kind: entityType as NotificationAnchorKind, id: entityId }
    : null;
}

/** ‏מפתח המפה: „סוג:מזהה”, כדי ששני סוגים לא יתנגשו על אותו מזהה. */
export function anchorKey(anchor: NotificationAnchor): string {
  return `${anchor.kind}:${anchor.id}`;
}

/** ‏הלידים שהשיחות מצביעות אליהם — הסיבוב השני של הפענוח. */
export function callLeadIds(
  calls: readonly { leadId: string | null }[],
): string[] {
  return [...new Set(calls.map((row) => row.leadId).filter((id): id is string => id !== null))];
}

/** ‏המזהים שצריך לפתור, מקובצים לפי סוג — שאילתה לכל סוג, לא לשורה. */
export function notificationAnchorIds(rows: readonly RedactableNotification[]): {
  leadIds: string[];
  buyerIds: string[];
  callIds: string[];
} {
  const of = (kind: NotificationAnchorKind): string[] => [
    ...new Set(
      rows
        .map((row) => notificationAnchor(row))
        .filter((anchor): anchor is NotificationAnchor => anchor?.kind === kind)
        .map((anchor) => anchor.id),
    ),
  ];
  return { leadIds: of("lead"), buyerIds: of("buyer"), callIds: of("call") };
}

/**
 * ‏המפה מעוגן לאיש קשר, מתוך השורות שנשלפו.
 *
 * ‎`call` נפתר קודם דרך `contactId` שלו, ואם אין — דרך הליד שלו:
 * ‏שיחה ממספר לא מוכר פותחת **ליד** ולא לקוח, וזה בדיוק המקרה
 * ‏שהתראת התמלול נכתבת עליו.
 *
 * ‎**ולכן `leads` חייב לכלול גם את הלידים שהשיחות מצביעות אליהם**,
 * ‏ולא רק את אלה שהם עוגן בעצמם. בלי זה כל שיחה שנפתרת דרך ליד
 * ‏נראית „בלי לקוח” — כלומר מצונזרת גם לסוכן שהיא שלו.
 * ‎`callLeadIds` הוא מה שהקורא צריך לשלוף כדי שזה יתקיים.
 */
export function notificationContactMap(
  leads: readonly { id: string; contactId: string | null }[],
  buyers: readonly { id: string; contactId: string | null }[],
  calls: readonly { id: string; contactId: string | null; leadId: string | null }[],
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const leadContact = new Map(leads.map((row) => [row.id, row.contactId]));
  for (const row of leads) map.set(`lead:${row.id}`, row.contactId);
  for (const row of buyers) map.set(`buyer:${row.id}`, row.contactId);
  for (const row of calls) {
    map.set(
      `call:${row.id}`,
      row.contactId ?? (row.leadId === null ? null : (leadContact.get(row.leadId) ?? null)),
    );
  }
  return map;
}

/**
 * ‎**הכותרת שנשארת כשאין הרשאה לתוכן.**
 *
 * ‏אותן כותרות בדיוק שהכתיבה מייצרת כשהיא מצנזרת מראש, ובדיקה
 * ‏אוכפת את השוויון — אחרת אלה שני ניסוחים של „איך נראית התראה
 * ‏בלי זהות”, ושורה ישנה ושורה חדשה ייראו שונה באותו מסך.
 *
 * ‎**וסוג שאינו בטבלה מקבל את הנוסח הכללי.** זו ברירת המחדל
 * ‏הזהירה: סוג חדש שיישכח כאן יאבד את הכותרת שלו למי שאינו רשאי,
 * ‏במקום לדלוף.
 */
const PUBLIC_TITLES: Record<string, string> = {
  incoming_call: incomingCallTitle(null, null),
  call_missed: missedCallTitle(null, null),
};

export const GENERIC_PUBLIC_TITLE = "התראה חדשה";

export function publicNotificationTitle(type: string): string {
  return PUBLIC_TITLES[type] ?? GENERIC_PUBLIC_TITLE;
}

/**
 * ‎**שורה אחת, מול צופה אחד.**
 *
 * ‎`allowed === null` = הצופה רואה כל לקוח במשרד, ואין מה לסנן.
 *
 * ‎**וגם שורה אישית נבדקת** (ביקורת Codex, P1). הניסוח הראשון פטר
 * ‏אותה — „היא הגיעה לנמען שלה, וזה כבר התנאי” — וזה בלבל בין „היה
 * ‏מיועד לך אז” לבין „מותר לך עכשיו". אחרי העברת בעלות על הכרטיס,
 * ‏או שלילת המודול מהנמען, ההתראה הישנה נשארה פתוחה עם השם,
 * ‏הטלפון וקישור הטופס נושא־האסימון — בזמן שכל נתיב אחר לאותו אדם
 * ‏כבר דוחה אותו. כל שאר השערים בקוד הזה שואלים את השאלה **בהווה**;
 * ‏זה היה היחיד שלא.
 *
 * ‎**וכרטיס שנעלם מצונזר גם הוא**: מצביע שאינו מוביל עוד לאדם הוא
 * ‏בדיוק השורה שאי אפשר לבדוק, ולא שורה בטוחה.
 */
export function redactNotification<T extends RedactableNotification>(
  row: T,
  allowed: ReadonlySet<string> | null,
  contactOf: ReadonlyMap<string, string | null>,
): T {
  if (allowed === null) return row;
  const anchor = notificationAnchor(row);
  if (anchor === null) return row;
  const contactId = anchor.kind === "contact" ? anchor.id : (contactOf.get(anchorKey(anchor)) ?? null);
  if (contactId !== null && allowed.has(contactId)) return row;
  return {
    ...row,
    title: publicNotificationTitle(row.type),
    body: null,
    entityType: null,
    entityId: null,
  };
}
