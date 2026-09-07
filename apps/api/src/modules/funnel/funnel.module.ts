import { Module } from "@nestjs/common";
import { FunnelEnrollmentService } from "./funnel-enrollment.service";
import { FunnelStageService } from "./funnel-stage.service";

/**
 * ‎**מנוע המסלולים — שלב א׳.**
 *
 * ‏מה שיש כאן: קריאת הגדרות השלבים, ופתיחה וסגירה של רישומים.
 * ‏מה שאין כאן, בכוונה: **שליחה**. בחירת ההודעה, הנוסחים והמסירה
 * הם שלב ב׳ ואילך.
 *
 * ‏ההפרדה אינה רק סדר עבודה. שלב א׳ נוגע בכל המשרדים במאגר, ולכן
 * הוא נכתב כך שגם באג בו לא יכול לשלוח דבר לאיש — ושער מבני
 * ‏(`funnel-no-send.test.ts`) אוכף את זה על כל קובץ במודול.
 *
 * ‏המודול אינו מייבא דבר: הוא קורא ל-`PrismaService` שהוא גלובלי.
 * ‏היעדר `imports` הוא חלק מההבטחה — אין כאן דרך אל ערוץ יוצא.
 */
@Module({
  providers: [FunnelStageService, FunnelEnrollmentService],
  exports: [FunnelStageService, FunnelEnrollmentService],
})
export class FunnelModule {}
