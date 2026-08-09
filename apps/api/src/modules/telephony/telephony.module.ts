import { Module } from "@nestjs/common";
import { TelephonyController, TelephonyWebhookController } from "./telephony.controller";
import { TelephonyService } from "./telephony.service";

@Module({
  controllers: [TelephonyController, TelephonyWebhookController],
  providers: [TelephonyService],
  exports: [TelephonyService],
})
export class TelephonyModule {}
