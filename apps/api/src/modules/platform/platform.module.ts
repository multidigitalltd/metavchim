import { Module } from "@nestjs/common";
import { CardcomService } from "../../core/cardcom.service";
import { AuthModule } from "../auth/auth.module";
import { BackupsService } from "./backups.service";
import { PlatformController } from "./platform.controller";

@Module({
  imports: [AuthModule],
  controllers: [PlatformController],
  providers: [BackupsService, CardcomService],
})
export class PlatformModule {}
