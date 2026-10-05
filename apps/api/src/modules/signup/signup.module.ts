import { Module } from "@nestjs/common";
import { PublicPlansController } from "./public-plans.controller";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";
import { CouponService } from "./coupon.service";
import { SignupVerificationService } from "./signup-verification.service";

/** הרשמה עצמית של משרד — נתיב ציבורי, ראו signup.controller.ts. */
@Module({
  /*
   * ‎**בלי `imports: [AuthModule]`, ובכוונה.**
   *
   * ‏`AuthModule` מסומן `@Global`, ולכן `AuthService` זמין כאן גם
   * ‏בלי הייבוא — הוא היה עודף מלכתחילה. עכשיו הוא גם מזיק: הכניסה
   * ‏עם Google פותחת משרד חינמי דרך `SignupService`, כלומר
   * ‏`AuthModule` מייבא את המודול הזה, ושני ייבואים הדדיים הם מעגל
   * ‏שדורש `forwardRef`. הסרת הייבוא המיותר פותרת אותו בלי שום
   * ‏מנגנון נוסף.
   */
  controllers: [SignupController, PublicPlansController],
  providers: [SignupService, CouponService, SignupVerificationService],
  // מסך הפלטפורמה מנהל את הקופונים דרך אותו שירות
  exports: [CouponService, SignupService],
})
export class SignupModule {}
