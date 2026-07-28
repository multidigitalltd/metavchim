import { Module } from "@nestjs/common";
import { PropertiesModule } from "../properties/properties.module";
import { VoiceIntakeController } from "./voice-intake.controller";
import { VoiceIntakeService } from "./voice-intake.service";

@Module({
  imports: [PropertiesModule],
  controllers: [VoiceIntakeController],
  providers: [VoiceIntakeService],
})
export class VoiceIntakeModule {}
