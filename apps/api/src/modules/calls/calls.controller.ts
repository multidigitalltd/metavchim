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
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CallsService, type CallDto } from "./calls.service";

const OutcomeSchema = z.enum(["answered", "missed", "no_answer", "voicemail"]);

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
    outcome: OutcomeSchema.optional(),
    leadId: IdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

/** שיחה של חצי שעה ב-webm שוקלת בערך 15MB; 40 נותן מרווח נוח. */
const MAX_RECORDING_BYTES = 40 * 1024 * 1024;

/** יומן שיחות — תיעוד ידני של שיחות שהמתווך קיים. */
@Controller("calls")
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  @RequireCapability("leads.view_own")
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
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECORDING_BYTES, files: 1 } }))
  async attachRecording(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ status: string }> {
    if (!file) throw new BadRequestException("לא צורף קובץ");
    return this.calls.attachRecording(id, { buffer: file.buffer, mimetype: file.mimetype });
  }

  @Delete(":id")
  @RequireCapability("leads.edit")
  @HttpCode(200)
  async remove(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<{ ok: true }> {
    await this.calls.remove(id);
    return { ok: true };
  }
}
