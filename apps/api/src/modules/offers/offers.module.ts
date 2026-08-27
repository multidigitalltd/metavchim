import { Module } from "@nestjs/common";
import { AgreementsModule } from "../agreements/agreements.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { OfferEmailService } from "./offer-email.service";
import { OffersController } from "./offers.controller";
import { OffersService } from "./offers.service";

@Module({
  imports: [AgreementsModule, ContactsModule, MessagingModule, ExclusivityModule],
  controllers: [OffersController],
  providers: [OffersService, OfferEmailService],
  exports: [OffersService],
})
export class OffersModule {}
