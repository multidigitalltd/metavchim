import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { CollaborationController } from "./collaboration.controller";
import { CollaborationService } from "./collaboration.service";
import { KankoWebhookController } from "./kanko-webhook.controller";
import { ListingsService } from "./listings.service";

@Module({
  imports: [ContactsModule, ExclusivityModule],
  controllers: [CollaborationController, KankoWebhookController],
  providers: [CollaborationService, ListingsService],
  exports: [CollaborationService, ListingsService],
})
export class CollaborationModule {}
