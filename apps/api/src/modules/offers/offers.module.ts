import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OffersController } from "./offers.controller";
import { OffersService } from "./offers.service";

@Module({
  imports: [ContactsModule, MessagingModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
