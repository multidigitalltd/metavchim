import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { IntakeModule } from "../intake/intake.module";
import { MessagingModule } from "../messaging/messaging.module";
import { VoiceIntakeModule } from "../voice-intake/voice-intake.module";
import { RecordingFetchService } from "./recording-fetch.service";
import { TelephonyPresenceController } from "./telephony-presence.controller";
import { TelephonyController, TelephonyWebhookController } from "./telephony.controller";
import { TelephonyService } from "./telephony.service";
import { WebhookLogModule } from "../webhook-log/webhook-log.module";
import { VirtualNumbersController } from "./virtual-numbers.controller";

@Module({
  // מספר הלקוח נפתר מהכרטיס ולא מגיע מהבקשה — ראו TelephonyService.dial
  // התמלול מגיע מ-VoiceIntake: הקלטה שנמשכה מהמרכזייה נכנסת
  // לאותו צינור של הקלטה שהועלתה ידנית
  //
  // שיחה נכנסת שלא נענתה שולחת ללקוח קישור לטופס הדרישות: הבקשה
  // נוצרת ב-IntakeModule והשליחה עוברת ב-MessagingModule. שניהם
  // מודולי עלה מבחינת התלות הזו, ולכן אין כאן מעגל.
  imports: [ContactsModule, VoiceIntakeModule, IntakeModule, MessagingModule, WebhookLogModule],
  controllers: [
    TelephonyController,
    // מחוץ לשער הפיצ'ר — ראו ההסבר במחלקה
    TelephonyPresenceController,
    TelephonyWebhookController,
    VirtualNumbersController,
  ],
  providers: [TelephonyService, RecordingFetchService],
  exports: [TelephonyService],
})
export class TelephonyModule {}
