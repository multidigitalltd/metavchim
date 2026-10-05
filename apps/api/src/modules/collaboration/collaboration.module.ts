import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { CollaborationController } from "./collaboration.controller";
import { CollaborationService } from "./collaboration.service";
import { DealRoomService } from "./deal-room.service";
import { DemandFollowSweepService } from "./demand-follow-sweep.service";
import { KankoWebhookController } from "./kanko-webhook.controller";
import { ListingsService } from "./listings.service";

@Module({
  imports: [ContactsModule, ExclusivityModule],
  controllers: [CollaborationController, KankoWebhookController],
  providers: [
    CollaborationService,
    DealRoomService,
    DemandFollowSweepService,
    ListingsService,
  ],
  exports: [CollaborationService, DealRoomService, ListingsService],
})
export class CollaborationModule {}
