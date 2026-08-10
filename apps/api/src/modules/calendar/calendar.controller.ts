import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { IdSchema } from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CalendarService, type AppointmentDto } from "./calendar.service";

/** אותה תקרה כמו בהקלטת שיחה — 40MB. */
const MAX_RECORDING_BYTES = 40 * 1024 * 1024;

const CreateSchema = z
  .object({
    kind: z.enum(["viewing", "meeting", "call"]),
    title: z.string().max(200).optional(),
    leadId: IdSchema.optional(),
    propertyId: IdSchema.optional(),
    buyerId: IdSchema.optional(),
    startsAt: z.coerce.date(),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional(),
    outcome: z.enum(["liked", "not_fit", "negotiating", "needs_other"]).optional(),
    notes: z.string().max(2000).optional(),
    title: z.string().max(200).optional(),
  })
  .strict();

/**
 * דחייה למועד חדש — ולא ביטול ופתיחה מחדש.
 *
 * ביטול ופתיחה היו שוברים את הקשר לנכס, לקונה ולהיסטוריה, ומאפסים
 * את המונה שאומר כמה פעמים הפגישה כבר נדחתה.
 */
const RescheduleSchema = z
  .object({
    startsAt: z.coerce.date(),
    durationMinutes: z.number().int().min(15).max(480).default(60),
    reason: z.string().max(300).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= 90 * 24 * 60 * 60 * 1000, {
    message: "טווח תאריכים לא תקין (מקסימום 90 יום)",
  });

@Controller("appointments")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Post()
  @RequireCapability("calendar.manage")
  async create(
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<AppointmentDto> {
    return this.calendar.create(body);
  }

  @Get()
  @RequireCapability("calendar.manage")
  async list(
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ): Promise<AppointmentDto[]> {
    return this.calendar.list(query);
  }

  /** פגישה בודדת — מסך העריכה נטען ממנה. */
  @Get(":id")
  @RequireCapability("calendar.manage")
  async getOne(@Param("id", new ZodValidationPipe(IdSchema)) id: string): Promise<AppointmentDto> {
    return this.calendar.getById(id);
  }

  /**
   * דחייה למועד חדש. `calendar.manage` — אותה יכולת שקובעת פגישה.
   */
  @Post(":id/reschedule")
  @RequireCapability("calendar.manage")
  @HttpCode(200)
  async reschedule(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(RescheduleSchema)) body: z.infer<typeof RescheduleSchema>,
  ): Promise<AppointmentDto> {
    return this.calendar.reschedule(id, body);
  }

  /**
   * הקלטה של פגישה שהתקיימה — נשמרת כשורת `calls` ומתומללת באותו
   * צינור. תקרת הגודל נאכפת ב-Multer, לפני שהקובץ נטען לזיכרון.
   */
  @Post(":id/recording")
  @RequireCapability("calendar.manage")
  @RequireFeature("transcription")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECORDING_BYTES, files: 1 } }))
  async attachRecording(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ callId: string; status: string }> {
    if (!file) throw new BadRequestException("לא צורף קובץ");
    return this.calendar.attachRecording(id, { buffer: file.buffer, mimetype: file.mimetype });
  }

  @Patch(":id")
  @RequireCapability("calendar.manage")
  async update(
    @Param("id", new ZodValidationPipe(IdSchema)) id: string,
    @Body(new ZodValidationPipe(UpdateSchema)) body: z.infer<typeof UpdateSchema>,
  ): Promise<AppointmentDto> {
    return this.calendar.update(id, body);
  }
}
