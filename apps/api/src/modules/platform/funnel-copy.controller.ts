import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { firstNameOf, funnelEmail } from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { TenantContext } from "../../common/tenant-context";
import { ZodValidationPipe, IdParam } from "../../common/zod-validation.pipe";
import { loadEnv } from "../../config/env";
import { EmailService } from "../../core/email.service";
import { PlatformSettingsService } from "../../core/platform-settings.service";
import { PrismaService } from "../../core/prisma.service";
import { FunnelStageService, type FunnelStageCopy } from "../funnel/funnel-stage.service";
import { FunnelReportService, type FunnelStats } from "../funnel-send/funnel-report.service";

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

const ToggleSchema = z.object({ enabled: z.boolean() }).strict();

@Controller("platform")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class FunnelCopyController {
  constructor(
    private readonly stages: FunnelStageService,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly settings: PlatformSettingsService,
    private readonly report: FunnelReportService,
  ) {}

  @Get("funnel-copy")
  async list(): Promise<FunnelStageCopy[]> {
    return this.stages.copyCatalog();
  }

  /**
   * ‎**המפסק הראשי — כבוי, אלא אם הודלק כאן במפורש.**
   *
   * ‏כבוי: הסבב השעתי אינו מכניס משרדים ואינו שולח דבר, גם כשיש שלבים
   * ‏דלוקים. כך אפשר להכין ולהדליק שלבים בשקט, ולפתוח את המסלול
   * ‏ברגע אחד.
   */
  /** ‏המדדים לכל שלב, ומה קרה למשרדים שבמסלול. */
  @Get("funnel-stats")
  async stats(): Promise<FunnelStats> {
    return this.report.stats();
  }

  @Get("funnel-sending")
  async sending(): Promise<{ enabled: boolean }> {
    return { enabled: (await this.settings.get("funnelSending")) === "true" };
  }

  @Patch("funnel-sending")
  async setSending(
    @Body(new ZodValidationPipe(ToggleSchema)) body: z.infer<typeof ToggleSchema>,
  ): Promise<{ enabled: boolean }> {
    if (body.enabled) {
      await this.settings.set("funnelSending", "true", TenantContext.current().userId);
    } else {
      await this.settings.remove("funnelSending");
    }
    return { enabled: body.enabled };
  }

  /** ‏הדלקה וכיבוי של שלב — נבדקים מול `funnelStageEnableBlock` בשרת. */
  @Patch("funnel-copy/:id/enabled")
  async setEnabled(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(ToggleSchema)) body: z.infer<typeof ToggleSchema>,
  ): Promise<{ ok: true }> {
    await this.stages.setEnabled(id, body.enabled);
    return { ok: true };
  }

  @Patch("funnel-copy/:id")
  async update(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(CopySchema)) body: z.infer<typeof CopySchema>,
  ): Promise<{ ok: true }> {
    await this.stages.updateCopy(id, body);
    return { ok: true };
  }

  /**
   * ‎**המייל של שלב — לתיבה של בעל הפלטפורמה בלבד, לבדיקה.**
   *
   * ‏הנוסח השמור, דרך אותה `funnelEmail` שהשליחה האמיתית תשתמש בה,
   * ‏ומצייני המקום מתמלאים בשם ובמשרד של מי שלחץ. הנמען אינו פרמטר:
   * ‏הכתובת נשלפת מהמשתמש המחובר, ולכן אין כאן דרך לשלוח ללקוח.
   * ‏גם אין שורה ב-`funnel_messages` — בדיקה אינה שלב שיצא.
   */
  @Post("funnel-copy/:id/test")
  @HttpCode(200)
  async test(@Param("id", IdParam) id: string): Promise<{ sentTo: string }> {
    const stage = await this.stages.copy(id);
    if (stage === null) throw new NotFoundException("השלב לא נמצא");
    if (stage.unknownPlaceholders.length > 0) {
      const names = stage.unknownPlaceholders.map((name) => `{{${name}}}`).join(", ");
      throw new BadRequestException(`בנוסח יש מצייני מקום שלא יוחלפו: ${names}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: TenantContext.current().userId },
      select: { email: true, name: true, tenant: { select: { name: true } } },
    });
    if (!user) throw new BadRequestException("משתמש לא נמצא");
    const email = funnelEmail(
      stage,
      { שם_פרטי: firstNameOf(user.name), שם_המשרד: user.tenant.name },
      loadEnv().WEB_ORIGIN,
    );
    if (email === null) throw new BadRequestException("לשלב הזה אין עדיין נושא וגוף למייל");
    if (!(await this.email.isConfigured())) {
      throw new BadRequestException("אין ספק אימייל מוגדר — מלאו את פרטי Postmark ושמרו");
    }
    await this.email.send(
      user.email,
      `[בדיקה] ${email.subject}`,
      {
        ...email.content,
        footnote: `הודעת בדיקה של השלב „${stage.title}” ממסך נוסחי ההמרה. נשלחה רק אליך.`,
      },
      // ‏„שלחו שוב” הוא בדיוק מה שמבקשים בבדיקה, ובלי ספק אין מה לבדוק
      { idempotency: null, required: true },
    );
    return { sentTo: user.email };
  }
}
