import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { GmailSyncService } from "./gmail-sync.service";
import { GmailController } from "./gmail.controller";
import { GmailService } from "./gmail.service";

@Module({
  imports: [LeadsModule],
  controllers: [GmailController],
  providers: [GmailService, GmailSyncService],
})
export class GmailModule {}
