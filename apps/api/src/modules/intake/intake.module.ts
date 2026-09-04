import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { ContactsModule } from "../contacts/contacts.module";
import { MessagingModule } from "../messaging/messaging.module";
import { PropertiesModule } from "../properties/properties.module";
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
 *
 * `MessagingModule` — שליחת הקישור בוואטסאפ מהחיבור של המשרד.
 * הוא מודול **עלה** בלי `imports` משלו, ולכן הייבוא הזה אינו יוצר
 * מעגל; ‏`WhatsAppModule` (הוובהוק והסוכן) הוא זה שתלוי ב-
 * ‎`AgentModule`, ואותו איש אינו מייבא חוץ מ-`AppModule`.
 *
 * `PropertiesModule` — מאותו נימוק בדיוק לצד השני: מי שממלא „יש לי
 * נכס” מייצר **טיוטת נכס**, והיא נכתבת דרך `PropertiesService` כדי
 * שהמכסה, פענוח הכתובת, ציון המוכנות, היומן וההתאמות יעבדו כמו
 * בכל נכס אחר. ראו `createFromIntake`.
 */
@Module({
  imports: [BuyersModule, ContactsModule, MessagingModule, PropertiesModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
