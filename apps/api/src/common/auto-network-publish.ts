import { HttpException } from "@nestjs/common";
import type { Logger } from "@nestjs/common";
import type { PrismaService, TenantTx } from "../core/prisma.service";
import { notifyOnce } from "./notify-once";
import { TenantContext } from "./tenant-context";

/**
 * ‎**הפרסום האוטומטי לרשת — ומה קורה כשהוא לא יוצא לפועל.**
 *
 * ## הכשל שהמודול הזה בא לסגור
 *
 * שני המסלולים (נכס חדש, קונה חדש) נכתבו כ-best-effort, וזה נכון:
 * מכסת רשת שהתמלאה או קונה בלי אזור חיפוש אינם „יצירת הכרטיס
 * נכשלה”, והכרטיס אכן נשמר. אבל ה-best-effort מומש כ-`catch {}`
 * ריק — בלי לוג, בלי התראה, בלי סימן.
 *
 * ‏התוצאה היא המצב שדווח: המשרד מדליק את המתג בלשונית האוטומציות,
 * פותח עשרה כרטיסים, ולא רואה אף אחד מהם ברשת. אין לו דרך לדעת
 * אם המתג לא נשמר, אם הפרסום נחסם, או אם הוא בכלל רץ — **וגם
 * למי שקורא את הלוגים אין**. אוטומציה שנכשלת בשקט אינה ניתנת
 * להבחנה מאוטומציה שאינה קיימת.
 *
 * ## שני הערוצים, ולמה שניהם
 *
 * ‎`logger.warn` נותן את הסיבה המלאה למי שמתחזק את המערכת.
 * ההתראה נותנת לסוכן את מה שהוא יכול לעשות איתו משהו: היא נושאת
 * את הכרטיס עצמו (`entityType`/`entityId`), כלומר לחיצה עליה
 * פותחת אותו — ושם כפתור הפרסום הידני.
 *
 * ‎`notifyOnce` ולא כתיבה ישירה: המפתח הוא הכרטיס, ולכן ניסיון
 * חוזר על אותו כרטיס אינו מייצר שורה שנייה.
 *
 * ## למה רק `HttpException` מגיעה לגוף ההתראה
 *
 * שגיאות ה-`BadRequest` כאן הן **סירובים מנוסחים שלנו** בעברית
 * („הקונה כבר משותף ברשת”, „לא ניתן לפרסם קונה בלי אזור חיפוש”)
 * — בדיוק מה שהסוכן צריך לקרוא. כל שאר השגיאות (Prisma, רשת)
 * נושאות טקסט שאיש לא ניסח, ושעלול לשאת ערכים מתוך השורה. הן
 * נרשמות ללוג במלואן ומגיעות למסך כ„שגיאה זמנית”.
 *
 * ## מקום אחד לשני הסוגים
 *
 * הנכס והקונה קראו לאותה לוגיקה בשני עותקים — קריאת ההגדרה,
 * הבדיקה, ה-`catch`. עותק אחד שמתוקן והשני לא הוא בדיוק איך
 * שמסלול אחד מקבל את הנראות והשני נשאר אילם.
 */

export type AutoNetworkKind = "property" | "buyer";

interface KindSpec {
  /** המפתח ב-`tenant.settings` שהמתג בלשונית האוטומציות כותב. */
  setting: string;
  /** הישות שההתראה מצביעה עליה — הכרטיס שממנו מפרסמים ידנית. */
  entityType: string;
  title: string;
  /**
   * ‎**האם הכרטיס מפורסם בפועל** — נשאל רק אחרי כשל.
   *
   * ‏שני מסלולי הפרסום מסיימים את הטרנזקציה ורק אחריה שולפים את
   * ‏ה-DTO (`getListing`/`getDemand`). כלומר שאילתה שנופלת **אחרי**
   * ‏השמירה מגיעה לכאן כ„כשל”, בזמן שהמודעה כבר חיה ברשת —
   * ‏וההתראה הייתה שולחת את הסוכן לפרסם ידנית כרטיס שכבר מפורסם,
   * ‏שם הוא מקבל „כבר מפורסם ברשת” ומאבד אמון בשתי ההודעות
   * ‏(ביקורת Codex).
   *
   * ‏הבדיקה היא על המצב עצמו ולא על סוג השגיאה: היא נכונה גם
   * ‏לכשלים שטרם ראינו.
   */
  published: (tx: TenantTx, tenantId: string, entityId: string) => Promise<number>;
}

const SPECS: Record<AutoNetworkKind, KindSpec> = {
  property: {
    setting: "autoShareProperties",
    entityType: "property",
    title: "הנכס לא פורסם אוטומטית לרשת",
    published: (tx, tenantId, entityId) =>
      tx.sharedListing.count({
        where: { tenantId, originPropertyId: entityId, status: "active" },
      }),
  },
  buyer: {
    setting: "autoShareBuyers",
    entityType: "buyer",
    title: "הקונה לא פורסם אוטומטית לרשת",
    published: (tx, tenantId, entityId) =>
      tx.sharedDemand.count({
        where: { tenantId, originBuyerId: entityId, status: "active" },
      }),
  },
};

/** ‏סוג ההתראה — רשום ב-`TYPE_CATEGORY` תחת „רשת”. */
export const AUTO_NETWORK_FAILED_TYPE = "network_autopublish_failed";

const FALLBACK_REASON = "שגיאה זמנית";

/** ‏ראו „למה רק `HttpException`” למעלה. */
function reasonOf(error: unknown): string {
  if (!(error instanceof HttpException)) return FALLBACK_REASON;
  const response: unknown = error.getResponse();
  const message =
    typeof response === "string"
      ? response
      : (response as { message?: unknown }).message;
  return typeof message === "string" && message.trim() !== ""
    ? message.trim()
    : FALLBACK_REASON;
}

/**
 * מריץ את הפרסום כשהמשרד ביקש אותו, ומדווח כשהוא לא יצא לפועל.
 *
 * ‎`publish` נמסרת כפונקציה ולא כשירות: הנכס מפרסם דרך
 * ‎`ListingsService` והקונה דרך `CollaborationService`, ותלות של
 * המודול הזה בשניהם הייתה הופכת עוזר לצומת.
 */
export async function autoNetworkPublish(
  deps: { prisma: PrismaService; logger: Logger },
  kind: AutoNetworkKind,
  entityId: string,
  publish: () => Promise<unknown>,
): Promise<void> {
  const spec = SPECS[kind];
  const { tenantId, userId } = TenantContext.current();
  const tenant = await deps.prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
  if (settings[spec.setting] !== true) return;

  try {
    await publish();
    return;
  } catch (error: unknown) {
    deps.logger.warn(
      `auto network publish failed for ${kind} ${entityId}: ${String(error)}`,
    );
    /*
     * ‎**השמירה אולי כן עברה** — ראו `published` למעלה. גם הבדיקה
     * ‏הזו עלולה ליפול (אותו מסד שנפל הרגע), ואז נשארת ההתנהגות
     * ‏הזהירה: מדווחים על כשל. „לא פורסם” שגוי הוא הטרדה; „פורסם”
     * ‏שגוי הוא מודעה חיה שאיש אינו יודע עליה.
     */
    try {
      const live = await deps.prisma.withTenant((tx) =>
        spec.published(tx, tenantId, entityId),
      );
      if (live > 0) {
        deps.logger.warn(
          `auto network publish for ${kind} ${entityId} committed; only the read-back failed`,
        );
        return;
      }
    } catch (probeError: unknown) {
      deps.logger.warn(
        `auto network publish probe failed for ${kind} ${entityId}: ${String(probeError)}`,
      );
    }
    /*
     * ‎**ההתראה עצמה היא best-effort.** הכרטיס כבר נשמר, והכשלת
     * היצירה בגלל שורת התראה הייתה הופכת תקלה בדיווח לתקלה בנתונים.
     */
    try {
      await deps.prisma.withTenant((tx) =>
        notifyOnce(tx, {
          tenantId,
          dedupeKey: `${AUTO_NETWORK_FAILED_TYPE}:${entityId}`,
          /*
           * ‎**מחרוזת ריקה אינה מזהה** — `officeContext` מציב
           * ‏אותה כשאין „מי עשה” (סורק, עובד רקע), ו-`char(26)`
           * ‏היה מרפד אותה ברווחים לשורה שאיש לא יראה. ריק =
           * ‏התראה לכל המשרד, וזו גם התשובה הנכונה: אין סוכן
           * ‏אחד שפתח את הכרטיס.
           */
          userId: userId === "" ? null : userId,
          type: AUTO_NETWORK_FAILED_TYPE,
          title: spec.title,
          body: `${reasonOf(error)}. הכרטיס נשמר — אפשר לפרסם ידנית מתוכו.`,
          entityType: spec.entityType,
          entityId,
        }),
      );
    } catch (notifyError: unknown) {
      deps.logger.warn(
        `auto network publish notice failed for ${kind} ${entityId}: ${String(notifyError)}`,
      );
    }
  }
}
