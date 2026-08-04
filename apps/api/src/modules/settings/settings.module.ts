import { Module } from "@nestjs/common";
import { AgreementTemplatesController } from "./agreement-templates.controller";
import { SettingsController } from "./settings.controller";

@Module({
  controllers: [SettingsController, AgreementTemplatesController],
})
export class SettingsModule {}
