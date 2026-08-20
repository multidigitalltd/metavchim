import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  // הסוכן הקולי עונה על "דוח המשרד" דרך אותו שירות שהמסך משתמש בו
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
