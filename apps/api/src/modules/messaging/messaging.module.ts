import { Module } from "@nestjs/common";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";

@Module({
  controllers: [WhatsAppWebhookController],
  providers: [WhatsAppInboundService],
})
export class MessagingModule {}
