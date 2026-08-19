import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { AuthModule } from "../auth/auth.module";
import { TelephonyModule } from "../telephony/telephony.module";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { BackupsService } from "./backups.service";
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
  imports: [AuthModule, TelephonyModule],
  controllers: [PlatformController],
  providers: [
    BackupsService,
    CardcomService,
    AccountDeletionService,
    ServiceVersionsService,
    PlatformCreditsService,
  ],
})
export class PlatformModule {}
