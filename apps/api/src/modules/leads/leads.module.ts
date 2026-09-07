import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { WebLeadController } from "./web-lead.controller";
import { WebLeadService } from "./web-lead.service";
import { WebhookLogModule } from "../webhook-log/webhook-log.module";

@Module({
  imports: [ContactsModule, BuyersModule, WebhookLogModule],
  controllers: [LeadsController, WebLeadController],
  providers: [LeadsService, WebLeadService],
  exports: [LeadsService, WebLeadService],
})
export class LeadsModule {}
