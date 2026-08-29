import { Module } from "@nestjs/common";
import { PayoutDeskController, PayoutsController } from "./payouts.controller";
import { PayoutsService } from "./payouts.service";

/*
 * שני קונטרולרים ושירות אחד — בדיוק כמו התמיכה: המשרד מבקש,
 * הפלטפורמה מחליטה, וההיגיון הכספי חי במקום אחד. שכפולו לשני
 * שירותים היה מבטיח שביום שכלל יזוז, צד אחד יישכח.
 */
@Module({
  controllers: [PayoutsController, PayoutDeskController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
