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
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import {
  EMAIL_ATTACHMENT_MAX_BYTES,
  EMAIL_ATTACHMENT_MAX_COUNT,
  IdSchema,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  EmailInboxService,
  type InboxMessageDto,
  type InboxThreadDto,
} from "./email-inbox.service";

/** תשובה יכולה להיות קבצים בלבד — הגוף אופציונלי אז, ריק אינו שגיאה. */
const ReplyMultipartSchema = z
  .object({ body: z.string().trim().max(5000).default("") })
  .strict();

/** הסוד שבנתיב — מגביל אורך כדי שהשוואה עוינת לא תהיה זולה מדי. */
/**
 * תיבת הדואר הפנימית — התיבה של המשרד.
 *
 * משותפת לכל הסוכנים (כמו מספר הוואטסאפ המשרדי), בשער
 * `buyers.view_own` — היכולת הבסיסית שיש לכל מי שמטפל בלקוחות.
 *
 * ‎**ה-Webhook הנכנס אינו כאן.** שני הנתיבים הציבוריים עברו
 * ל-`InboundMailModule`: הם מתנהגים זהה, וההכרעה „תשובת לקוח או
 * פנייה לתמיכה” זקוקה לשני היעדים.
 */
@Controller()
export class EmailInboxController {
  constructor(private readonly inbox: EmailInboxService) {}

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

  /**
   * תשובה — multipart: טקסט וקבצים יחד, כמו העלאת תמונות נכס.
   * גוף ריק עם קבצים הוא הודעה לגיטימית ("מצורף החוזה").
   */
  @Post("email-inbox/:contactId/reply")
  @RequireCapability("buyers.view_own")
  @HttpCode(200)
  @UseInterceptors(
    FilesInterceptor("files", EMAIL_ATTACHMENT_MAX_COUNT, {
      limits: { fileSize: EMAIL_ATTACHMENT_MAX_BYTES },
    }),
  )
  async reply(
    @Param("contactId", new ZodValidationPipe(IdSchema)) contactId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body(new ZodValidationPipe(ReplyMultipartSchema)) body: z.infer<typeof ReplyMultipartSchema>,
  ): Promise<{ ok: true; state: "sent" | "unknown" }> {
    const uploads = (files ?? []).map((file) => ({
      name: file.originalname,
      contentType: file.mimetype,
      content: file.buffer,
    }));
    if (body.body === "" && uploads.length === 0) {
      throw new BadRequestException("אין מה לשלוח — כתבו הודעה או צרפו קובץ");
    }
    /*
     * ‎`state` ולא רק `ok`: תוצאה עמומה אינה שגיאה — הספק אולי קיבל —
     * אבל היא גם אינה „נשלח”. המסך צריך את ההבדל כדי לא להזמין
     * שליחה חוזרת שתגיע ללקוח פעמיים.
     */
    const result = await this.inbox.reply(contactId, body.body, uploads);
    return { ok: true, state: result.state };
  }

  /** הזרמת קובץ מצורף — תמונה/וידאו בתוך הדף, מסמך כהורדה. */
  @Get("email-inbox/attachments/:attachmentId/raw")
  @RequireCapability("buyers.view_own")
  @Header("Cache-Control", "private, max-age=3600")
  async attachmentRaw(
    @Param("attachmentId", new ZodValidationPipe(IdSchema)) attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const obj = await this.inbox.attachmentRaw(attachmentId);
    /*
     * מסמכים יורדים כקובץ ולא נפתחים בדפדפן — הסוג מהרשימה הסגורה
     * ממילא, וההורדה מוסיפה שכבה: גם קובץ שמתחזה לא ירונדר. השם
     * עבר ניקוי בקליטה; הקידוד כאן הוא לתקן הכותרת בלבד.
     */
    if (obj.kind === "file") {
      res.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(obj.name)}`,
      );
    }
    return new StreamableFile(obj.body as never, {
      type: obj.contentType,
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }
}
