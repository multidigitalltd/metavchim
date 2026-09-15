import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module";
import { RecruitmentAdService } from "./recruitment-ad.service";
import { RecruitmentController } from "./recruitment.controller";
import { RecruitmentService } from "./recruitment.service";

/**
 * ‏„נכסים לגיוס” — מודול נפרד מ„נכסים”, ובכוונה.
 *
 * ‏התלות היא **חד-כיוונית**: הגיוס מכיר את הנכסים כדי ליצור אחד
 * ברגע ההמרה, והנכסים אינם יודעים על הגיוס כלל. כך שום מסלול של
 * נכס — התאמות, רשת, הצעות, דפי נחיתה — אינו יכול להגיע בטעות
 * לשורת גיוס, גם לא בעריכה עתידית.
 */
@Module({
  imports: [PropertiesModule],
  controllers: [RecruitmentController],
  providers: [RecruitmentService, RecruitmentAdService],
  /*
   * ‏מיוצא כדי שמסלול הייבוא יוכל לקלוט שורות **לטבלת הגיוס**.
   * ‏זו התלות היחידה מבחוץ, והיא בכיוון הבטוח: מי שמייבא מקבל את
   * ‏הדרך לכתוב לגיוס, ולא את הדרך לכתוב לנכסים בשמו.
   */
  exports: [
    RecruitmentService,
    /*
     * ‎`RecruitmentAdService` — הסוכן בוואטסאפ מקבל תמונה של
     * ‏מודעה ופותח ממנה נכס לגיוס. הוא **אינו** כותב לטבלה בעצמו
     * ‏אלא עובר ב-`RecruitmentService.create`, אותו מסלול שהטופס
     * ‏קורא לו.
     */
    RecruitmentAdService,
  ],
})
export class RecruitmentModule {}
