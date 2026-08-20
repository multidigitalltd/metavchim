import { Module } from "@nestjs/common";
import { TranscriptionService } from "./transcription.service";
import { VoiceIntakeController } from "./voice-intake.controller";

/**
 * תמלול בלבד — אודיו ⟵ טקסט, ותו לא.
 *
 * כל ההבנה והקליטה עברו ל-`AgentModule`. מה שנשאר כאן הוא השירות
 * שהופך הקלטה לטקסט, שאותו הסוכן מקבל כקלט.
 */
@Module({
  controllers: [VoiceIntakeController],
  providers: [TranscriptionService],
  // משיכת הקלטות מהמרכזייה מזינה את אותו צינור תמלול
  exports: [TranscriptionService],
})
export class VoiceIntakeModule {}
