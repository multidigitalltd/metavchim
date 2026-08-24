import { ulid } from "ulid";
import type { TenantTx } from "../core/prisma.service";

/**
 * התראה שנכתבת **פעם אחת לאירוע**, גם כשהאירוע מגיע פעמיים.
 *
 * ## למה לא „לבדוק אם כבר קיימת”
 *
 * זו הייתה הגרסה הקודמת, והיא נכשלה בדיוק במקרה שבשבילו נכתבה:
 * הבדיקה חיפשה שורת **שיחה** עם אותו מזהה ספק, בזמן שהתראת הצלצול
 * נכתבת לפני שיש שיחה — שורת השיחה נוצרת רק באירוע המסיים. כלומר
 * התנאי חיפש רשומה שבנקודה הזו לעולם אינה קיימת, וכל `Calling`
 * חוזר מהמרכזייה ייצר התראה נוספת.
 *
 * ## למה `ON CONFLICT` ולא `try/catch`
 *
 * הכתיבה יושבת בתוך טרנזקציה שממשיכה אחריה (רישום השיחה, פתיחת
 * ליד, יצירת בקשת פרטים). ב-Postgres משפט שנכשל מבטל את **כל**
 * הטרנזקציה — `25P02` — ולכן `catch` על הפרת ייחודיות היה הופך
 * כפילות שקטה לקריסה של כל הקליטה. זהו הדפוס שכבר תועד כאן
 * ב-`property-twins.service.ts`, ומאותה סיבה.
 *
 * מחזירה `true` כשההתראה נכתבה, ו-`false` כשאירוע זהה כבר דווח.
 * `dedupeKey` מתאר את האירוע (`incoming_call:<callid>`) ולא את
 * הרשומה שהוא עתיד לייצר.
 */
export async function notifyOnce(
  tx: TenantTx,
  notification: {
    tenantId: string;
    dedupeKey: string;
    /** נמען ספציפי; `null` = כל המשרד */
    userId: string | null;
    type: string;
    title: string;
    body: string | null;
    entityType: string | null;
    entityId: string | null;
  },
): Promise<boolean> {
  const written = await tx.$executeRaw`
    INSERT INTO notifications
      (id, tenant_id, user_id, type, title, body, entity_type, entity_id, dedupe_key)
    VALUES (
      ${ulid()}::char(26),
      ${notification.tenantId}::char(26),
      ${notification.userId}::char(26),
      ${notification.type}::varchar(40),
      ${notification.title}::varchar(200),
      ${notification.body}::varchar(500),
      ${notification.entityType}::varchar(40),
      ${notification.entityId}::char(26),
      ${notification.dedupeKey}::varchar(120)
    )
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`;
  return written > 0;
}
