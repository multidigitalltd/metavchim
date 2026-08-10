import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { WebLeadController } from "./web-lead.controller";
import { WebLeadService } from "./web-lead.service";

@Module({
  imports: [ContactsModule, BuyersModule, PropertiesModule],
  controllers: [LeadsController, WebLeadController],
  providers: [LeadsService, WebLeadService],
  exports: [LeadsService, WebLeadService],
})
export class LeadsModule {}
