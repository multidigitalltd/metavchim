import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppInboundService, MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
