import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsModule } from "../leads/leads.module";
import { GmailOutboundService } from "./gmail-outbound.service";
import { GmailSyncService } from "./gmail-sync.service";
import { GmailController } from "./gmail.controller";
import { GmailService } from "./gmail.service";

@Module({
  // ContactsModule: הדואר היוצא שולף את כתובת הלקוח מהכרטיס ואינו
  // מקבל אותה מהמסך
  imports: [LeadsModule, ContactsModule],
  controllers: [GmailController],
  providers: [GmailService, GmailSyncService, GmailOutboundService],
})
export class GmailModule {}
