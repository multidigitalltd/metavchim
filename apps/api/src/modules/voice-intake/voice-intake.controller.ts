import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { RequireCapability } from "../../common/auth.decorators";
import { RequireFeature } from "../../common/feature.guard";
import { TranscriptionService, type TranscriptionStatus } from "./transcription.service";

/**
 * תמלול בלבד.
 *
 * קליטת הנכס מהתמלול עברה ל-`AgentModule`, שבו החילוץ נעשה במודל
 * ולא בחוקים והתוצאה מוצגת לאישור לפני שנשמרת. הנתיב שהיה כאן
 * המשיך ליצור נכסים במסלול הישן — כלומר שתי דרכים לקלוט נכס בקול,
 * עם שתי רמות דיוק.
 */

/** גבול גודל להעלאת אודיו — דקות ספורות של הקלטה דחוסה. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

@RequireFeature("voice_intake")
@Controller("voice-intakes")
export class VoiceIntakeController {
  constructor(private readonly transcription: TranscriptionService) {}

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

}
