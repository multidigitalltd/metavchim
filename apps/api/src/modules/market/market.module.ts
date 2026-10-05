import { Module } from "@nestjs/common";
import { MarketBuyerService } from "./market-buyer.service";
import { MarketPlatformController } from "./market-platform.controller";
import { MarketPropertyService } from "./market-property.service";
import { MarketSyncService } from "./market-sync.service";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";

/**
 * נתוני שוק — עסקאות מיסוי מקרקעין של כל הארץ (docs/14).
 *
 * ‎`MarketService` ו-`MarketPropertyService` מיוצאים: המנטור, הסוכן
 * והטופס הציבורי קוראים מהם, ואינם פותחים עותק משלהם של השאילתות.
 */
@Module({
  controllers: [MarketController, MarketPlatformController],
  providers: [MarketService, MarketPropertyService, MarketBuyerService, MarketSyncService],
  exports: [MarketService, MarketPropertyService],
})
export class MarketModule {}
