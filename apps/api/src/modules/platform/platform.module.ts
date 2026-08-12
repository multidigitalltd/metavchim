import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { AuthModule } from "../auth/auth.module";
import { AccountDeletionService } from "../settings/account-deletion.service";
import { BackupsService } from "./backups.service";
import { PlatformController } from "./platform.controller";

/*
 * מחיקת משרד מהפלטפורמה מריצה את אותו שירות שמריצה מחיקה עצמית של
 * בעל המשרד — שני מסלולי אישור, מנגנון מחיקה אחד. שכפול שלו כאן היה
 * מבטיח שביום שתתווסף טבלה, אחד מהשניים יישכח וישאיר נתונים מאחור.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [BackupsService, CardcomService, AccountDeletionService],
})
export class PlatformModule {}
