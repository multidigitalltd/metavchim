import { Module } from "@nestjs/common";
import { AgentEventsService } from "../agent/agent-events.service";
import { MentorController } from "./mentor.controller";
import { MentorReviewService } from "./mentor-review.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

@Module({
  controllers: [MentorController],
  /*
   * יומן האירועים מסופק כאן ולא מיובא מ-AgentModule: זה היה מעגל
   * (AgentModule מייבא את המנטור בשביל פעולות הסוכן). השירות תלוי
   * ב-Prisma הגלובלי בלבד, ולכן מופע שני שלו הוא אותו יומן.
   */
  providers: [
    MentorService,
    MentorSignalsService,
    MentorReviewService,
    AgentEventsService,
  ],
  // הסוכן בשיחה (מסך ווואטסאפ) מדבר עם אותו מנטור — לא מסלול שני
  exports: [MentorService],
})
export class MentorModule {}
