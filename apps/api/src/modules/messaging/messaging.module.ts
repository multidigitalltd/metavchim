import { Module } from "@nestjs/common";
import { MessagingService } from "./messaging.service";
import { WhatsAppSendService } from "./whatsapp-send.service";

/*
 * מודול עלה בכוונה — בלי imports. נכסים, הצעות והסכמים מייבאים אותו
 * בשביל MessagingService, ולכן כל תלות שנוספת כאן הופכת מיד למעגל.
 * הוובהוק והסוכן האישי, שתלויים ב-AgentModule, יושבים ב-WhatsAppModule
 * הנפרד — שאיש אינו מייבא חוץ מ-AppModule.
 */
@Module({
  providers: [MessagingService, WhatsAppSendService],
  // WhatsAppSendService מיוצא לסוכן ולבדיקת החיבור ממסך הפלטפורמה
  exports: [MessagingService, WhatsAppSendService],
})
export class MessagingModule {}
