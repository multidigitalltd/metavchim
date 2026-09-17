import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AgreementsController } from "./agreements.controller";
import { AgreementsService } from "./agreements.service";
import { SignedDocumentsController } from "./signed-documents.controller";
import { SignedDocumentsService } from "./signed-documents.service";

@Module({
  /*
   * ‎`BuyersModule` — חותם של קישור החתמה פתוח שאין לו עדיין כרטיס
   * ‏מקבל אחד. אין מעגל: `BuyersModule` אינו מייבא את המודול הזה,
   * ‏לא במישרין ולא דרך מה שהוא מייבא.
   */
  imports: [BuyersModule, ContactsModule, EmailInboxModule, MessagingModule],
  controllers: [AgreementsController, SignedDocumentsController],
  providers: [AgreementsService, SignedDocumentsService],
  exports: [AgreementsService],
})
export class AgreementsModule {}
