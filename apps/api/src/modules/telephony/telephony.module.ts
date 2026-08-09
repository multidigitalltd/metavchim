import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { TelephonyController, TelephonyWebhookController } from "./telephony.controller";
import { TelephonyService } from "./telephony.service";

@Module({
  // מספר הלקוח נפתר מהכרטיס ולא מגיע מהבקשה — ראו TelephonyService.dial
  imports: [ContactsModule],
  controllers: [TelephonyController, TelephonyWebhookController],
  providers: [TelephonyService],
  exports: [TelephonyService],
})
export class TelephonyModule {}
