import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { RequireCapability } from "../../common/auth.decorators";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { TranscriptionService, type TranscriptionStatus } from "./transcription.service";
import { VoiceIntakeService, type IntakeResult } from "./voice-intake.service";

const IntakeSchema = z
  .object({
    transcript: z.string().min(5).max(4000),
  })
  .strict();

/** גבול גודל להעלאת אודיו — דקות ספורות של הקלטה דחוסה. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

@Controller("voice-intakes")
export class VoiceIntakeController {
  constructor(
    private readonly service: VoiceIntakeService,
    private readonly transcription: TranscriptionService,
  ) {}

  /** האם תמלול בשרת מוכן, ובאיזה קצב — הממשק מתאים את עצמו. */
  @Get("transcription-status")
  @RequireCapability("properties.view")
  async transcriptionStatus(): Promise<TranscriptionStatus> {
    return this.transcription.status();
  }

  /**
   * תמלול הקלטה בשרת — האודיו מתומלל מקומית ונמחק מיד; לא נשמר
   * ולא נשלח לשום ספק חיצוני (docs/04 — פרטיות).
   */
  @Post("transcribe")
  @HttpCode(200)
  @RequireCapability("properties.view")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  async transcribe(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<{ text: string }> {
    if (!file?.buffer?.length) throw new BadRequestException("לא התקבלה הקלטה");
    return this.transcription.transcribe(file.buffer, file.originalname || "audio.webm");
  }

  @Post()
  @RequireCapability("properties.create")
  async intake(
    @Body(new ZodValidationPipe(IntakeSchema)) body: z.infer<typeof IntakeSchema>,
  ): Promise<IntakeResult> {
    return this.service.intake(body.transcript);
  }
}
