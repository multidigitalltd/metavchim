import { Module } from "@nestjs/common";
import { CollaborationController } from "./collaboration.controller";
import { CollaborationService } from "./collaboration.service";
import { KankoWebhookController } from "./kanko-webhook.controller";

@Module({
  controllers: [CollaborationController, KankoWebhookController],
  providers: [CollaborationService],
})
export class CollaborationModule {}
