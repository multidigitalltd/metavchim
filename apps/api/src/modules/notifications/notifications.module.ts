import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { PushController } from "./push.controller";

/*
 * השירות מיוצא: הסוכן קורא ל-`unread` כדי לענות „מה חדש”. זו הסיבה
 * שהתנאי „למי ההתראה שייכת” יצא מהבקר — ערוץ שני שכותב אותו בעצמו
 * הוא עותק שני של כלל הרשאה.
 */
@Module({
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
