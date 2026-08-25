import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CallsService, type CallDto } from "./calls.service";

/*
 * ‎**רישום ידני וסינון אינם אותה רשימה.**
 *
 * ‎`unknown` נכתב רק בקליטה אוטומטית מהמרכזייה, כשהיא לא מסרה אם
 * השיחה נענתה. מי שרושם שיחה בעצמו **יודע** מה קרה בה, ולכן אין
 * טעם להציע לו „לא ידוע” — זו הזמנה לרשומה ריקה מתוכן.
 *
 * הסינון, לעומת זאת, חייב להכיר את הערך: בלעדיו הצ׳יפ „לא ידוע”
 * במסך היה נדחה בבקשה שגויה, כלומר מצב שהמערכת כותבת ואינה מאפשרת
 * לחפש.
 */
const OutcomeSchema = z.enum(["answered", "missed", "no_answer", "voicemail"]);
const OutcomeFilterSchema = z.enum([
  "answered",
  "missed",
  "no_answer",
  "voicemail",
  "unknown",
]);

const CreateSchema = z
  .object({
    direction: z.enum(["inbound", "outbound"]),
    contactId: IdSchema.optional(),
    leadId: IdSchema.optional(),
    phone: z.string().min(6).max(30).optional(),
    occurredAt: z.coerce.date(),
    durationMinutes: z.number().int().min(0).max(600).optional(),
    outcome: OutcomeSchema,
    summary: z.string().max(4000).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    outcome: OutcomeFilterSchema.optional(),
    leadId: IdSchema.optional(),
    /**
     * שיחה אחת לפי מזהה.
     *
     * המסך טוען עמוד של 100 ומחפש בתוכו את השיחה שהכתובת מבקשת;
     * מי שיש לו יותר שיחות חדשות ממנה היה נוחת על שיחה אחרת לגמרי
     * (ביקורת Codex). עם הסינון הזה המסך יכול לבקש אותה במפורש —
     * דרך אותו נתיב, ולכן דרך אותו סינון בעלות.
     */
    id: IdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** שיחה של חצי שעה ב-webm שוקלת בערך 15MB; 40 נותן מרווח נוח. */
const MAX_RECORDING_BYTES = 40 * 1024 * 1024;

/** יומן שיחות — תיעוד ידני של שיחות שהמתווך קיים. */
@Controller("calls")
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /*
   * יומן השיחות אינו של הלידים בלבד: שיחה תלויה באיש קשר, והוא
   * יכול להיות ליד או קונה. יכולת אחת חסמה מי שמודול הלידים סגור
   * אצלו מלראות שיחות של הקונים שלו — ומאז שהסוכן יודע להשמיע
   * הקלטה של קונה, הוא גם קיבל תשובה שהוא אינו יכול לפתוח
   * (ביקורת Codex). הבעלות עצמה מסוננת בשירות בכל מקרה.
   */
  @Get()
  @RequireCapability("leads.view_own", "buyers.view_own")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<CallDto[]> {
    return this.calls.list(query);
  }

  @Post()
  @RequireCapability("leads.edit")
  async create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<CallDto> {
    return this.calls.create(body);
  }

  /**
   * צירוף הקלטה לשיחה. התמלול רץ ברקע — ראו CallsService.
   * תקרת הגודל נאכפת ב-Multer ולא בקוד: קובץ ענק נחסם לפני שהוא
   * נטען לזיכרון של התהליך.
   */
  @Post(":id/recording")
  @RequireCapability("leads.edit")
  // ההקלטה נשמרת כדי להיות מתומללת — בלי הפיצ'ר אין טעם להעלות אותה
  @RequireFeature("transcription")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECORDING_BYTES, files: 1 } }))
  async attachRecording(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ status: string }> {
    if (!file) throw new BadRequestException("לא צורף קובץ");
    return this.calls.attachRecording(id, { buffer: file.buffer, mimetype: file.mimetype });
  }

  /**
   * ניסיון תמלול נוסף — להקלטה שהתמלול שלה נכשל.
   * ראו CallsService.retryTranscription.
   */
  @Post(":id/transcription/retry")
  @RequireCapability("leads.edit")
  @RequireFeature("transcription")
  @HttpCode(200)
  async retryTranscription(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ status: string }> {
    return this.calls.retryTranscription(id);
  }

  /**
   * השמעת ההקלטה בכרטיס הלקוח.
   *
   * `leads.view_own` ולא `leads.edit`: האזנה היא צפייה, ומי שרואה
   * את השיחה אמור לשמוע אותה. הסינון לפי בעלות נאכף ב-RLS כמו בכל
   * שאר הנתיבים.
   *
   * ‎`private, no-store`‎ — הקלטה של לקוח אינה נשמרת ב-cache של
   * הדפדפן ואינה עוברת דרך proxy משותף.
   */
  @Get(":id/recording")
  @RequireCapability("leads.view_own", "buyers.view_own")
  async recording(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const audio = await this.calls.recording(id);
    res.set({
      "Content-Type": audio.contentType,
      "Cache-Control": "private, no-store",
      ...(audio.contentLength === undefined
        ? {}
        : { "Content-Length": String(audio.contentLength) }),
    });
    return new StreamableFile(audio.body);
  }

  /**
   * החזרת שיחה לתור המשיכה. אותה יכולת כמו השמעה — מי שרשאי
   * לשמוע את ההקלטה רשאי לבקש שננסה להביא אותה שוב.
   */
  @Post(":id/recording/retry")
  @RequireCapability("leads.view_own", "buyers.view_own")
  @HttpCode(200)
  async retryRecording(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
  ): Promise<{ queued: boolean }> {
    return this.calls.retryRecording(id);
  }

  @Delete(":id")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.calls.remove(id);
    return { ok: true };
  }
}
