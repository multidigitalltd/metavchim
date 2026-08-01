import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { WebLeadController } from "./web-lead.controller";
import { WebLeadService } from "./web-lead.service";

@Module({
  imports: [ContactsModule, BuyersModule],
  controllers: [LeadsController, WebLeadController],
  providers: [LeadsService, WebLeadService],
  exports: [LeadsService],
})
export class LeadsModule {}
