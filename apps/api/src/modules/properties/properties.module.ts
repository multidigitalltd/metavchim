import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { PropertiesController } from "./properties.controller";
import { PropertiesService } from "./properties.service";

@Module({
  imports: [ContactsModule, MatchingModule, MessagingModule],
  controllers: [PropertiesController, MediaController],
  providers: [PropertiesService, MediaService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
