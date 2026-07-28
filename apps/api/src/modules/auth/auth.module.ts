import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginThrottleService } from "./login-throttle.service";

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, LoginThrottleService],
  exports: [AuthService],
})
export class AuthModule {}
