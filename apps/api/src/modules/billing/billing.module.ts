import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CardcomWebhookController } from "./cardcom-webhook.controller";
import { RenewalService } from "./renewal.service";

/** מנוי בתשלום וסליקת קארדקום — ראו billing.service.ts. */
@Module({
  controllers: [BillingController, CardcomWebhookController],
  providers: [BillingService, CardcomService, RenewalService],
  exports: [BillingService],
})
export class BillingModule {}
