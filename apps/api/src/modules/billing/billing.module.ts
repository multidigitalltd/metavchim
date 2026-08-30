import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { LinetService } from "../../core/linet.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CardcomWebhookController } from "./cardcom-webhook.controller";
import { InvoiceService } from "./invoice.service";
import { NumberRentalController } from "./number-rental.controller";
import { NumberRentalRenewalService } from "./number-rental-renewal.service";
import { NumberRentalService } from "./number-rental.service";
import { RenewalService } from "./renewal.service";
import { SubscriptionOfferService } from "./subscription-offer.service";
import { WhatsappSeatController } from "./whatsapp-seat.controller";
import { WhatsappSeatRenewalService } from "./whatsapp-seat-renewal.service";
import { WhatsappSeatService } from "./whatsapp-seat.service";

/** מנוי בתשלום וסליקת קארדקום — ראו billing.service.ts. */
@Module({
  controllers: [
    BillingController,
    CardcomWebhookController,
    NumberRentalController,
    WhatsappSeatController,
  ],
  providers: [
    BillingService,
    CardcomService,
    RenewalService,
    SubscriptionOfferService,
    NumberRentalService,
    NumberRentalRenewalService,
    WhatsappSeatService,
    WhatsappSeatRenewalService,
    /*
     * חשבוניות מס קבלה — השירות נושא גם את הסורק שמשלים מסמכים
     * שנכשלו, ולכן הוא כאן ולא ב-core: הוא שייך לגבייה.
     */
    InvoiceService,
    LinetService,
  ],
  // מיוצאים למסך הפלטפורמה: שם יוצרים הצעות ומנהלים השכרות מספרים
  exports: [
    BillingService,
    SubscriptionOfferService,
    NumberRentalService,
    WhatsappSeatService,
    InvoiceService,
    LinetService,
  ],
})
export class BillingModule {}
