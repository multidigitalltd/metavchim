import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CardcomWebhookController } from "./cardcom-webhook.controller";
import { NumberRentalController } from "./number-rental.controller";
import { NumberRentalRenewalService } from "./number-rental-renewal.service";
import { NumberRentalService } from "./number-rental.service";
import { RenewalService } from "./renewal.service";
import { SubscriptionOfferService } from "./subscription-offer.service";

/** מנוי בתשלום וסליקת קארדקום — ראו billing.service.ts. */
@Module({
  controllers: [BillingController, CardcomWebhookController, NumberRentalController],
  providers: [
    BillingService,
    CardcomService,
    RenewalService,
    SubscriptionOfferService,
    NumberRentalService,
    NumberRentalRenewalService,
  ],
  // מיוצאים למסך הפלטפורמה: שם יוצרים הצעות ומנהלים השכרות מספרים
  exports: [BillingService, SubscriptionOfferService, NumberRentalService],
})
export class BillingModule {}
