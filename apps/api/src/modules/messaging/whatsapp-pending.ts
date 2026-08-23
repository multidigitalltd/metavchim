import type { Prisma } from "@prisma/client";
import type { TenantTx } from "../../core/prisma.service";

/**
 * צריכה והחלפה של ההצעה הממתינה בצ'אט הוואטסאפ — **ה-SQL עצמו.**
 *
 * ## למה זה יצא מהשירות לקובץ משלו
 *
 * שתי השאילתות האלה הן כל מנגנון האטומיות של הסוכן: הן מה שמבטיח
 * ש„אשר” יבצע פעם אחת בדיוק. הן היו כתובות בתוך `converse`, ולכן
 * אי אפשר היה לבדוק אותן בלי להרים את כל השירות על תלויותיו — וכך
 * באג ש**ביטל את הביצוע לחלוטין** חי בייצור בלי שאף בדיקה נגעה בו.
 * כאן הן ניתנות להרצה מול מסד אמיתי (`whatsapp-pending.int.test.ts`).
 *
 * ## הבאג שהיה כאן
 *
 * ```sql
 * UPDATE whatsapp_chats SET pending = NULL ... RETURNING pending
 * ```
 *
 * ב-PostgreSQL `RETURNING` מחזיר את הערך **החדש** של השורה, לא את
 * הישן (`RETURNING OLD` קיים רק מגרסה 18; אנחנו על 16). כלומר
 * השאילתה החזירה תמיד `NULL` — בדיוק הערך שהיא זה עתה כתבה.
 *
 * התוצאה בייצור: כל לחיצה על „אשר” רוקנה את ההצעה ואז דיווחה
 * „הפעולה כבר בוצעה או בוטלה — אין הצעה ממתינה”, והפעולה **מעולם
 * לא בוצעה**. המשימה לא נוצרה, הנכס לא נוצר, והסוכן נראה כמי
 * שמבטיח ולא מקיים (דיווח המשתמש).
 *
 * ## איך זה נכון עכשיו
 *
 * שתי פסוקיות `WITH` באותה שאילתה: `before` קוראת את ההצעה מצילום
 * תחילת המשפט, ו-`taken` מרוקנת אותה. שתיהן נושאות את **אותו תנאי**
 * כולל החותם — וזה מה ששומר על האטומיות: תחת `READ COMMITTED`
 * המפסיד בתחרות ממתין לנעילה, מעריך את התנאי מחדש על השורה
 * המעודכנת, מוצא `pending IS NULL` ואינו מעדכן דבר. `taken` שלו
 * ריקה, ולכן ה-`SELECT` הסופי אינו מחזיר שורה והוא מקבל `null`.
 *
 * לצמצם את `taken` ל-`WHERE c.id = b.id` בלבד היה שובר בדיוק את זה:
 * שני המסלולים היו מוצאים את השורה לפי מזהה, ושניהם היו מבצעים.
 */

/** ההצעה כפי שהיא נשמרת ב-JSON. הטיפוס המלא חי בשירות. */
export type PendingRow = Record<string, unknown>;

/**
 * מרוקנת את ההצעה הממתינה ומחזירה אותה כפי שהייתה, או `null` כשאין
 * מה לרוקן — הצעה שכבר נצרכה, או שהוחלפה באחרת.
 *
 * `expectToken` חלק מתנאי ה-UPDATE ולא בדיקה שקדמה לו: השוואה מול
 * צילום שנקרא קודם אינה מספיקה, כי בין הצילום לצריכה מסלול מקביל
 * יכול להחליף את ההצעה — ואז „אשר” להצעה א׳ היה מבצע את הצעה ב׳.
 *
 * בלי חותם — הצעה שנשמרה לפני שהחותמים נכנסו — נשמרת ההתנהגות
 * הישנה, אחרת אישור להצעה כזו לא היה מתבצע לעולם.
 */
export async function takePendingRow(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  expectToken?: string,
): Promise<PendingRow | null> {
  const rows =
    expectToken === undefined
      ? await tx.$queryRaw<{ pending: unknown }[]>`
          WITH before AS (
            SELECT pending FROM whatsapp_chats
             WHERE tenant_id = ${tenantId} AND user_id = ${userId}
               AND pending IS NOT NULL
          ), taken AS (
            UPDATE whatsapp_chats SET pending = NULL, updated_at = now()
             WHERE tenant_id = ${tenantId} AND user_id = ${userId}
               AND pending IS NOT NULL
            RETURNING id
          )
          SELECT (SELECT pending FROM before) AS pending FROM taken`
      : await tx.$queryRaw<{ pending: unknown }[]>`
          WITH before AS (
            SELECT pending FROM whatsapp_chats
             WHERE tenant_id = ${tenantId} AND user_id = ${userId}
               AND pending IS NOT NULL AND pending->>'token' = ${expectToken}
          ), taken AS (
            UPDATE whatsapp_chats SET pending = NULL, updated_at = now()
             WHERE tenant_id = ${tenantId} AND user_id = ${userId}
               AND pending IS NOT NULL AND pending->>'token' = ${expectToken}
            RETURNING id
          )
          SELECT (SELECT pending FROM before) AS pending FROM taken`;
  const value = rows[0]?.pending;
  return value === undefined || value === null ? null : (value as PendingRow);
}

/**
 * החלפת ההצעה הממתינה באחרת — מותנית בחותם הישן.
 *
 * אותו כלל של `takePendingRow`, לצד השני: מי שמקדם הצעה מקדם את
 * *ההצעה שהוא ראה*, ולא את מה שמסלול מקביל הספיק לשים במקומה.
 * `false` = ההצעה הוחלפה, ואין מה לקדם.
 *
 * כאן `RETURNING id` נכון: המזהה אינו משתנה בעדכון, ולכן „הערך
 * החדש” ו„הערך הישן” הם אותו דבר. זה מה שהסתיר את הבאג בשכנה.
 */
export async function advancePendingRow(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  expectToken: string | undefined,
  next: Prisma.InputJsonValue,
): Promise<boolean> {
  const rows =
    expectToken === undefined
      ? await tx.$queryRaw<{ id: string }[]>`
          UPDATE whatsapp_chats SET pending = ${next}, updated_at = now()
           WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND pending IS NOT NULL
          RETURNING id`
      : await tx.$queryRaw<{ id: string }[]>`
          UPDATE whatsapp_chats SET pending = ${next}, updated_at = now()
           WHERE tenant_id = ${tenantId} AND user_id = ${userId}
             AND pending IS NOT NULL AND pending->>'token' = ${expectToken}
          RETURNING id`;
  return rows.length > 0;
}
