import { computeReadiness } from "@metavchim/shared";
import type { TenantTx } from "../../core/prisma.service";
import { PROPERTY_READY_SCORE, rowToFields } from "./property.mapper";

/**
 * חישוב מחדש של `readiness_score` **אחרי שינוי שאינו בשורת הנכס.**
 *
 * ## למה זה נדרש
 *
 * שלושה מתשעת שדות המוכנות אינם עמודות של `properties`, ואחד מהם —
 * תמונות — חי בטבלה אחרת לגמרי. כלומר העלאת תמונה או מחיקתה משנה
 * את המוכנות בכ-11 נקודות מבלי שאיש נגע בנכס, והעמודה השמורה נשארה
 * על ערכה הישן (ביקורת Codex).
 *
 * זה לא היה מתקן את עצמו בעריכה הבאה במקרה: `AnalyticsService`
 * סופר „נכסים לא שלמים” **מהעמודה**, בעוד הכרטיס והרשימה מחשבים
 * מחדש בכל קריאה — ולכן דוח המשרד היה חולק על המסכים עד שמישהו
 * יערוך את הנכס במקרה. זו בדיוק „שלושה מספרים לנכס אחד” שהמעבר
 * לתשעת השדות בא לסגור.
 *
 * ## למה פונקציה ולא מתודה בשירות
 *
 * ‎`PropertiesService` כבר מייבא מ-`media.service`, והזרקה הפוכה
 * הייתה יוצרת מעגל בין שני הקבצים. בית משלה, מפורש, לשני הקוראים.
 *
 * ## למה `findFirst` ולא `count`
 *
 * השאלה היא קיום ולא כמות, וספירה על נכס עם מאה תמונות סורקת את
 * כולן בשביל מספר שאיש אינו קורא. אותו נימוק כמו `hasMedia`
 * שבשירות הנכסים.
 *
 * הקריאה חייבת לרוץ **בתוך** הטרנזקציה שביצעה את השינוי: `properties`
 * ו-`property_media` תחת FORCE RLS, ובנוסף — עדכון שנבלע בכשל היה
 * משאיר ציון שמתאר מצב שכבר אינו קיים.
 *
 * ## מה היא מחזירה
 *
 * חציית סף המוכנות, כדי שהקורא יפלוט `property.ready`. הפליטה אינה
 * כאן משתי סיבות: `OutboxService` הוא שירות מוזרק ולפונקציה חופשית
 * אין אליו גישה, והאירוע שייך לשירות שביצע את הפעולה — שם גם
 * הטרנזקציה שהוא חייב להיכתב בתוכה.
 */
export async function refreshReadiness(
  tx: TenantTx,
  propertyId: string,
): Promise<{ crossedReady: boolean; score: number }> {
  const row = await tx.property.findFirst({ where: { id: propertyId } });
  /*
   * נכס שנמחק בין השינוי לחישוב אינו שגיאה: מחיקת נכס מוחקת גם את
   * המדיה שלו, וכתיבת ציון לשורה שאיננה הייתה מפילה את המחיקה.
   */
  if (!row) return { crossedReady: false, score: 0 };

  const anyMedia = await tx.propertyMedia.findFirst({
    where: { propertyId, tenantId: row.tenantId },
    select: { id: true },
  });

  const readiness = computeReadiness(rowToFields(row), {
    hasImages: anyMedia !== null,
    hasDescription: Boolean(row.marketingDescription),
    hasOwner: Boolean(row.ownerContactId),
  });

  if (readiness.score !== row.readinessScore) {
    await tx.property.update({
      where: { id: propertyId },
      data: { readinessScore: readiness.score },
    });
  }

  return {
    crossedReady: row.readinessScore < PROPERTY_READY_SCORE && readiness.score >= PROPERTY_READY_SCORE,
    score: readiness.score,
  };
}
