import { Module } from "@nestjs/common";
import { MentorContentPlatformController } from "./mentor-content-platform.controller";
import { MentorContentService } from "./mentor-content.service";
import { AgentEventsService } from "../agent/agent-events.service";
import { MentorController } from "./mentor.controller";
import { MentorPracticeService } from "./mentor-practice.service";
import { MentorReviewService } from "./mentor-review.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

@Module({
  /* ‏שולחן התוכן של הפלטפורמה — בקר נפרד כי השער שלו אחר לגמרי */
  controllers: [MentorController, MentorContentPlatformController],
  /*
   * יומן האירועים מסופק כאן ולא מיובא מ-AgentModule: זה היה מעגל
   * (AgentModule מייבא את המנטור בשביל פעולות הסוכן). השירות תלוי
   * ב-Prisma הגלובלי בלבד, ולכן מופע שני שלו הוא אותו יומן.
   */
  providers: [
    MentorService,
    MentorSignalsService,
    MentorReviewService,
    MentorPracticeService,
    MentorContentService,
    AgentEventsService,
  ],
  // הסוכן בשיחה (מסך ווואטסאפ) מדבר עם אותו מנטור — לא מסלול שני
  /* ‏התרגול נדרש גם למנוע הפעולות (תרגול מהוואטסאפ) — לא רק לבקר */
  exports: [MentorService, MentorPracticeService],
})
export class MentorModule {}
