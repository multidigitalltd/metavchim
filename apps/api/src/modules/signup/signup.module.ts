import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PublicPlansController } from "./public-plans.controller";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";
import { CouponService } from "./coupon.service";
import { SignupVerificationService } from "./signup-verification.service";

/** הרשמה עצמית של משרד — נתיב ציבורי, ראו signup.controller.ts. */
@Module({
  imports: [AuthModule],
  controllers: [SignupController, PublicPlansController],
  providers: [SignupService, CouponService, SignupVerificationService],
  // מסך הפלטפורמה מנהל את הקופונים דרך אותו שירות
  exports: [CouponService],
})
export class SignupModule {}
