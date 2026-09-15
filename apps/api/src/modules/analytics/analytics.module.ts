import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { OfficeDigestService } from "./office-digest.service";
import { MessagingModule } from "../messaging/messaging.module";

@Module({
  imports: [MessagingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, OfficeDigestService],
  // הסוכן הקולי עונה על "דוח המשרד" דרך אותו שירות שהמסך משתמש בו
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
