import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  IdSchema,
  SUPPORT_STATUSES,
} from "@metavchim/shared";
import { PlatformAdmin } from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SupportInboxService } from "./support-inbox.service";

/**
 * שולחן התמיכה.
 *
 * ‎**הקליטה עצמה אינה כאן.** שני הנתיבים הציבוריים שספק הדואר דוחף
 * אליהם עברו ל-`InboundMailModule`, כי ההכרעה „תמיכה או תיבת משרד”
 * זקוקה לשני היעדים — ואילו אחד מהם היה מחזיק אותה, היה נוצר מעגל
 * בין המודולים.
 */

const ReplySchema = z.object({ body: z.string().max(20_000).default("") }).strict();
/* אותו אוצר מילים כמו פניות הכפתור — שולחן אחד לא מחזיק שניים. */
const StatusSchema = z.object({ status: z.enum(SUPPORT_STATUSES) }).strict();

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
