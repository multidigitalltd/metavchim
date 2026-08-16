import { Module } from "@nestjs/common";
import { FeatureCatalogueService } from "./feature-catalogue.service";

/**
 * מודול בלי תלויות — ראו את ההסבר ב-`feature-catalogue.service.ts`.
 *
 * הוא קיים כדי ש-`BuyersModule` יוכל לקרוא את הקטלוג בלי לייבא את
 * `PropertiesModule` ולסגור מעגל.
 */
@Module({
  providers: [FeatureCatalogueService],
  exports: [FeatureCatalogueService],
})
export class FeatureCatalogueModule {}
