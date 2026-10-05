import { Injectable, NotFoundException } from "@nestjs/common";
import {
  MARKET_SOURCE_ATTRIBUTION,
  budgetFit,
  marketRoomBucket,
  type BuyerMarketDto,
} from "@metavchim/shared";
import { ownershipFilter } from "../../common/ownership";
import { TenantContext } from "../../common/tenant-context";
import { PrismaService } from "../../core/prisma.service";
import { MarketService } from "./market.service";

/**
 * ‎**התקציב של הקונה מול מה ששילמו בפועל בערים שהוא מחפש בהן.**
 *
 * „עם 2.1 מיליון בחיפה — מעל החציון של 4 חדרים; בתל אביב — מתחת
 * לרבעון התחתון.” זו השיחה שמתווך מנהל עם כל קונה חדש, היום מהזיכרון.
 * כאן היא נשענת על אלפי עסקאות של השנה המלאה האחרונה.
 */
@Injectable()
export class MarketBuyerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
  ) {}

  async forBuyer(buyerId: string, now: Date): Promise<BuyerMarketDto> {
    const buyer = await this.prisma.withTenant((tx) =>
      tx.buyer.findFirst({
        where: {
          id: buyerId,
          tenantId: TenantContext.current().tenantId,
          deletedAt: null,
          // ‎`view_own` — ידיעת מזהה אינה הרשאה (docs/04 §1)
          ...ownershipFilter("buyers.view_all", "ownerUserId"),
        },
        select: { cities: true, budgetMaxAgorot: true, roomsMin: true, dealType: true },
      }),
    );
    if (!buyer) throw new NotFoundException("קונה לא נמצא");

    const rooms = marketRoomBucket(buyer.roomsMin?.toNumber() ?? null);
    const budgetIls =
      buyer.dealType === "rent" || buyer.budgetMaxAgorot === null ? null : Number(buyer.budgetMaxAgorot) / 100;

    const resolved = await Promise.all(buyer.cities.map(async (city) => ({ city, hit: await this.market.resolveSettlement(city) })));
    const ids = [...new Set(resolved.flatMap((r) => (r.hit ? [r.hit.id] : [])))];
    const { year, prices } = await this.market.cityPrices(ids, rooms, now);

    return {
      budgetIls,
      rooms,
      year,
      fits: budgetFit(budgetIls, prices),
      unknownCities: resolved.filter((r) => r.hit === null).map((r) => r.city),
      attribution: MARKET_SOURCE_ATTRIBUTION,
    };
  }
}
