import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdSchema, InboundEmailPayloadSchema } from "@metavchim/shared";
import { Public, RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  EmailInboxService,
  type InboxMessageDto,
  type InboxThreadDto,
} from "./email-inbox.service";

const ReplySchema = z
  .object({ body: z.string().trim().min(1).max(5000) })
  .strict();

/** הסוד שבנתיב — מגביל אורך כדי שהשוואה עוינת לא תהיה זולה מדי. */
const SecretSchema = z.string().min(16).max(200);

/**
 * תיבת הדואר הפנימית.
 *
 * הנתיב הציבורי הוא ה-Webhook של ספק האימייל; הסוד שבכתובת הוא
 * מה שסוגר אותו. שאר הנתיבים — התיבה של המשרד: משותפת לכל הסוכנים
 * (כמו מספר הוואטסאפ המשרדי), בשער `buyers.view_own` — היכולת
 * הבסיסית שיש לכל מי שמטפל בלקוחות.
 */
@Controller()
export class EmailInboxController {
  constructor(private readonly inbox: EmailInboxService) {}

  /**
   * ה-Webhook הנכנס. תמיד 200 על קלט חוקי — גם כשהטוקן לא מוכר:
   * שגיאה הייתה גורמת לספק לנסות שוב לנצח הודעה שלא תיקלט לעולם.
   * סוד שגוי לעומת זאת הוא 404 — אין סיבה לאשר לדופק-בדלתות שהנתיב
   * קיים.
   */
  @Public()
  @Post("public/email/inbound/:secret")
  @HttpCode(200)
  async inbound(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const config = await this.inbox.inboundConfig();
    if (config === null) throw new NotFoundException("לא נמצא");
    const expected = Buffer.from(config.secret);
    const actual = Buffer.from(secret);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new NotFoundException("לא נמצא");
    }

    // קלט שאינו בצורה המוכרת נבלע — הספק ניסה, אין מה לנסות שוב
    const parsed = InboundEmailPayloadSchema.safeParse(body);
    if (parsed.success) await this.inbox.processInbound(parsed.data);
    return { ok: true };
  }

  @Get("email-inbox")
  @RequireCapability("buyers.view_own")
  async list(): Promise<InboxThreadDto[]> {
    return this.inbox.listThreads();
  }

  @Get("email-inbox/:contactId")
  @RequireCapability("buyers.view_own")
  async thread(
    @Param("contactId", new ZodValidationPipe(IdSchema)) contactId: string,
  ): Promise<{ contactName: string; messages: InboxMessageDto[] }> {
    return this.inbox.thread(contactId);
  }

  @Post("email-inbox/:contactId/read")
  @RequireCapability("buyers.view_own")
  @HttpCode(200)
  async markRead(
    @Param("contactId", new ZodValidationPipe(IdSchema)) contactId: string,
  ): Promise<{ ok: true }> {
    await this.inbox.markRead(contactId);
    return { ok: true };
  }

  @Post("email-inbox/:contactId/reply")
  @RequireCapability("buyers.view_own")
  @HttpCode(200)
  async reply(
    @Param("contactId", new ZodValidationPipe(IdSchema)) contactId: string,
    @Body(new ZodValidationPipe(ReplySchema)) body: z.infer<typeof ReplySchema>,
  ): Promise<{ ok: true }> {
    await this.inbox.reply(contactId, body.body);
    return { ok: true };
  }
}
