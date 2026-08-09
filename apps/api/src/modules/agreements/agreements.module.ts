import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AgreementsController } from "./agreements.controller";
import { AgreementsService } from "./agreements.service";

@Module({
  imports: [ContactsModule, MessagingModule],
  controllers: [AgreementsController],
  providers: [AgreementsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
