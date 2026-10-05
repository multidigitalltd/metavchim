import { Module } from "@nestjs/common";
import { FunnelModule } from "../funnel/funnel.module";
import { SupportModule } from "../support/support.module";
import { FunnelReportService } from "./funnel-report.service";
import { FunnelSendService } from "./funnel-send.service";
import { FunnelTrackingController } from "./funnel-tracking.controller";

/**
 * ‎**מסלול ההמרה — שלב ב׳: השליחה והמעקב.**
 *
 * ‏מודול נפרד ממנוע המסלולים בכוונה: `FunnelModule` נשאר בלי שום דרך
 * ‏אל ערוץ יוצא, ושער `funnel-no-send.test.ts` ממשיך לאכוף את זה. כל
 * ‏מה ששולח יושב כאן, מאחורי המפסק הראשי.
 */
@Module({
  // ‏התמיכה — לכתובת שאליה חוזרות תשובות למיילי המסלול
  imports: [FunnelModule, SupportModule],
  providers: [FunnelSendService, FunnelReportService],
  controllers: [FunnelTrackingController],
  exports: [FunnelSendService, FunnelReportService],
})
export class FunnelSendModule {}
