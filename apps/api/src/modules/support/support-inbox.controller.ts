import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { timingSafeEqual } from "node:crypto";
import type { Response } from "express";
import { z } from "zod";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  IdSchema,
  InboundEmailPayloadSchema,
} from "@metavchim/shared";
import { PlatformAdmin, Public } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SupportInboxService } from "./support-inbox.service";

/**
 * תיבת התמיכה — הנתיב הציבורי שספק הדואר דוחף אליו.
 *
 * **נתיב נפרד מזה של תיבות המשרדים, ובכוונה.** שני הזרמים נראים
 * דומים ומתנהגים הפוך: שם הודעה בלי טוקן מוכר נזרקת, וכאן היא
 * בדיוק הפנייה הראשונה שאסור לזרוק. שרת נפרד אצל הספק פירושו גם
 * כתובת נפרדת, גם סוד נפרד, וגם שתקלה באחד אינה נוגעת בשני.
 *
 * הסוד יושב בנתיב ומושווה בזמן קבוע. סוד שגוי מקבל 404 ולא 403:
 * תשובה שמבחינה בין "הנתיב לא קיים" ל"הסוד שגוי" מסגירה שהנתיב
 * קיים.
 */

const SecretSchema = z.string().min(16).max(200);

const ReplySchema = z.object({ body: z.string().max(20_000).default("") }).strict();
const StatusSchema = z.object({ status: z.enum(["open", "closed"]) }).strict();

@Controller()
export class SupportInboxPublicController {
  constructor(private readonly inbox: SupportInboxService) {}

  /**
   * קליטת פנייה. **200 על קלט חוקי, חוץ ממקרה אחד** — ספק הדואר
   * חוזר על הודעה שלא נענתה, וניסיון חוזר על פנייה שכבר נקלטה הוא
   * רעש.
   *
   * המקרה היחיד שנענה בשגיאה הוא קובץ שלא נשמר: 200 אומר לספק
   * „התקבל”, ואז אין לו סיבה למסור שוב — והצילום שהלקוח צירף אבד
   * לתמיד בעוד הפנייה נראית שלמה. הפנייה עצמה כבר נכתבה ומופיעה על
   * השולחן; מה שנדרש הוא רק להשלים את הקבצים, והמסירה החוזרת עושה
   * בדיוק את זה.
   */
  @Public()
  @Post("public/support/inbound/:secret")
  @HttpCode(200)
  async inbound(
    @Param("secret", new ZodValidationPipe(SecretSchema)) secret: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const expected = Buffer.from((await this.inbox.webhookSecret()) ?? "");
    const actual = Buffer.from(secret);
    if (expected.length === 0) throw new NotFoundException();
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new NotFoundException();
    }

    const parsed = InboundEmailPayloadSchema.safeParse(body);
    if (!parsed.success) return { ok: true }; // גוף שאינו מובן — נבלע, לא נענה בשגיאה
    await this.inbox.processInbound(parsed.data);
    return { ok: true };
  }
}

/** שולחן התמיכה — קריאה ומענה, למנהלי הפלטפורמה בלבד. */
@Controller("platform/support/inbox")
@UseGuards(PlatformAdminGuard)
@PlatformAdmin()
export class SupportInboxDeskController {
  constructor(private readonly inbox: SupportInboxService) {}

  @Get()
  async threads(): Promise<Awaited<ReturnType<SupportInboxService["threads"]>>> {
    return this.inbox.threads();
  }

  @Get(":id")
  async thread(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<Awaited<ReturnType<SupportInboxService["thread"]>>> {
    return this.inbox.thread(id);
  }

  /**
   * תשובה — טקסט וקבצים יחד, ולכן multipart.
   *
   * אותם גבולות כמו בתיבת המשרד: הסוגים מהרשימה הסגורה, והמכסה
   * נאכפת גם ב-Multer (שומר על הזיכרון) וגם בשירות (הכלל האמיתי).
   */
  @Post(":id/reply")
  @HttpCode(200)
  @UseInterceptors(
    FilesInterceptor("files", EMAIL_ATTACHMENT_MAX_COUNT, {
      limits: { fileSize: EMAIL_ATTACHMENT_MAX_BYTES },
    }),
  )
  async reply(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(ReplySchema)) body: z.infer<typeof ReplySchema>,
    @UploadedFiles()
    files:
      | { buffer: Buffer; originalname: string; mimetype: string; size: number }[]
      | undefined,
  ): Promise<{ ok: true; state: "sent" | "unknown" }> {
    const attachments = files ?? [];
    if (body.body.trim() === "" && attachments.length === 0) {
      throw new BadRequestException("אין מה לשלוח");
    }
    return this.inbox.reply(id, body.body, attachments);
  }

  @Post(":id/status")
  @HttpCode(200)
  async setStatus(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(StatusSchema)) body: z.infer<typeof StatusSchema>,
  ): Promise<{ ok: true }> {
    return this.inbox.setStatus(id, body.status);
  }

  /**
   * קובץ מצורף. מסמך יורד ואינו נפתח בדפדפן — הסוג נקבע בקליטה
   * מרשימה סגורה, וזו שכבת ההגנה השנייה על אותו עיקרון.
   */
  @Get("attachments/:id/raw")
  @Header("Cache-Control", "private, max-age=600")
  async attachment(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const object = await this.inbox.attachmentRaw(id);
    if (object.kind === "file") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(object.name)}`,
      );
    }
    return new StreamableFile(object.body as never, {
      type: object.contentType,
      ...(object.contentLength !== undefined ? { length: object.contentLength } : {}),
    });
  }
}
