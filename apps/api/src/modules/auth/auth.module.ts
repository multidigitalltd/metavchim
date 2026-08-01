import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginOtpService } from "./login-otp.service";
import { LoginThrottleService } from "./login-throttle.service";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginOtpService, LoginThrottleService],
  exports: [AuthService, LoginThrottleService],
})
export class AuthModule {}
