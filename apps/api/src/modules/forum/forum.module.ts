import { Module } from "@nestjs/common";
import { ForumController } from "./forum.controller";
import { ForumMailService } from "./forum-mail.service";
import { ForumNotifyService } from "./forum-notify.service";
import { ForumService } from "./forum.service";

/**
 * הפורום המקצועי (docs/16).
 *
 * מודול עלה: אינו מייבא את הסוכן או את הוואטסאפ, כדי ששניהם יוכלו
 * לייבא אותו בלי מעגל — הסוכן בשיחה ובוואטסאפ מדבר עם אותו שירות
 * של המסך, לא עם מסלול שני.
 */
@Module({
  controllers: [ForumController],
  providers: [ForumService, ForumNotifyService, ForumMailService],
  exports: [ForumService],
})
export class ForumModule {}
