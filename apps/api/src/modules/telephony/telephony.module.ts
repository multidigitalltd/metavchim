import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { TelephonyController, TelephonyWebhookController } from "./telephony.controller";
import { TelephonyService } from "./telephony.service";
import { TelephonyWebhookLogService } from "./webhook-log.service";

@Module({
  // מספר הלקוח נפתר מהכרטיס ולא מגיע מהבקשה — ראו TelephonyService.dial
  imports: [ContactsModule],
  controllers: [TelephonyController, TelephonyWebhookController],
  providers: [TelephonyService, TelephonyWebhookLogService],
  // היומן מיוצא כדי שמסך הפלטפורמה יציג אותו — פנייה שנדחתה אינה
  // שייכת לאף משרד, ולכן אין לה מקום במסך ההגדרות של המשרד
  exports: [TelephonyService, TelephonyWebhookLogService],
})
export class TelephonyModule {}
