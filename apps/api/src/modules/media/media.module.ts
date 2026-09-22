import { Module } from "@nestjs/common";
import { MediaAdminController } from "./media-admin.controller";
import { MediaAdminService } from "./media-admin.service";
import { MediaController } from "./media.controller";
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
  controllers: [MediaController, MediaAdminController],
  providers: [MediaService, MediaAdminService],
  exports: [MediaService],
})
export class MediaModule {}
