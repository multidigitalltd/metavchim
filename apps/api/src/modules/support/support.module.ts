import { Module } from "@nestjs/common";
import { EmailInboxModule } from "../email-inbox/email-inbox.module";
import {
  SupportInboxDeskController,
  SupportInboxPublicController,
} from "./support-inbox.controller";
import { SupportInboxService } from "./support-inbox.service";
import { SupportController, SupportDeskController } from "./support.controller";
import { SupportService } from "./support.service";

/*
 * תיבת התמיכה יושבת כאן ולא במודול נפרד: היא אותה עבודה בדיוק —
 * פנייה שממתינה למענה — ורק הערוץ שונה. מסך אחד בפלטפורמה קורא
 * לשניהם.
 */
@Module({
  /*
   * ‎**התיבה הכללית מוסרת הלאה את מה שאינו שלה.**
   *
   * מרגע שכל הדואר של הדומיין נכנס בדלת אחת, תשובות לקוחות של
   * המשרדים מגיעות לאותו Webhook — והן שייכות לתיבת המשרד ולא
   * לשולחן התמיכה. `EmailInboxModule` הוא עלה מבחינת התלות הזאת
   * (הוא מייבא Contacts ו-Messaging בלבד, ו-Messaging הוא עלה
   * במכוון), ולכן אין כאן מעגל.
   */
  imports: [EmailInboxModule],
  controllers: [
    SupportController,
    SupportDeskController,
    SupportInboxPublicController,
    SupportInboxDeskController,
  ],
  providers: [SupportService, SupportInboxService],
  // SupportService מיוצא לסוכן — „תפתח פנייה לתמיכה” מהצ'אט
  exports: [SupportService, SupportInboxService],
})
export class SupportModule {}
