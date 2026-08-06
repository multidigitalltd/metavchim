import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsModule } from "../leads/leads.module";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { LandingController } from "./landing.controller";
import { LandingService } from "./landing.service";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { PropertiesController } from "./properties.controller";
import { PropertiesService } from "./properties.service";

@Module({
  imports: [ContactsModule, MatchingModule, MessagingModule, LeadsModule],
  controllers: [PropertiesController, MediaController, LandingController],
  providers: [PropertiesService, MediaService, LandingService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
