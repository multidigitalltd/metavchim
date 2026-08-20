import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { LeadsModule } from "../leads/leads.module";
import { PropertiesModule } from "../properties/properties.module";
import { ImportController } from "./import.controller";

@Module({
  imports: [PropertiesModule, BuyersModule, LeadsModule],
  controllers: [ImportController],
})
export class ImportModule {}
