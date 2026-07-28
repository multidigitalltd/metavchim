import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module";
import { ImportController } from "./import.controller";

@Module({
  imports: [PropertiesModule],
  controllers: [ImportController],
})
export class ImportModule {}
