import { Module } from "@nestjs/common";
import { SupportInboxDeskController } from "./support-inbox.controller";
import { SupportInboxService } from "./support-inbox.service";
import { SupportController, SupportDeskController } from "./support.controller";
import { SupportService } from "./support.service";

/*
 * תיבת התמיכה יושבת כאן ולא במודול נפרד: היא אותה עבודה בדיוק —
 * פנייה שממתינה למענה — ורק הערוץ שונה. מסך אחד בפלטפורמה קורא
 * לשניהם.
 */
@Module({
  controllers: [
    SupportController,
    SupportDeskController,
    SupportInboxDeskController,
  ],
  providers: [SupportService, SupportInboxService],
  // SupportService מיוצא לסוכן — „תפתח פנייה לתמיכה” מהצ'אט
  exports: [SupportService, SupportInboxService],
})
export class SupportModule {}
