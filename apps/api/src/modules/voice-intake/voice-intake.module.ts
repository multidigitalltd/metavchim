import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { LeadsModule } from "../leads/leads.module";
import { PropertiesModule } from "../properties/properties.module";
import { PersonIntakeController } from "./person-intake.controller";
import { PersonIntakeService } from "./person-intake.service";
import { VoiceIntakeController } from "./voice-intake.controller";
import { VoiceIntakeService } from "./voice-intake.service";

@Module({
  imports: [PropertiesModule, BuyersModule, LeadsModule],
  controllers: [VoiceIntakeController, PersonIntakeController],
  providers: [VoiceIntakeService, PersonIntakeService],
})
export class VoiceIntakeModule {}
