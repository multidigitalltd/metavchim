import { Module } from "@nestjs/common";
import { MatchingModule } from "../matching/matching.module";
import { AccountDeletionService } from "./account-deletion.service";
import { AgreementTemplatesController } from "./agreement-templates.controller";
import { AutomationRulesController } from "./automation-rules.controller";
import { SettingsController } from "./settings.controller";

@Module({
  // שמירת משקלי ההתאמה מפעילה סבב חישוב מחדש — ראו saveMatchWeights
  imports: [MatchingModule],
  controllers: [SettingsController, AgreementTemplatesController, AutomationRulesController],
  providers: [AccountDeletionService],
})
export class SettingsModule {}
