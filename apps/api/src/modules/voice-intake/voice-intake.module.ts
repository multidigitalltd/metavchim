import { Module } from "@nestjs/common";
import { BuyersModule } from "../buyers/buyers.module";
import { LeadsModule } from "../leads/leads.module";
import { MatchingModule } from "../matching/matching.module";
import { PropertiesModule } from "../properties/properties.module";
import { SearchModule } from "../search/search.module";
import { PersonIntakeController } from "./person-intake.controller";
import { OfferIntakeService } from "./offer-intake.service";
import { PersonIntakeService } from "./person-intake.service";
import { TranscriptionService } from "./transcription.service";
import { VoiceIntakeController } from "./voice-intake.controller";
import { VoiceIntakeService } from "./voice-intake.service";

@Module({
  imports: [PropertiesModule, BuyersModule, LeadsModule, SearchModule, MatchingModule],
  controllers: [VoiceIntakeController, PersonIntakeController],
  providers: [VoiceIntakeService, PersonIntakeService, OfferIntakeService, TranscriptionService],
})
export class VoiceIntakeModule {}
