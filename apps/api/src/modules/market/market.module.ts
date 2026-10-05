import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { MarketBuyerService } from "./market-buyer.service";
import { MarketPlatformController } from "./market-platform.controller";
import { MarketPublicController } from "./market-public.controller";
import { MarketPublicService } from "./market-public.service";
import { MarketPropertyService } from "./market-property.service";
import { MarketSyncService } from "./market-sync.service";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";

/**
 * נתוני שוק — עסקאות מיסוי מקרקעין של כל הארץ (docs/18).
 *
 * ‎`MarketService` ו-`MarketPropertyService` מיוצאים: המנטור, הסוכן
 * והטופס הציבורי קוראים מהם, ואינם פותחים עותק משלהם של השאילתות.
 */
@Module({
  // הטופס הציבורי כותב ליד דרך אותו שירות של כל טופס באתר
  imports: [LeadsModule],
  controllers: [MarketController, MarketPlatformController, MarketPublicController],
  providers: [MarketService, MarketPropertyService, MarketBuyerService, MarketSyncService, MarketPublicService],
  exports: [MarketService, MarketPropertyService],
})
export class MarketModule {}
