import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CardcomWebhookController } from "./cardcom-webhook.controller";
import { RenewalService } from "./renewal.service";
import { SubscriptionOfferService } from "./subscription-offer.service";

/** מנוי בתשלום וסליקת קארדקום — ראו billing.service.ts. */
@Module({
  controllers: [BillingController, CardcomWebhookController],
  providers: [BillingService, CardcomService, RenewalService, SubscriptionOfferService],
  // SubscriptionOfferService מיוצא למסך הפלטפורמה — שם יוצרים הצעות
  exports: [BillingService, SubscriptionOfferService],
})
export class BillingModule {}
