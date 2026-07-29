import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";

@Module({
  imports: [ContactsModule, BuyersModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
