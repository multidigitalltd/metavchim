import { Module } from "@nestjs/common";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { CollaborationController } from "./collaboration.controller";
import { CollaborationService } from "./collaboration.service";
import { KankoWebhookController } from "./kanko-webhook.controller";

@Module({
  imports: [ExclusivityModule],
  controllers: [CollaborationController, KankoWebhookController],
  providers: [CollaborationService],
})
export class CollaborationModule {}
