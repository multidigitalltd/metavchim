import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailInboxController } from "./email-inbox.controller";
import { EmailInboxService } from "./email-inbox.service";

@Module({
  imports: [ContactsModule],
  controllers: [EmailInboxController],
  providers: [EmailInboxService],
  exports: [EmailInboxService],
})
export class EmailInboxModule {}
