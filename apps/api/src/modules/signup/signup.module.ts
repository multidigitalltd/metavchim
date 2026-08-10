import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";
import { CouponService } from "./coupon.service";

/** הרשמה עצמית של משרד — נתיב ציבורי, ראו signup.controller.ts. */
@Module({
  imports: [AuthModule],
  controllers: [SignupController],
  providers: [SignupService, CouponService],
  // מסך הפלטפורמה מנהל את הקופונים דרך אותו שירות
  exports: [CouponService],
})
export class SignupModule {}
