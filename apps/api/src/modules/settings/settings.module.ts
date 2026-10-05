import { Module } from "@nestjs/common";
import { OfficeSettingsService } from "./office-settings.service";
import { TeamService } from "./team.service";
import { MatchingModule } from "../matching/matching.module";
import { MessagingModule } from "../messaging/messaging.module";
import { AccountDeletionService } from "./account-deletion.service";
import { ActivationNudgeController } from "./activation-nudge.controller";
import { AgreementTemplatesController } from "./agreement-templates.controller";
import { AutomationRulesController } from "./automation-rules.controller";
import { EmailDomainController } from "./email-domain.controller";
import { SettingsController } from "./settings.controller";

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
    ActivationNudgeController,
  ],
  providers: [AccountDeletionService, TeamService, OfficeSettingsService],
  /*
   * ‎`TeamService` — „תוסיף סוכן” מהשיחה עובר כאן, ולא במסלול
   * ‏כתיבה שני: המכסה, המנעול והיומן יושבים בו.
   */
  /*
   * ‎`OfficeSettingsService` — „תכבה פרסום אוטומטי לרשת” מהשיחה
   * ‏עובר כאן: הנעילה, המחיקה-במקום-ריק וחותמת ההצעות יושבות בו.
   */
  exports: [TeamService, OfficeSettingsService],
})
export class SettingsModule {}
