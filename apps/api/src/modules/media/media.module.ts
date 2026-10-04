import { Module } from "@nestjs/common";
import { MediaAdminController } from "./media-admin.controller";
import { MediaAdminService } from "./media-admin.service";
import { MediaClosingReminderService } from "./media-closing-reminder.service";
import { MediaController } from "./media.controller";
import { MediaCreativesService } from "./media-creatives.service";
import { MediaImagesService } from "./media-images.service";
import { MediaPublicController } from "./media-public.controller";
import { MediaMailService } from "./media-mail.service";
import { MediaService } from "./media.service";

/**
 * רכש מדיה — ארכיון המדיות, המוצרים וההזמנות. ראו media.service.ts.
 *
 * ‎`MediaService` מיוצא ל-`BillingModule`: הוובהוק של קארדקום עובר
 * דרך `BillingService.apply`, וזה מה שמסמן את ההזמנה כשולמה ושולח
 * אותה לנציג. הכיוון הוא גבייה ⟵ מדיה, ולא להפך — המודול הזה אינו
 * מייבא את הגבייה, ולכן אין מעגל.
 */
@Module({
  controllers: [MediaController, MediaAdminController, MediaPublicController],
  providers: [
    MediaService,
    MediaAdminService,
    MediaImagesService,
    MediaCreativesService,
    MediaMailService,
    MediaClosingReminderService,
  ],
  exports: [MediaService],
})
export class MediaModule {}
