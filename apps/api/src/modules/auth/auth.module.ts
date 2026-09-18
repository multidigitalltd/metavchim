import { Global, Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { SignupModule } from "../signup/signup.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import { LoginOtpService } from "./login-otp.service";
import { LoginThrottleService } from "./login-throttle.service";
import { MobileHandoffService } from "./mobile-handoff.service";
import { PasswordResetService } from "./password-reset.service";

@Global()
@Module({
  /*
   * MessagingModule הוא מודול עלה (בלי imports), ולכן הייבוא כאן
   * אינו יכול להיות מעגל. הוא נחוץ כדי שהחלפת מספר טלפון תנתק את
   * קישור הוואטסאפ — הקישור נוצר מול המספר הקודם.
   *
   * ‎`SignupModule` — כניסה עם Google לכתובת שאין לה חשבון פותחת
   * ‏משרד חינמי. גם הוא אינו מעגל: המודול הזה `@Global`, ולכן
   * ‏`SignupModule` אינו מייבא אותו בחזרה (ראו ההסבר שם).
   */
  imports: [MessagingModule, SignupModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    LoginOtpService,
    LoginThrottleService,
    MobileHandoffService,
    PasswordResetService,
  ],
  /*
   * ‎`PasswordResetService` — הסוכן פותח חשבון לסוכן חדש ושולח לו
   * ‏קישור לקביעת סיסמה, במקום לומר סיסמה בשיחה.
   */
  exports: [AuthService, LoginThrottleService, PasswordResetService],
})
export class AuthModule {}
