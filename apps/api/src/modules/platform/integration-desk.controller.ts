import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { IntegrationDeskService, type DeskTelephonyStatus } from "./integration-desk.service";

/**
 * שולחן החיבורים של מנהל הפלטפורמה.
 *
 * **קונטרולר נפרד ולא עוד נתיב ב-`PlatformController`**, ובכוונה:
 * הגבול של השולחן הזה הוא שהוא נוגע בטבלת החיבורים בלבד, וגבול
 * שאפשר להצביע עליו כקובץ שלם קל יותר לשמור מגבול שנטמע בתוך אלפיים
 * שורות. המבחן המבני קורא בדיוק את הקובץ הזה ואת השירות שלו.
 *
 * מה שאין כאן חשוב לא פחות ממה שיש: אין יצירת סשן, אין החלפת עוגייה,
 * ואין נתיב שמחזיר לקוח, ליד או שיחה. ראו `integration-desk.service`.
 */

const SaveTelephonySchema = z
  .object({
    provider: z.string().min(1).max(30),
    /*
     * ההגדרות שאינן סוד — מפתחות קצרים וערכים קצרים. הסכמה סוגרת
     * את שניהם כדי שלא ייכתב JSON שרירותי לתוך העמודה.
     */
    config: z.record(z.string().max(40), z.string().max(200)).default({}),
    /**
     * סודות — **לכתיבה בלבד.** מה שנשלח נכתב, מה שלא נשלח נשאר כפי
     * שהיה, ושום ערך אינו חוזר בשום נתיב של השולחן הזה.
     */
    secrets: z.record(z.string().max(40), z.string().max(400)).default({}),
  })
  .strict();

@Controller("platform/agencies")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class IntegrationDeskController {
  constructor(private readonly desk: IntegrationDeskService) {}

  /**
   * מצב החיבורים של משרד — כולל האבחון שעונה על "חיברתי ולא קורה
   * כלום": מתי הגיע האירוע האחרון, אילו שדות היו בו, ולמה הוא לא
   * נקלט אם לא נקלט.
   */
  @Get(":id/integrations")
  async status(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{
    agencyName: string;
    telephony: DeskTelephonyStatus;
    providers: { id: string; label: string; fields: { key: string; label: string; secret: boolean }[] }[];
  }> {
    const [agencyName, telephony] = await Promise.all([
      this.desk.agencyName(id),
      this.desk.telephonyStatus(id),
    ]);
    return {
      agencyName,
      telephony,
      providers: this.desk.providers().map((provider) => ({
        id: provider.id,
        label: provider.label,
        fields: provider.fields.map((field) => ({ ...field })),
      })),
    };
  }

  /**
   * שמירת חיבור המרכזייה בשם המשרד.
   *
   * הפעולה נרשמת ביומן הביקורת של המשרד ומייצרת התראה אצלו — זו
   * התמורה לכך שהיא אינה דורשת ממנו לפתוח גישה מראש.
   */
  @Post(":id/integrations/telephony")
  @HttpCode(200)
  async saveTelephony(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(SaveTelephonySchema)) body: z.infer<typeof SaveTelephonySchema>,
  ): Promise<{ ok: true }> {
    return this.desk.saveTelephony(id, {
      provider: body.provider,
      config: body.config,
      secrets: body.secrets,
    });
  }
}
