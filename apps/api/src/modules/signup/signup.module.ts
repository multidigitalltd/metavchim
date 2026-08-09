import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SignupController } from "./signup.controller";
import { SignupService } from "./signup.service";

/** הרשמה עצמית של משרד — נתיב ציבורי, ראו signup.controller.ts. */
@Module({
  imports: [AuthModule],
  controllers: [SignupController],
  providers: [SignupService],
})
export class SignupModule {}
