import { Module } from "@nestjs/common";
import { CoreModule } from "../../core/core.module";
import { WebhookLogService } from "./webhook-log.service";

/**
 * ‎**היומן יצא מ-`telephony/`, וזו אינה תזוזה קוסמטית.**
 *
 * ‏הוא נבנה למרכזייה, אבל השאלה שהוא עונה עליה — „הפנייה הגיעה
 * ‏ונדחתה, או שלא הגיעה כלל?” — אינה של המרכזייה. וובהוק הלידים
 * ‏שאל אותה בדיוק, ולא הייתה לו תשובה.
 *
 * ‏השארתו במקומו הייתה מחייבת את מודול הלידים לייבא את מודול
 * ‏המרכזייה כדי לכתוב שורת יומן — תלות שאין לה שום משמעות אמיתית,
 * ‏וכזו שגוררת איתה את כל מה שהמרכזייה תלויה בו.
 */
@Module({
  imports: [CoreModule],
  providers: [WebhookLogService],
  exports: [WebhookLogService],
})
export class WebhookLogModule {}
