import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module";
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
  providers: [RecruitmentService],
  /*
   * ‏מיוצא כדי שמסלול הייבוא יוכל לקלוט שורות **לטבלת הגיוס**.
   * ‏זו התלות היחידה מבחוץ, והיא בכיוון הבטוח: מי שמייבא מקבל את
   * ‏הדרך לכתוב לגיוס, ולא את הדרך לכתוב לנכסים בשמו.
   */
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
