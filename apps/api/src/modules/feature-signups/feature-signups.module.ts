import { Module } from "@nestjs/common";
import { FeatureSignupsController } from "./feature-signups.controller";
import { FeatureSignupsService } from "./feature-signups.service";

@Module({
  controllers: [FeatureSignupsController],
  providers: [FeatureSignupsService],
})
export class FeatureSignupsModule {}
