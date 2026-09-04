import { Module } from "@nestjs/common";
import { MentorController } from "./mentor.controller";
import { MentorReviewService } from "./mentor-review.service";
import { MentorSignalsService } from "./mentor-signals.service";
import { MentorService } from "./mentor.service";

@Module({
  controllers: [MentorController],
  providers: [MentorService, MentorSignalsService, MentorReviewService],
  // הסוכן בשיחה (מסך ווואטסאפ) מדבר עם אותו מנטור — לא מסלול שני
  exports: [MentorService],
})
export class MentorModule {}
