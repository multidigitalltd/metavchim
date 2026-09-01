import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ViewingReplyService } from "../calendar/viewing-reply.service";
import { VoiceIntakeModule } from "../voice-intake/voice-intake.module";
import { MessagingModule } from "./messaging.module";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";
import { WhatsAppConnectionController } from "./whatsapp-connection.controller";
import { WhatsAppConnectionService } from "./whatsapp-connection.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";

/**
 * צד הוואטסאפ הנכנס — הוובהוק, קליטת הלידים והסוכן האישי.
 *
 * מודול נפרד מ-MessagingModule ולא חלק ממנו, בגלל כיוון התלות:
 * הסוכן נשען על AgentModule, ו-AgentModule נשען (דרך PropertiesModule)
 * על MessagingService — כלומר צירוף שניהם למודול אחד היה מעגל
 * שמפיל את עליית ה-API. אף מודול אינו מייבא את המודול הזה חוץ
 * מ-AppModule; מי שצריך לשלוח הודעות מייבא את MessagingModule העלה.
 */
@Module({
  /*
   * ‎`ContactsModule` — לזיהוי מי לחץ על כפתור בתזכורת. הוא מודול
   * עלה מבחינת הכיוון הזה (אינו מייבא את הוואטסאפ), ולכן אין מעגל.
   */
  imports: [AgentModule, VoiceIntakeModule, MessagingModule, ContactsModule],
  controllers: [WhatsAppWebhookController, WhatsAppConnectionController],
  /*
   * ‎`ViewingReplyService` מסופק כאן ולא ב-CalendarModule: הוא נצרך
   * רק על ידי הוובהוק, וייבוא של מודול היומן לכאן היה גורר את כל
   * שרשרת התלויות שלו אל תוך נתיב הקליטה בלי צורך.
   */
  providers: [
    WhatsAppInboundService,
    WhatsAppAssistantService,
    ViewingReplyService,
    WhatsAppConnectionService,
  ],
  /*
   * החיבורים מיוצאים: הבוט ושכבת השליחה על קו של משרד (שלבים 2–3)
   * צריכים לשלוף את אישורי הקו, ואין סיבה שיעברו דרך הוובהוק.
   */
  exports: [WhatsAppConnectionService],
})
export class WhatsAppModule {}
