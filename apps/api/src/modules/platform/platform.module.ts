import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BackupsService } from "./backups.service";
import { PlatformController } from "./platform.controller";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [BackupsService],
})
export class PlatformModule {}
