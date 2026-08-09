import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CardcomWebhookController } from "./cardcom-webhook.controller";

/** מנוי בתשלום וסליקת קארדקום — ראו billing.service.ts. */
@Module({
  controllers: [BillingController, CardcomWebhookController],
  providers: [BillingService, CardcomService],
  exports: [BillingService],
})
export class BillingModule {}
