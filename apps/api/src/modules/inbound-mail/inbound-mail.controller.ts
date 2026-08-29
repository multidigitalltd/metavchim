import { Controller, HttpCode, NotFoundException, Param, Post, Body } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { InboundEmailPayloadSchema } from "@metavchim/shared";
import { Public } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { EmailInboxService } from "../email-inbox/email-inbox.service";
import { SupportInboxService } from "../support/support-inbox.service";
import { InboundMailService } from "./inbound-mail.service";

/**
 * שני הנתיבים הציבוריים שספק הדואר דוחף אליהם — **ואותה התנהגות**.
 *
 * ## למה שניים ולא אחד
 *
 * הם קיימים בשטח: אחד מהם כבר מוגדר אצל הספק. איחוד לכתובת אחת היה
 * דורש לשנות את ההגדרה שם ברגע הפריסה, וכל דואר שהגיע בין הפריסה
 * לשינוי היה נופל על 404 — כלומר נמסר שוב ושוב עד שהספק מוותר.
 * שני נתיבים שמתנהגים זהה עולים שורה אחת ומייתרים את התיאום.
 *
 * ## הסודות נשארים נפרדים
 *
 * לכל נתיב הסוד שלו, ולכן מי שהגדיר אחד מהם אינו צריך להחליף אותו.
 * סוד שגוי מקבל 404 ולא 403: תשובה שמבחינה בין „הנתיב לא קיים”
 * ל„הסוד שגוי” מסגירה שהנתיב קיים. ההשוואה בזמן קבוע.
 *
 * ## תמיד 200 על קלט חוקי
 *
 * הספק חוזר על הודעה שלא נענתה. שגיאה על גוף שאיננו מבינים פירושה
 * מסירה חוזרת לנצח של הודעה שלא תיקלט לעולם.
 */

const SecretSchema = z.string().min(16).max(200);

@Controller()
export class InboundMailController {
  constructor(
    private readonly router: InboundMailService,
    private readonly support: SupportInboxService,
    private readonly tenantInbox: EmailInboxService,
  ) {}

  /** הנתיב ההיסטורי של תיבת התמיכה. */
  @Public()
  @Post("public/support/inbound/:secret")
  @HttpCode(200)
  async support_(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.accept(secret, await this.support.webhookSecret(), body);
    return { ok: true };
  }

  /** הנתיב ההיסטורי של תיבות המשרדים. */
  @Public()
  @Post("public/email/inbound/:secret")
  @HttpCode(200)
  async tenant(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const config = await this.tenantInbox.inboundConfig();
    await this.accept(secret, config?.secret ?? null, body);
    return { ok: true };
  }

  /** אימות הסוד ואז ניתוב — משותף לשני הנתיבים. */
  private async accept(given: string, expected: string | null, body: unknown): Promise<void> {
    const want = Buffer.from(expected ?? "");
    const got = Buffer.from(given);
    if (want.length === 0) throw new NotFoundException();
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      throw new NotFoundException();
    }
    // גוף שאינו בצורה המוכרת נבלע — הספק ניסה, אין מה לנסות שוב
    const parsed = InboundEmailPayloadSchema.safeParse(body);
    if (parsed.success) await this.router.route(parsed.data);
  }
}
