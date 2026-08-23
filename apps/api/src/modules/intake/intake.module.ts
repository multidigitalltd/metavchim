import { Module } from "@nestjs/common";
import { ContactsModule } from "../contacts/contacts.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

/**
 * טופס הדרישות של הלקוח.
 *
 * `exports` — קליטת הוובהוק של המרכזייה יוצרת בקשה מעצמה אחרי
 * שיחה שלא נענתה, ולכן `TelephonyModule` צורך את השירות הזה.
 */
@Module({
  imports: [ContactsModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
