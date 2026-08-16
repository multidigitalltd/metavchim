import { Module } from "@nestjs/common";
import { ExclusivityController } from "./exclusivity.controller";
import { ExclusivityService } from "./exclusivity.service";

/*
 * השירות מיוצא: מודולים אחרים (הצעות, יומן, שיתופי פעולה) קוראים
 * ל-`recordAuto` בתוך הטרנזקציות שלהם. זו הדרך היחידה שבה פעולת
 * שיווק תתועד בלי לבקש מהסוכן לזכור לתעד אותה.
 */
@Module({
  controllers: [ExclusivityController],
  providers: [ExclusivityService],
  exports: [ExclusivityService],
})
export class ExclusivityModule {}
