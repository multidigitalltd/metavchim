import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { AuthModule } from "../auth/auth.module";
import { BillingModule } from "../billing/billing.module";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import { FunnelModule } from "../funnel/funnel.module";
import { MessagingModule } from "../messaging/messaging.module";
import { TelephonyModule } from "../telephony/telephony.module";
import { WebhookLogModule } from "../webhook-log/webhook-log.module";
import { OfficeSettingsService } from "../settings/office-settings.service";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { AgentUsageController } from "./agent-usage.controller";
import { AgentUsageService } from "./agent-usage.service";
import { BackupsService } from "./backups.service";
import { DiskSpaceService } from "./disk-space.service";
import { FunnelCopyController } from "./funnel-copy.controller";
import { IntegrationDeskController } from "./integration-desk.controller";
import { IntegrationDeskService } from "./integration-desk.service";
import { PlatformController } from "./platform.controller";
import { PlatformCreditsService } from "./platform-credits.service";
import { ServiceVersionsService } from "./service-versions.service";

/*
 * מחיקת משרד מהפלטפורמה מריצה את אותו שירות שמריצה מחיקה עצמית של
 * בעל המשרד — שני מסלולי אישור, מנגנון מחיקה אחד. שכפול שלו כאן היה
 * מבטיח שביום שתתווסף טבלה, אחד מהשניים יישכח וישאיר נתונים מאחור.
 */
@Module({
  // יומן הוובהוקים של המרכזיות מוצג כאן ולא בהגדרות המשרד: פנייה
  // עם מפתח לא מוכר אינה שייכת לאף משרד, וזו בדיוק הפנייה שמחפשים
  // MessagingModule — בדיקת חיבור הוואטסאפ של הסוכן האישי מהמסך
  // BillingModule — יצירת הצעות מנוי בלינק (SubscriptionOfferService)
  // FunnelModule — פתיחה מחדש של רישום כשמנהל מחזיר למשרד ניסיון
  /*
   * ‏`EmailInboxModule` — רק בשביל `inboundConfig()` בבדיקת שרשרת
   * ‏התשובה. הכלל „צריך גם כתובת וגם סוד” חייב להיות אותו כלל
   * ‏שהשליחה מפעילה, אחרת הבדיקה תאמר „מוגדר” על מה שהשליחה רואה
   * ‏כלא מוגדר.
   */
  imports: [
    AuthModule,
    TelephonyModule,
    MessagingModule,
    BillingModule,
    FunnelModule,
    WebhookLogModule,
    EmailInboxModule,
  ],
  /*
   * שולחן החיבורים בקונטרולר משלו: הגבול שלו הוא שהוא נוגע בטבלת
   * החיבורים בלבד, ומבחן מבני קורא בדיוק את שני הקבצים האלה.
   */
  controllers: [
    PlatformController,
    AgentUsageController,
    IntegrationDeskController,
    FunnelCopyController,
  ],
  providers: [
    BackupsService,
    DiskSpaceService,
    IntegrationDeskService,
    CardcomService,
    AccountDeletionService,
    /*
     * ‏פרטי המשרד נקראים בשולחן המשרדים דרך אותו קורא שהמשרד עצמו
     * ‏משתמש בו, עם מזהה מפורש — ולא בפירוש שני של אותו JSON.
     */
    OfficeSettingsService,
    ServiceVersionsService,
    PlatformCreditsService,
    AgentUsageService,
  ],
})
export class PlatformModule {}
