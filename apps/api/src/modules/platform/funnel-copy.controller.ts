import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { FunnelStageService, type FunnelStageCopy } from "../funnel/funnel-stage.service";

/**
 * ‎**עריכת נוסחי מסלול ההמרה — לבעל הפלטפורמה בלבד.**
 *
 * ## ‏למה כאן ולא במודול המשפך
 *
 * ‏מודול המשפך נושא הבטחה מבנית: **אין בו דרך אל ערוץ יוצא**, ושער
 * ‎(`funnel-no-send.test.ts`) אוכף אותה על כל קובץ בו — כולל
 * ‎`imports: []` במודול עצמו. בקר שיושב שם היה מוסיף לו שטח פנים
 * ‏בלי סיבה. מודול הפלטפורמה כבר מייבא את `FunnelModule` ממילא.
 *
 * ## ‏מה **אי אפשר** לעשות מכאן
 *
 * ‎`enabled` אינו בטופס. הדלקה של שלב שולחת לכל המשרדים במאגר, וזו
 * ‏אינה החלטה שצריכה לחלוק כפתור שמירה עם „תיקנתי פסיק”. גם
 * ‏התזמון והקהל אינם כאן — הם קובעים **למי** ההודעה יוצאת, ושינוי
 * ‏שלהם דרך מסך עריכת נוסח הוא בדיוק סוג הטעות שלא מרגישים.
 */
const CopySchema = z
  .object({
    emailSubject: z.string().max(200),
    emailHeading: z.string().max(200),
    emailBody: z.string().max(8000),
    ctaLabel: z.string().max(60),
    /*
     * ‏נתיב יחסי בלבד. כתובת מלאה שנשמרת בשורה נשברת בכל העברה בין
     * ‏סביבות, ו-`//evil.test` היה הופך את הכפתור להפניה החוצה.
     */
    ctaPath: z
      .string()
      .max(200)
      .refine((value) => value === "" || (value.startsWith("/") && !value.startsWith("//")), {
        message: "נתיב חייב להתחיל ב-/ ולהיות יחסי",
      }),
  })
  .strict();

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class FunnelCopyController {
  constructor(private readonly stages: FunnelStageService) {}

  @Get("funnel-copy")
  async list(): Promise<FunnelStageCopy[]> {
    return this.stages.copyCatalog();
  }

  @Patch("funnel-copy/:id")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(CopySchema)) body: z.infer<typeof CopySchema>,
  ): Promise<{ ok: true }> {
    await this.stages.updateCopy(id, body);
    return { ok: true };
  }
}
