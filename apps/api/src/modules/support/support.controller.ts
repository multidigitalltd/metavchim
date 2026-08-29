import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import {
  IdSchema,
  MAX_SUPPORT_MESSAGE,
  MAX_SUPPORT_REPLY,
  MAX_SUPPORT_SCREENSHOT_BYTES,
  orderSupportQueue,
  SUPPORT_KINDS,
  SUPPORT_STATUSES,
  ticketTitle,
  type SupportQueueRow,
} from "@metavchim/shared";
import {
  AnyAuthenticated,
  BillingAllowed,
  PlatformAdmin,
} from "../../common/auth.decorators";
import { PlatformAdminGuard } from "../../common/platform-admin.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { SupportInboxService } from "./support-inbox.service";
import {
  SupportService,
  type SupportTicketAdminDto,
  type SupportTicketDto,
} from "./support.service";

/**
 * פניות לתמיכה.
 *
 * **פתוח לכל מי שמחובר, ולא ליכולת ניהולית.** הכפתור יושב בכל מסך
 * ולכל סוכן, כי מי שנתקל בתקלה הוא זה שצריך לדווח עליה — לא מי
 * שמורשה לשנות הגדרות.
 *
 * `@BillingAllowed` בכוונה: משרד שתקופתו נגמרה חסום מכל נתיב עבודה,
 * וזה בדיוק המצב שבו הוא הכי צריך לפנות. תמיכה שנסגרת יחד עם
 * המנוי משאירה בעיית תשלום בלי דרך לדבר עליה.
 */

const CreateSchema = z
  .object({
    kind: z.enum(SUPPORT_KINDS),
    message: z.string().trim().min(5, "כתבו לפחות משפט אחד").max(MAX_SUPPORT_MESSAGE),
    context: z
      .object({
        path: z.string().max(500).optional(),
        viewport: z.string().max(40).optional(),
        userAgent: z.string().max(500).optional(),
        appVersion: z.string().max(60).optional(),
        errors: z.array(z.string().max(500)).max(30).optional(),
        failedRequests: z.array(z.string().max(500)).max(30).optional(),
        breadcrumbs: z.array(z.string().max(500)).max(30).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const QueueStatusSchema = z.object({ status: z.enum(SUPPORT_STATUSES) }).strict();

const RespondSchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    reply: z.string().trim().max(MAX_SUPPORT_REPLY).optional(),
  })
  .strict();

const IdParam = new ZodValidationPipe(IdSchema);

@Controller("support")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /*
   * הגבלת קצב: פנייה היא פעולה אנושית, ועשר בדקה הן כבר תקלה או
   * שימוש לרעה. הסף נדיב מספיק כדי שמי שמדווח על שלוש תקלות ברצף
   * לא ייחסם.
   */
  @Post("tickets")
  @AnyAuthenticated()
  @BillingAllowed()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<{ id: string }> {
    return this.support.create({
      kind: body.kind,
      message: body.message,
      context: body.context ?? {},
    });
  }

  /**
   * הצילום בבקשה נפרדת — ראו `SupportService.attachScreenshot` להסבר
   * למה הוא אינו שדה בגוף הפנייה.
   */
  @Post("tickets/:id/screenshot")
  @AnyAuthenticated()
  @BillingAllowed()
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_SUPPORT_SCREENSHOT_BYTES, files: 1 } }),
  )
  attach(
    @Param("id", IdParam) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ ok: true }> {
    return this.support.attachScreenshot(id, file?.buffer ?? Buffer.alloc(0));
  }

  /** תיק הפניות של המשרד — הסיבה שהפנייה נשמרת ולא רק נשלחת במייל. */
  @Get("tickets")
  @AnyAuthenticated()
  @BillingAllowed()
  list(): Promise<SupportTicketDto[]> {
    return this.support.listMine();
  }

  @Get("tickets/:id/screenshot")
  @AnyAuthenticated()
  @BillingAllowed()
  @Header("Cache-Control", "private, max-age=600")
  async screenshot(@Param("id", IdParam) id: string): Promise<StreamableFile> {
    const obj = await this.support.screenshot(id, { platform: false });
    return new StreamableFile(obj.body as never, {
      type: obj.contentType ?? "image/jpeg",
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }
}

/**
 * שולחן התמיכה של הפלטפורמה — תור אחד לכל המשרדים.
 *
 * נתיב נפרד ולא פרמטר על הנתיב הקודם: הגישה חוצת-הדיירים היא הבדל
 * מהותי, וכשהיא יושבת על אותו handler כמו הקריאה הרגילה, השאלה "מי
 * רשאי" נקבעת בגוף הפונקציה. כאן היא נקבעת בשער.
 */
@Controller("platform/support")
@UseGuards(PlatformAdminGuard)
export class SupportDeskController {
  constructor(
    private readonly support: SupportService,
    private readonly inbox: SupportInboxService,
  ) {}

  /**
   * ‎**התור המאוחד — שני המקורות ברשימה אחת.**
   *
   * פנייה מהכפתור ופנייה במייל הן אותה עבודה: מישהו מחכה לתשובה.
   * שני מסכים נפרדים פירושם שני תורים לבדוק, שתי ספירות „כמה
   * פתוחות”, ושתי פניות שיכולות להיות של אותו אדם על אותו דבר בלי
   * שאיש ישים לב.
   *
   * המקור נשאר מסומן על כל שורה — הוא קובע איך עונים — אבל אינו
   * מפצל את הרשימה. הסדר עצמו ב-`orderSupportQueue`, עם בדיקה:
   * מיון נאיבי לפי `status` היה דוחף את הסגורות לראש.
   */
  @Get("queue")
  @PlatformAdmin()
  async queue(): Promise<SupportQueueRow[]> {
    const [tickets, threads] = await Promise.all([
      this.support.listForDesk({}),
      this.inbox.threads(),
    ]);
    return orderSupportQueue([
      ...tickets.map(
        (ticket): SupportQueueRow => ({
          source: "app",
          id: ticket.id,
          reference: ticket.reference,
          title: ticketTitle(ticket.message),
          who: ticket.userName,
          tenantName: ticket.tenantName,
          status: ticket.status,
          /* פנייה מהכפתור „ממתינה” כל עוד לא נענתה */
          unread: ticket.reply === undefined,
          lastActivityAt: ticket.repliedAt ?? ticket.createdAt,
        }),
      ),
      ...threads.map(
        (thread): SupportQueueRow => ({
          source: "email",
          id: thread.id,
          reference: thread.reference,
          title: thread.subject,
          who: thread.contactName,
          tenantName: thread.tenantName,
          status: thread.status as SupportQueueRow["status"],
          unread: thread.unread,
          lastActivityAt: thread.lastMessageAt.toISOString(),
        }),
      ),
    ]);
  }

  /**
   * סגירה (או פתיחה מחדש) של פנייה — **בלי שהמסך יידע איזה נתיב**.
   *
   * שני המקורות נשמרים בטבלאות שונות ולכן יש להם שתי דרכים לעדכן
   * סטטוס. מסך שמכיר את שתיהן הוא מסך שמחזיק את הפיצול שהתור הזה
   * בא לבטל — ובדיוק שם נולד הבאג של „סגרתי ונשארה פתוחה”, כשמישהו
   * שולח פנייה ממקור אחד לנתיב של השני.
   */
  @Post("queue/:source/:id/status")
  @PlatformAdmin()
  @HttpCode(200)
  async setQueueStatus(
    @Param("source") source: string,
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(QueueStatusSchema)) body: z.infer<typeof QueueStatusSchema>,
  ): Promise<{ ok: true }> {
    if (source === "email") return this.inbox.setStatus(id, body.status);
    if (source === "app") return this.support.respond(id, { status: body.status });
    throw new BadRequestException("מקור פנייה לא מוכר");
  }

  @Get("tickets")
  @PlatformAdmin()
  list(
    @Query("status") status?: string,
  ): Promise<SupportTicketAdminDto[]> {
    const parsed = SUPPORT_STATUSES.find((s) => s === status);
    return this.support.listForDesk(parsed === undefined ? {} : { status: parsed });
  }

  @Get("tickets/:id")
  @PlatformAdmin()
  one(@Param("id", IdParam) id: string): Promise<SupportTicketAdminDto> {
    return this.support.oneForDesk(id);
  }

  @Patch("tickets/:id")
  @PlatformAdmin()
  respond(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(RespondSchema)) body: z.infer<typeof RespondSchema>,
  ): Promise<{ ok: true }> {
    return this.support.respond(id, body);
  }

  @Get("tickets/:id/screenshot")
  @PlatformAdmin()
  @Header("Cache-Control", "private, max-age=600")
  async screenshot(@Param("id", IdParam) id: string): Promise<StreamableFile> {
    const obj = await this.support.screenshot(id, { platform: true });
    return new StreamableFile(obj.body as never, {
      type: obj.contentType ?? "image/jpeg",
      ...(obj.contentLength !== undefined ? { length: obj.contentLength } : {}),
    });
  }
}
