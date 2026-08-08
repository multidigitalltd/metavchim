import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { TranscriptionService } from "../voice-intake/transcription.service";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";

/**
 * TranscriptionService מסופק כאן ישירות ולא דרך ייבוא של
 * VoiceIntakeModule: הוא חסר תלויות (קורא סביבה ופונה ב-HTTP),
 * וייבוא המודול היה גורר את כל שרשרת הנכסים/קונים/לידים לתוך
 * מודול השיחות — ומסתכן בתלות מעגלית על לא כלום.
 */
@Module({
  imports: [ContactsModule],
  controllers: [CallsController],
  providers: [CallsService, TranscriptionService],
  exports: [CallsService],
})
export class CallsModule {}
