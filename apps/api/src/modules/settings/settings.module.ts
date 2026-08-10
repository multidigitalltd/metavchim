import { Module } from "@nestjs/common";
import { AccountDeletionService } from "./account-deletion.service";
import { AgreementTemplatesController } from "./agreement-templates.controller";
import { SettingsController } from "./settings.controller";

@Module({
  controllers: [SettingsController, AgreementTemplatesController],
  providers: [AccountDeletionService],
})
export class SettingsModule {}
