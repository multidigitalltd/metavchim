import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AgreementsController } from "./agreements.controller";
import { AgreementsService } from "./agreements.service";
import { SignedDocumentsController } from "./signed-documents.controller";
import { SignedDocumentsService } from "./signed-documents.service";

@Module({
  imports: [ContactsModule, EmailInboxModule, MessagingModule],
  controllers: [AgreementsController, SignedDocumentsController],
  providers: [AgreementsService, SignedDocumentsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
