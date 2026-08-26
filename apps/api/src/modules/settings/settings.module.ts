import { Module } from "@nestjs/common";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AccountDeletionService } from "./account-deletion.service";
import { AgreementTemplatesController } from "./agreement-templates.controller";
import { AutomationRulesController } from "./automation-rules.controller";
import { EmailDomainController } from "./email-domain.controller";
import { SettingsController } from "./settings.controller";
import { TenantLogoService } from "./tenant-logo.service";

@Module({
  /*
   * שמירת משקלי ההתאמה מפעילה סבב חישוב מחדש — ראו saveMatchWeights.
   * MessagingModule בשביל קישור הוואטסאפ (הנפקת קוד, מצב וניתוק).
   */
  imports: [MatchingModule, MessagingModule],
  controllers: [
    SettingsController,
    AgreementTemplatesController,
    AutomationRulesController,
    EmailDomainController,
  ],
  providers: [AccountDeletionService, TenantLogoService],
})
export class SettingsModule {}
