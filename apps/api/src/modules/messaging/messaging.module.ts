import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { WhatsAppLinkService } from "./whatsapp-link.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/*
 * מודול עלה בכוונה — בלי imports. נכסים, הצעות והסכמים מייבאים אותו
 * בשביל MessagingService, ולכן כל תלות שנוספת כאן הופכת מיד למעגל.
 * הוובהוק והסוכן האישי, שתלויים ב-AgentModule, יושבים ב-WhatsAppModule
 * הנפרד — שאיש אינו מייבא חוץ מ-AppModule.
 */
@Module({
  providers: [MessagingService, WhatsAppSendService, WhatsAppLinkService],
  /*
   * WhatsAppSendService מיוצא לסוכן ולבדיקת החיבור ממסך הפלטפורמה.
   * WhatsAppLinkService יושב כאן ולא ב-WhatsAppModule כי שני צדדים
   * זקוקים לו: הסוכן (זיהוי) ומסך ההגדרות (הנפקה וניתוק), ומודול
   * העלה הזה הוא היחיד ששניהם יכולים לייבא בלי מעגל.
   */
  exports: [MessagingService, WhatsAppSendService, WhatsAppLinkService],
})
export class MessagingModule {}
