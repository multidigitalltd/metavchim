import { Module } from "@nestjs/common";
import { AgreementsModule } from "../agreements/agreements.module";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { ExclusivityModule } from "../exclusivity/exclusivity.module";
import { MessagingModule } from "../messaging/messaging.module";
import { ComparisonController } from "./comparison.controller";
import { ComparisonService } from "./comparison.service";
import { OfferEmailService } from "./offer-email.service";
import { OffersController } from "./offers.controller";
import { OffersService } from "./offers.service";

@Module({
  imports: [AgreementsModule, ContactsModule, EmailInboxModule, MessagingModule, ExclusivityModule],
  controllers: [OffersController, ComparisonController],
  providers: [OffersService, OfferEmailService, ComparisonService],
  exports: [OffersService],
})
export class OffersModule {}
