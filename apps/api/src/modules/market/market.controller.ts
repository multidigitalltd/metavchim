import { Body, Controller, Get, Param, Put, Query } from "@nestjs/common";
import { z } from "zod";
import {
  MarketDealsQuerySchema,
  MarketNatureGroupSchema,
  MarketScopeQuerySchema,
  PropertyParcelSchema,
  type BuyerMarketDto,
  type MarketDealsPageDto,
  type MarketDealsQuery,
  type MarketMapDto,
  type MarketOverviewDto,
  type MarketParcelDto,
  type MarketProspectingDto,
  type MarketScopeQuery,
  type MarketSettlementDto,
  type PropertyMarketDto,
  type PropertyParcelInput,
} from "@metavchim/shared";
import { RequireCapability } from "../../common/auth.decorators";
import { IdParam, ZodValidationPipe } from "../../common/zod-validation.pipe";
import { MarketBuyerService } from "./market-buyer.service";
import { MarketPropertyService } from "./market-property.service";
import { MarketService } from "./market.service";

const ParcelParamsSchema = z.coerce.number().int().min(1).max(999_999);
const SettlementQuerySchema = z.object({ q: z.string().trim().max(60).optional() }).strict();
const SettlementIdSchema = z.coerce.number().int().min(1);
const MapQuerySchema = z
  .object({ settlementId: SettlementIdSchema, group: MarketNatureGroupSchema.default("apartment") })
  .strict();
const ProspectingQuerySchema = z.object({ settlementId: SettlementIdSchema }).strict();

/**
 * ‎**נתוני שוק — מסכי המשרד** (docs/18).
 *
 * הקריאה הכללית (סטטיסטיקה, עסקאות, חלקה, מפה) תחת `properties.view`:
 * זה מידע ציבורי, וכל מי שעובד במשרד ומורשה לראות נכסים מורשה לראות
 * מה נמכר ברחוב. יכולת נפרדת הייתה עוד מתג שאיש לא ידע מתי להדליק.
 *
 * מה שנוגע בנכס או בקונה של המשרד עובר את שער הישות עצמה: נכס תחת
 * ‎`properties.view` / `properties.edit`, קונה תחת `buyers.view_own`
 * עם סינון הבעלות.
 */
@Controller("market")
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly properties: MarketPropertyService,
    private readonly buyers: MarketBuyerService,
  ) {}

  @Get("properties/:id")
  @RequireCapability("properties.view")
  async property(@Param("id", IdParam) id: string): Promise<PropertyMarketDto> {
    return this.properties.forProperty(id, new Date());
  }

  @Put("properties/:id/parcel")
  @RequireCapability("properties.edit")
  async setParcel(
    @Param("id", IdParam) id: string,
    @Body(new ZodValidationPipe(z.object({ parcel: PropertyParcelSchema }).strict()))
    body: { parcel: PropertyParcelInput },
  ): Promise<PropertyMarketDto> {
    return this.properties.setParcel(id, body.parcel, new Date());
  }

  @Get("buyers/:id")
  @RequireCapability("buyers.view_own")
  async buyer(@Param("id", IdParam) id: string): Promise<BuyerMarketDto> {
    return this.buyers.forBuyer(id, new Date());
  }

  @Get("settlements")
  @RequireCapability("properties.view")
  async settlements(
    @Query(new ZodValidationPipe(SettlementQuerySchema)) query: z.infer<typeof SettlementQuerySchema>,
  ): Promise<MarketSettlementDto[]> {
    return this.market.settlements(query.q);
  }

  @Get("overview")
  @RequireCapability("properties.view")
  async overview(
    @Query(new ZodValidationPipe(MarketScopeQuerySchema)) query: MarketScopeQuery,
  ): Promise<MarketOverviewDto> {
    return this.market.overview(query, new Date());
  }

  @Get("deals")
  @RequireCapability("properties.view")
  async deals(
    @Query(new ZodValidationPipe(MarketDealsQuerySchema)) query: MarketDealsQuery,
  ): Promise<MarketDealsPageDto> {
    return this.market.deals(query);
  }

  @Get("parcels/:gush/:helka")
  @RequireCapability("properties.view")
  async parcel(
    @Param("gush", new ZodValidationPipe(ParcelParamsSchema)) gush: number,
    @Param("helka", new ZodValidationPipe(ParcelParamsSchema)) helka: number,
  ): Promise<MarketParcelDto> {
    return this.market.parcel(gush, helka);
  }

  @Get("prospecting")
  @RequireCapability("properties.view")
  async prospecting(
    @Query(new ZodValidationPipe(ProspectingQuerySchema)) query: z.infer<typeof ProspectingQuerySchema>,
  ): Promise<MarketProspectingDto> {
    return this.market.prospecting(query.settlementId, new Date());
  }

  @Get("map")
  @RequireCapability("properties.view")
  async map(
    @Query(new ZodValidationPipe(MapQuerySchema)) query: z.infer<typeof MapQuerySchema>,
  ): Promise<MarketMapDto> {
    return this.market.map(query.settlementId, query.group, new Date());
  }
}
