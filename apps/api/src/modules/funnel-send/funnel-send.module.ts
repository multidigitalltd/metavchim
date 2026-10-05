import { Module } from "@nestjs/common";
import { FunnelModule } from "../funnel/funnel.module";
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
  imports: [FunnelModule],
  providers: [FunnelSendService],
  controllers: [FunnelTrackingController],
  exports: [FunnelSendService],
})
export class FunnelSendModule {}
