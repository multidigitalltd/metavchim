import { Body, Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { actingPlatformAdminEmail } from "../../common/platform-admin-email";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PrismaService } from "../../core/prisma.service";
import { RecordingFetchService } from "./recording-fetch.service";

/**
 * ‏ייבוא הקלטות בשם משרד — **מנהל הפלטפורמה, משולחן החיבורים.**
 *
 * ## ‏למה זה כאן ולא בשולחן החיבורים
 *
 * ‏שולחן החיבורים נשען על הבטחה צרה: הוא נוגע בטבלת החיבורים,
 * ‏במספרים הווירטואליים וביומן — ו**לא** בלידים, בלקוחות או
 * ‏בשיחות. ההבטחה נאכפת מבנית (`integration-desk-scope.test.ts`),
 * ‏שסורק את שני קבצי השולחן ומוודא שכל `tx.<model>` שנכתב בהם
 * ‏נמצא ברשימה לבנה.
 *
 * ‏ייבוא הקלטות **כן** כותב אל `calls` — הוא מצרף לשיחה את הנתיב
 * ‏שההקלטה שלה יושבת בו אצל הספק. לכן הוא אינו יכול לשבת בשולחן
 * ‏מבלי להרחיב את הרשימה הלבנה, ולא היה נכון לנתב אותו דרך
 * ‏השולחן אל שירות אחר: הסריקה בודקת קבצים, וקריאה לשירות שכן
 * ‏נוגע ב-`calls` הייתה עוברת אותה בשקט. הגבול נשמר בכך שהיכולת
 * ‏הזו יושבת בקובץ משלה, ליד המנוע שהיא מפעילה, ומצהירה בעצמה מה
 * ‏היא עושה.
 *
 * ## ‏מה חוצה ומה לא
 *
 * ‏מה שחוזר לפלטפורמה הוא **מספרים ושמות שדות בלבד**: כמה הקלטות
 * ‏יש אצל הספק, כמה סומנו, כמה כבר היו, וכיצד נקראים השדות שהספק
 * ‏החזיר. לא מספר טלפון, לא שם, לא נתיב הקלטה ולא אודיו — אלה
 * ‏נכתבים לשורת השיחה של המשרד ואינם עוברים דרך התשובה.
 *
 * ‏והתמורה היא אותה תמורה של שולחן החיבורים: הפעולה נרשמת ביומן
 * ‏הפעילות של המשרד ומייצרת אצלו התראה, באותה עסקה שבה היא נעשית
 * ‏(ראו `RecordingFetchService.importRange`).
 *
 * ## ‏בלי שער פיצ'ר
 *
 * ‎`@RequireFeature("telephony")` נשען על הפיצ'רים של הדייר
 * ‏שב-`TenantContext` — כלומר של **הפלטפורמה**, לא של המשרד
 * ‏שנבחר. הוא היה בודק את הישות הלא נכונה. מה שמגן כאן הוא
 * ‏שהייבוא נכשל ממילא בלי מרכזיית 015 פעילה אצל המשרד.
 */

/**
 * ‏כמה ימים אחורה. אותה תקרה של מסך המשרד, ומאותו נימוק: טווח
 * ‏פתוח הוא בקשה שעלולה להימשך דקות ולהיתקל בפסק הזמן.
 */
const ImportSchema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(30) })
  .strict();

@Controller("platform/agencies")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class PlatformRecordingsController {
  constructor(
    private readonly recordings: RecordingFetchService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(":id/integrations/telephony/recordings/import")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(200)
  async importRecordings(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ImportSchema)) body: z.infer<typeof ImportSchema>,
  ): ReturnType<RecordingFetchService["importRange"]> {
    const to = new Date();
    const from = new Date(to.getTime() - body.days * 24 * 60 * 60 * 1000);
    return this.recordings.importRange(id, from, to, {
      platformAdminEmail: await actingPlatformAdminEmail(this.prisma),
    });
  }
}
