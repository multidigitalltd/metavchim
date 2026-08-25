import { Global, Module } from "@nestjs/common";
import { MessagingModule } from "../messaging/messaging.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { GoogleAuthService } from "./google-auth.service";
import { LoginOtpService } from "./login-otp.service";
import { LoginThrottleService } from "./login-throttle.service";
import { PasswordResetService } from "./password-reset.service";

@Global()
@Module({
  /*
   * MessagingModule הוא מודול עלה (בלי imports), ולכן הייבוא כאן
   * אינו יכול להיות מעגל. הוא נחוץ כדי שהחלפת מספר טלפון תנתק את
   * קישור הוואטסאפ — הקישור נוצר מול המספר הקודם.
   */
  imports: [MessagingModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    LoginOtpService,
    LoginThrottleService,
    PasswordResetService,
  ],
  exports: [AuthService, LoginThrottleService],
})
export class AuthModule {}
