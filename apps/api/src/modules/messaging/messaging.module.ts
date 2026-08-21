import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { VoiceIntakeModule } from "../voice-intake/voice-intake.module";
import { MessagingService } from "./messaging.service";
import { WhatsAppAssistantService } from "./whatsapp-assistant.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppSendService } from "./whatsapp-send.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";

/*
 * הסוכן האישי בוואטסאפ נשען על מנוע הסוכן (AgentModule) ועל התמלול
 * (VoiceIntakeModule) — אותם שירותים שהמסך הקולי משתמש בהם, כדי
 * שהתנהגות זהה לא תישבר בין שני הערוצים.
 */
@Module({
  imports: [AgentModule, VoiceIntakeModule],
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppInboundService, WhatsAppAssistantService, WhatsAppSendService, MessagingService],
  // WhatsAppSendService מיוצא לבדיקת החיבור ממסך הפלטפורמה
  exports: [MessagingService, WhatsAppSendService],
})
export class MessagingModule {}
