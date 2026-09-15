import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { ContactsModule } from "../contacts/contacts.module";
import { TranscriptionService } from "../voice-intake/transcription.service";
import { CallsController } from "./calls.controller";
import { CallsService } from "./calls.service";

/**
 * TranscriptionService מסופק כאן ישירות ולא דרך ייבוא של
 * VoiceIntakeModule: הוא חסר תלויות (קורא סביבה ופונה ב-HTTP),
 * וייבוא המודול היה גורר את כל שרשרת הנכסים/קונים/לידים לתוך
 * מודול השיחות — ומסתכן בתלות מעגלית על לא כלום.
 *
 * ‎`LeadsModule` **כן** מיובא, וזה אינו סותר: `ensureLead` צריך
 * ‏באמת לפתוח ליד, ולא רק „על לא כלום”. אין מעגל — שרשרת הלידים
 * ‏(לידים ← קונים ← שיתוף/התאמות) אינה מייבאת את מודול השיחות;
 * ‏מי שכן הם `AgentModule` ו-`CalendarModule`, ושניהם מחוץ לה.
 */
@Module({
  imports: [ContactsModule, LeadsModule],
  controllers: [CallsController],
  providers: [CallsService, TranscriptionService],
  exports: [CallsService],
})
export class CallsModule {}
