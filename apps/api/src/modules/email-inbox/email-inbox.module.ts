import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { MessagingModule } from "../messaging/messaging.module";
import { EmailInboxController } from "./email-inbox.controller";
import { EmailInboxService } from "./email-inbox.service";

@Module({
  imports: [ContactsModule, MessagingModule],
  controllers: [EmailInboxController],
  providers: [EmailInboxService],
  exports: [EmailInboxService],
})
export class EmailInboxModule {}
