import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

/**
 * טופס הדרישות של הלקוח.
 *
 * `exports` — קליטת הוובהוק של המרכזייה יוצרת בקשה מעצמה אחרי
 * שיחה שלא נענתה, ולכן `TelephonyModule` צורך את השירות הזה.
 *
 * `BuyersModule` — מה שהלקוח שלח נכנס לכרטיס דרך `BuyersService`
 * ולא בכתיבה ישירה, כדי שהעמודות החמות, ההתאמות והביקוש ברשת
 * יתעדכנו כמו בכל עריכה אחרת. ראו `applyToBuyer`.
 */
@Module({
  imports: [BuyersModule, ContactsModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
