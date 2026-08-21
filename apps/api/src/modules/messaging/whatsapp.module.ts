import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { VoiceIntakeModule } from "../voice-intake/voice-intake.module";
import { MessagingModule } from "./messaging.module";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";
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
  imports: [AgentModule, VoiceIntakeModule, MessagingModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppInboundService, WhatsAppAssistantService],
})
export class WhatsAppModule {}
