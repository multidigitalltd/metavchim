import { Module } from "@nestjs/common";
import { AgreementsModule } from "../agreements/agreements.module";
import { ContactsModule } from "../contacts/contacts.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OffersController } from "./offers.controller";
import { OffersService } from "./offers.service";

@Module({
  imports: [AgreementsModule, ContactsModule, MessagingModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
