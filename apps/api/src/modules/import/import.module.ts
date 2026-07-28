import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { PropertiesModule } from "../properties/properties.module";
import { ImportController } from "./import.controller";

@Module({
  imports: [PropertiesModule, BuyersModule],
  controllers: [ImportController],
})
export class ImportModule {}
