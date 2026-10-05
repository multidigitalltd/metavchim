import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  MARKET_DWELLING_GROUPS,
  MARKET_FLAGS,
  MARKET_COMP_LOOKBACK_MONTHS,
  MARKET_NATURE_GROUPS,
  MARKET_NATURE_GROUP_LABELS,
  MARKET_SOURCE_ATTRIBUTION,
  isPartialPeriod,
  marketFlagNames,
  marketRoomBucketLabel,
  percentChange,
  resolveMarketSettlement,
  type MarketBuildingDto,
  type MarketCityPrices,
  type MarketComparable,
  type MarketDealDto,
  type MarketDealsPageDto,
  type MarketDealsQuery,
  type MarketFreshnessDto,
  type MarketMapDto,
  type MarketMoverDto,
  type MarketNatureGroup,
  type MarketOverviewDto,
  type MarketParcelDto,
  type MarketProspectingDto,
  type MarketQuarterRowDto,
  type MarketRoomBucket,
  type MarketScopeQuery,
  type MarketSettlementDto,
  type MarketSettlementRef,
  type MarketYearRowDto,
} from "@metavchim/shared";
import { PrismaService } from "../../core/prisma.service";

/**
 * ‎**קריאת נתוני השוק — כל מה שהמסכים צריכים, מהמסד המקומי בלבד.**
 *
 * אף פונקציה כאן אינה פונה למקור. המקור נקרא רק בסבב הסנכרון,
 * בקצב שלו; מסך שהיה פונה אליו בזמן בקשה היה איטי, תלוי בשירות
 * חיצוני, ושולח לשם את הכתובת של כל נכס שמישהו פתח.
 *
 * הטבלאות אינן תחת RLS (מידע ציבורי, בלי `tenant_id`), ולכן נקראות
 * מ-`this.prisma` ישירות. **שום שאילתה כאן אינה נוגעת בטבלה של משרד**
 * — מה שמחבר בין נכס של משרד לעסקאות עובר דרך `MarketPropertyService`,
 * תחת `withTenant`.
 */

/** כמה זמן רשימת היישובים נשמרת בזיכרון. היא משתנה פעם ביום. */
const SETTLEMENTS_TTL_MS = 10 * 60 * 1000;

/** עסקאות ברמת היישוב שנשלפות כמועמדות — החדשות ביותר. */
const SETTLEMENT_CANDIDATES = 3_000;

/** קודי הקבוצות — מה שנשמר בעמודה `nature_group`. */
export const groupCode = (group: MarketNatureGroup): number => MARKET_NATURE_GROUPS.indexOf(group);
const groupOf = (code: number): MarketNatureGroup => MARKET_NATURE_GROUPS[code] ?? "other";

const DWELLING_CODES = MARKET_DWELLING_GROUPS.map(groupCode);

/** הדגלים שפוסלים מסטטיסטיקה — זהה ל-`countsForStats`. */
const EXCLUDED = MARKET_FLAGS.partial | MARKET_FLAGS.tinyAmount | MARKET_FLAGS.outlier;

interface DealRow {
  id: string;
  deal_date: Date;
  amount_ils: bigint;
  nature: string;
  nature_group: number;
  area_sqm: number | null;
  rooms: number | null;
  year_built: number | null;
  portion: number | null;
  ppsqm: number | null;
  gush: number;
  helka: number;
  sub_parcel: number | null;
  flags: number;
  settlement: string | null;
  stat_area?: number | null;
}

interface StatRow {
  settlement_id: number;
  nature_group: number;
  room_bucket: number;
  year: number;
  quarter: number;
  deals: number;
  new_build_deals: number;
  median_price: bigint | null;
  p25_price: bigint | null;
  p75_price: bigint | null;
  median_ppsqm: number | null;
  median_area: number | null;
}

/** העמודות של שורת עסקה — אותה בחירה בכל שאילתה, כדי שהמיפוי יהיה אחד. */
const DEAL_COLUMNS = Prisma.sql`
  d.id::text AS id, d.deal_date, d.amount_ils, n.name AS nature, d.nature_group,
  d.area_sqm, d.rooms::float8 AS rooms, d.year_built, d.portion::float8 AS portion,
  d.ppsqm, d.gush, d.helka, d.sub_parcel, d.flags, s.name AS settlement`;

const DEAL_JOINS = Prisma.sql`
  JOIN market_natures n ON n.id = d.nature_id
  LEFT JOIN market_settlements s ON s.id = d.settlement_id`;

const iso = (date: Date): string => date.toISOString().slice(0, 10);
const num = (value: bigint | number | null): number | null => (value === null ? null : Number(value));

export function toDealDto(row: DealRow): MarketDealDto {
  return {
    id: row.id,
    date: iso(row.deal_date),
    amountIls: Number(row.amount_ils),
    nature: row.nature,
    group: groupOf(row.nature_group),
    areaSqm: row.area_sqm,
    rooms: row.rooms,
    yearBuilt: row.year_built,
    portion: row.portion,
    ppsqm: row.ppsqm,
    gush: row.gush,
    helka: row.helka,
    subParcel: row.sub_parcel,
    settlement: row.settlement,
    flags: marketFlagNames(row.flags),
  };
}

function toComparable(row: DealRow): MarketComparable {
  return {
    id: row.id,
    date: iso(row.deal_date),
    amountIls: Number(row.amount_ils),
    group: groupOf(row.nature_group),
    areaSqm: row.area_sqm,
    rooms: row.rooms,
    yearBuilt: row.year_built,
    gush: row.gush,
    helka: row.helka,
    subParcel: row.sub_parcel,
    statArea: row.stat_area ?? null,
    ppsqm: row.ppsqm,
    flags: row.flags,
  };
}

/** תנאי SQL לדלי חדרים — אותם גבולות של `marketRoomBucket`. */
function roomsCondition(bucket: MarketRoomBucket): Prisma.Sql {
  switch (bucket) {
    case 0:
      return Prisma.sql`TRUE`;
    case 2:
      return Prisma.sql`d.rooms < 2.5`;
    case 6:
      return Prisma.sql`d.rooms >= 5.5`;
    default:
      return Prisma.sql`d.rooms >= ${bucket - 0.5} AND d.rooms < ${bucket + 0.5}`;
  }
}

function monthsAgo(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
}

export interface SettlementRecord extends MarketSettlementRef {
  status: string;
  syncedThrough: Date | null;
}

@Injectable()
export class MarketService {
  private settlementsCache: { at: number; rows: SettlementRecord[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /* ============================================================
     יישובים
     ============================================================ */

  async settlementRecords(): Promise<SettlementRecord[]> {
    if (this.settlementsCache && Date.now() - this.settlementsCache.at < SETTLEMENTS_TTL_MS) {
      return this.settlementsCache.rows;
    }
    const rows = await this.prisma.marketSettlement.findMany({
      select: { id: true, name: true, sourceDeals: true, status: true, syncedThrough: true },
      orderBy: { sourceDeals: "desc" },
    });
    const records = rows.map((row) => ({
      id: row.id,
      name: row.name,
      deals: row.sourceDeals,
      status: row.status,
      syncedThrough: row.syncedThrough,
    }));
    this.settlementsCache = { at: Date.now(), rows: records };
    return records;
  }

  async settlements(query?: string): Promise<MarketSettlementDto[]> {
    const rows = await this.settlementRecords();
    const needle = query?.trim() ?? "";
    return rows
      .filter((row) => needle === "" || row.name.includes(needle))
      .slice(0, needle === "" ? 2_000 : 30)
      .map((row) => ({ id: row.id, name: row.name, deals: row.deals, status: row.status }));
  }

  async resolveSettlement(city: string | null | undefined): Promise<SettlementRecord | null> {
    const rows = await this.settlementRecords();
    const hit = resolveMarketSettlement(city, rows);
    return hit ? (rows.find((row) => row.id === hit.id) ?? null) : null;
  }

  async settlementById(id: number): Promise<SettlementRecord | null> {
    return (await this.settlementRecords()).find((row) => row.id === id) ?? null;
  }

  /** כמה מהיישוב כבר במאגר — „נקלטו 80% מהעסקאות” ולא „אין עסקאות”. */
  async freshness(settlement: SettlementRecord): Promise<MarketFreshnessDto> {
    const local = await this.prisma.marketDeal.count({ where: { settlementId: settlement.id } });
    return {
      syncedThrough: settlement.syncedThrough ? iso(settlement.syncedThrough) : null,
      status: settlement.status,
      coveragePct: settlement.deals > 0 ? Math.min(100, Math.round((local / settlement.deals) * 100)) : null,
    };
  }

  /* ============================================================
     בניין, דירה, חלקה
     ============================================================ */

  async parcelDeals(gush: number, helka: number, limit: number, subParcel?: number | null): Promise<{ deals: MarketDealDto[]; total: number }> {
    const subFilter = subParcel === undefined || subParcel === null ? Prisma.sql`TRUE` : Prisma.sql`d.sub_parcel = ${subParcel}`;
    const rows = await this.prisma.$queryRaw<DealRow[]>`
      SELECT ${DEAL_COLUMNS}
      FROM market_deals d ${DEAL_JOINS}
      WHERE d.gush = ${gush} AND d.helka = ${helka} AND ${subFilter}
      ORDER BY d.deal_date DESC, d.id DESC
      LIMIT ${limit}`;
    const [counted] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*) AS total FROM market_deals d
      WHERE d.gush = ${gush} AND d.helka = ${helka} AND ${subFilter}`;
    return { deals: rows.map(toDealDto), total: Number(counted?.total ?? 0) };
  }

  async parcel(gush: number, helka: number): Promise<MarketParcelDto> {
    const info = await this.prisma.marketParcel.findUnique({ where: { gush_helka: { gush, helka } } });
    const { deals, total } = await this.parcelDeals(gush, helka, 200);
    return {
      gush,
      helka,
      street: info?.street ?? null,
      statArea: info?.statArea ?? null,
      socioEshkol: info?.socioEshkol ?? null,
      lat: info?.lat ?? null,
      lon: info?.lon ?? null,
      deals,
      total,
    };
  }

  async statAreaOf(gush: number | null, helka: number | null): Promise<number | null> {
    if (gush === null || helka === null) return null;
    const row = await this.prisma.marketParcel.findUnique({
      where: { gush_helka: { gush, helka } },
      select: { statArea: true },
    });
    return row?.statArea ?? null;
  }

  /* ============================================================
     מועמדים להשוואה
     ============================================================ */

  /**
   * עסקאות שעשויות להיות דומות לנכס — שלוש שליפות קטנות ולא אחת גדולה.
   *
   * הגוש (בניין + גוש) והאזור הסטטיסטי נשלפים לכל החלון של 36 חודשים
   * דרך האינדקסים שלהם; היישוב — רק 3,000 העסקאות האחרונות. בלי
   * ההפרדה, שליפה אחת של „היישוב ב-36 חודשים” בתל אביב הייתה מחזירה
   * עשרות אלפי שורות כדי לבחור מהן חמש.
   */
  async candidates(
    settlementId: number,
    group: MarketNatureGroup,
    subject: { gush: number | null; statArea: number | null },
    now: Date,
  ): Promise<MarketComparable[]> {
    const since = monthsAgo(now, MARKET_COMP_LOOKBACK_MONTHS);
    const code = groupCode(group);
    const select = Prisma.sql`
      SELECT d.id::text AS id, d.deal_date, d.amount_ils, '' AS nature, d.nature_group,
             d.area_sqm, d.rooms::float8 AS rooms, d.year_built, d.portion::float8 AS portion,
             d.ppsqm, d.gush, d.helka, d.sub_parcel, d.flags, NULL AS settlement, p.stat_area
      FROM market_deals d
      LEFT JOIN market_parcels p ON p.gush = d.gush AND p.helka = d.helka`;

    const queries: Promise<DealRow[]>[] = [
      this.prisma.$queryRaw<DealRow[]>`
        ${select}
        WHERE d.settlement_id = ${settlementId} AND d.nature_group = ${code} AND d.deal_date >= ${since}
        ORDER BY d.deal_date DESC
        LIMIT ${SETTLEMENT_CANDIDATES}`,
    ];
    if (subject.gush !== null) {
      queries.push(this.prisma.$queryRaw<DealRow[]>`
        ${select}
        WHERE d.gush = ${subject.gush} AND d.nature_group = ${code} AND d.deal_date >= ${since}`);
    }
    if (subject.statArea !== null) {
      queries.push(this.prisma.$queryRaw<DealRow[]>`
        ${select}
        WHERE p.stat_area = ${subject.statArea} AND d.nature_group = ${code} AND d.deal_date >= ${since}`);
    }
    const seen = new Map<string, MarketComparable>();
    for (const rows of await Promise.all(queries)) {
      for (const row of rows) if (!seen.has(row.id)) seen.set(row.id, toComparable(row));
    }
    return [...seen.values()];
  }

  /** עסקאות לפי מזהים — להצגת העסקאות הדומות עם הסוג והיישוב. */
  async dealsByIds(ids: readonly string[]): Promise<MarketDealDto[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.$queryRaw<DealRow[]>`
      SELECT ${DEAL_COLUMNS}
      FROM market_deals d ${DEAL_JOINS}
      WHERE d.id = ANY(${ids.map((id) => BigInt(id))}::bigint[])`;
    const byId = new Map(rows.map((row) => [row.id, toDealDto(row)]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  /* ============================================================
     סטטיסטיקה — מסך „נתוני שוק”
     ============================================================ */

  private async statRows(
    settlementId: number,
    where: Prisma.Sql,
  ): Promise<StatRow[]> {
    return this.prisma.$queryRaw<StatRow[]>`
      SELECT settlement_id, nature_group, room_bucket, year, quarter, deals, new_build_deals,
             median_price, p25_price, p75_price, median_ppsqm, median_area
      FROM market_segment_stats
      WHERE settlement_id = ${settlementId} AND ${where}
      ORDER BY year, quarter`;
  }

  /** כמה עסקאות במאגר. הערכה מ-`pg_class` כשהטבלה גדולה — ספירה מלאה עולה שנייה. */
  async localDealCount(): Promise<number> {
    /*
     * ‎**הגדול מבין `n_live_tup` ו-`reltuples`.** ‏`reltuples` מתעדכן רק
     * ב-ANALYZE, ובטבלה שרק מתווספות לה שורות זה קורה אחרי עוד כ-10% —
     * בקליטה של מיליון עסקאות המספר במסך עמד שעה שלמה במקום, ונראה כמו
     * קליטה שנתקעה. ‏`n_live_tup` מתעדכן עם כל טרנזקציה, אבל מתאפס אחרי
     * קריסה של Postgres; אז `reltuples` נשאר הרצפה, ואין חזרה לספירה
     * מלאה בכל בקשה (ביקורת Codex).
     */
    const [estimate] = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT GREATEST(COALESCE(s.n_live_tup, 0)::float8, c.reltuples::float8) AS n
      FROM pg_class c LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE c.relname = 'market_deals'`;
    if (estimate && estimate.n > 200_000) return Math.round(estimate.n);
    return this.prisma.marketDeal.count();
  }

  async overview(query: MarketScopeQuery, now: Date): Promise<MarketOverviewDto> {
    const settlement = query.settlementId ? await this.settlementById(query.settlementId) : null;
    const settlementId = settlement?.id ?? 0;
    const code = groupCode(query.group);
    const currentYear = now.getUTCFullYear();

    const [yearRows, quarterRows, roomRows, groupRows] = await Promise.all([
      this.statRows(settlementId, Prisma.sql`nature_group = ${code} AND room_bucket = ${query.rooms} AND quarter = 0`),
      query.rooms === 0
        ? this.statRows(settlementId, Prisma.sql`nature_group = ${code} AND room_bucket = 0 AND quarter > 0`)
        : Promise.resolve([]),
      this.statRows(settlementId, Prisma.sql`nature_group = ${code} AND room_bucket > 0 AND quarter = 0`),
      this.statRows(settlementId, Prisma.sql`room_bucket = 0 AND quarter = 0`),
    ]);

    const yearly: MarketYearRowDto[] = yearRows.map((row) => ({
      year: row.year,
      deals: row.deals,
      newBuildDeals: row.new_build_deals,
      medianPrice: num(row.median_price),
      p25Price: num(row.p25_price),
      p75Price: num(row.p75_price),
      medianPpsqm: row.median_ppsqm,
      medianArea: row.median_area,
      partial: row.year >= currentYear || isPartialPeriod(`${row.year}-12-31`, now),
    }));

    const quarterly: MarketQuarterRowDto[] = quarterRows.slice(-12).map((row) => {
      const endMonth = String(row.quarter * 3).padStart(2, "0");
      return {
        year: row.year,
        quarter: row.quarter,
        deals: row.deals,
        medianPrice: num(row.median_price),
        medianPpsqm: row.median_ppsqm,
        partial: isPartialPeriod(`${row.year}-${endMonth}-28`, now),
      };
    });

    // השנה שנבחרה, או המלאה האחרונה — לא השנה הנוכחית, שהדיווחים עליה עוד
    // מגיעים. שנה שנבחרה ואין לה נתונים בסגמנט נופלת לאחרונה, ולא לריק
    const full = yearly.filter((row) => !row.partial);
    const last = full.find((row) => row.year === query.year) ?? full.at(-1) ?? null;
    const before = last ? (full.find((row) => row.year === last.year - 1) ?? null) : null;
    const refYear = last?.year ?? null;

    const rooms = roomRows
      .filter((row) => row.year === refYear)
      .sort((a, b) => a.room_bucket - b.room_bucket)
      .map((row) => ({
        key: String(row.room_bucket),
        label: marketRoomBucketLabel(row.room_bucket as MarketRoomBucket),
        deals: row.deals,
        medianPrice: num(row.median_price),
        medianPpsqm: row.median_ppsqm,
      }));

    const groups = groupRows
      .filter((row) => row.year === refYear)
      .sort((a, b) => b.deals - a.deals)
      .map((row) => {
        const group = groupOf(row.nature_group);
        return {
          key: group,
          label: MARKET_NATURE_GROUP_LABELS[group],
          deals: row.deals,
          medianPrice: num(row.median_price),
          medianPpsqm: row.median_ppsqm,
        };
      });

    const [topSettlements, movers] =
      settlementId === 0 && refYear !== null
        ? await this.leaders(code, query.rooms, refYear)
        : [[], []];

    return {
      scope: {
        settlementId: settlement?.id ?? null,
        settlement: settlement?.name ?? null,
        group: query.group,
        rooms: query.rooms,
      },
      database: await this.databaseSummary(),
      years: full.map((row) => row.year).reverse(),
      headline: {
        year: refYear,
        deals: last?.deals ?? null,
        medianPrice: last?.medianPrice ?? null,
        medianPpsqm: last?.medianPpsqm ?? null,
        dealsChangePct: percentChange(before?.deals, last?.deals),
        ppsqmChangePct: percentChange(before?.medianPpsqm, last?.medianPpsqm),
        newBuildSharePct: last && last.deals > 0 ? Math.round((last.newBuildDeals / last.deals) * 100) : null,
      },
      yearly,
      quarterly,
      rooms,
      groups,
      topSettlements,
      movers,
      attribution: MARKET_SOURCE_ATTRIBUTION,
    };
  }

  /** הערים הפעילות ביותר, ומי שהמחיר בהן זז הכי הרבה (לפחות 100 עסקאות בשתי השנים). */
  private async leaders(code: number, rooms: number, year: number): Promise<[MarketMoverDto[], MarketMoverDto[]]> {
    const rows = await this.prisma.$queryRaw<
      { settlement_id: number; name: string; deals: number; ppsqm: number | null; prev_deals: number | null; prev_ppsqm: number | null }[]
    >`
      SELECT c.settlement_id, s.name, c.deals, c.median_ppsqm AS ppsqm,
             p.deals AS prev_deals, p.median_ppsqm AS prev_ppsqm
      FROM market_segment_stats c
      JOIN market_settlements s ON s.id = c.settlement_id
      LEFT JOIN market_segment_stats p
        ON p.settlement_id = c.settlement_id AND p.nature_group = c.nature_group
       AND p.room_bucket = c.room_bucket AND p.quarter = 0 AND p.year = c.year - 1
      WHERE c.settlement_id > 0 AND c.nature_group = ${code} AND c.room_bucket = ${rooms}
        AND c.quarter = 0 AND c.year = ${year}`;
    const all = rows.map((row) => ({
      settlementId: row.settlement_id,
      name: row.name,
      deals: row.deals,
      medianPpsqm: row.ppsqm,
      changePct: (row.prev_deals ?? 0) >= 100 && row.deals >= 100 ? percentChange(row.prev_ppsqm, row.ppsqm) : null,
    }));
    const top = [...all].sort((a, b) => b.deals - a.deals).slice(0, 12);
    const withChange = all.filter((row) => row.changePct !== null);
    const rising = [...withChange].sort((a, b) => b.changePct! - a.changePct!).slice(0, 6);
    const falling = [...withChange].sort((a, b) => a.changePct! - b.changePct!).slice(0, 6);
    const movers = [...rising, ...falling.filter((row) => !rising.includes(row))].sort(
      (a, b) => b.changePct! - a.changePct!,
    );
    return [top, movers];
  }

  async databaseSummary(): Promise<MarketOverviewDto["database"]> {
    const [deals, settlements, last] = await Promise.all([
      this.localDealCount(),
      this.prisma.marketSettlement.aggregate({ _count: { id: true }, _sum: { sourceDeals: true } }),
      this.prisma.marketDeal.findFirst({ orderBy: { dealDate: "desc" }, select: { dealDate: true } }),
    ]);
    const synced = await this.prisma.marketSettlement.count({ where: { status: "ok" } });
    return {
      deals,
      sourceDeals: settlements._sum.sourceDeals ?? 0,
      settlements: settlements._count.id,
      settlementsSynced: synced,
      lastDeal: last ? iso(last.dealDate) : null,
    };
  }

  /** מחירי היישובים לשנה המלאה האחרונה — לבדיקת תקציב של קונה. */
  async cityPrices(settlementIds: readonly number[], rooms: MarketRoomBucket, now: Date): Promise<{ year: number | null; prices: MarketCityPrices[] }> {
    if (settlementIds.length === 0) return { year: null, prices: [] };
    const year = now.getUTCFullYear() - 1;
    const rows = await this.prisma.$queryRaw<
      { settlement_id: number; name: string; deals: number; median_price: bigint | null; p25_price: bigint | null; p75_price: bigint | null; year: number }[]
    >`
      SELECT st.settlement_id, s.name, st.deals, st.median_price, st.p25_price, st.p75_price, st.year
      FROM market_segment_stats st
      JOIN market_settlements s ON s.id = st.settlement_id
      WHERE st.settlement_id = ANY(${[...settlementIds]}::int[])
        AND st.nature_group = ${groupCode("apartment")} AND st.room_bucket = ${rooms}
        AND st.quarter = 0 AND st.year IN (${year}, ${year - 1})
      ORDER BY st.year DESC`;
    const prices: MarketCityPrices[] = [];
    const taken = new Set<number>();
    // השנה שמוצגת היא השנה של הנתונים בפועל — יישוב שנפל לשנה שלפני
    // אינו „נמכרו ב-<השנה שעברה>”
    let shownYear: number | null = null;
    for (const row of rows) {
      // השנה האחרונה שיש לה נתונים, לכל יישוב בנפרד
      if (taken.has(row.settlement_id) || row.median_price === null) continue;
      taken.add(row.settlement_id);
      shownYear = shownYear === null ? row.year : Math.max(shownYear, row.year);
      prices.push({
        settlement: row.name,
        rooms,
        year: row.year,
        deals: row.deals,
        p25: Number(row.p25_price ?? row.median_price),
        median: Number(row.median_price),
        p75: Number(row.p75_price ?? row.median_price),
      });
    }
    return { year: shownYear, prices };
  }

  /** רבעון אחרון מלא מול אותו רבעון אשתקד — לדופק השוק של המנטור. */
  async quarterPulse(settlementId: number, now: Date): Promise<{
    label: string;
    current: { deals: number; medianPpsqm: number | null };
    previous: { deals: number; medianPpsqm: number | null };
  } | null> {
    // הרבעון האחרון שהסתיים לפני יותר מ-3 חודשים — לפני זה הדיווחים חלקיים
    const ref = monthsAgo(now, 3);
    const q = Math.floor(ref.getUTCMonth() / 3); // 0..3, הרבעון של ref
    const year = q === 0 ? ref.getUTCFullYear() - 1 : ref.getUTCFullYear();
    const quarter = q === 0 ? 4 : q;
    const rows = await this.prisma.marketSegmentStat.findMany({
      where: {
        settlementId,
        natureGroup: groupCode("apartment"),
        roomBucket: 0,
        quarter,
        year: { in: [year, year - 1] },
      },
      select: { year: true, deals: true, medianPpsqm: true },
    });
    const current = rows.find((row) => row.year === year);
    const previous = rows.find((row) => row.year === year - 1);
    if (!current || !previous) return null;
    return {
      label: `ברבעון ${quarter}/${year}`,
      current: { deals: current.deals, medianPpsqm: current.medianPpsqm },
      previous: { deals: previous.deals, medianPpsqm: previous.medianPpsqm },
    };
  }

  /* ============================================================
     חיפוש עסקאות
     ============================================================ */

  async deals(query: MarketDealsQuery): Promise<MarketDealsPageDto> {
    const conditions: Prisma.Sql[] = [];
    if (query.settlementId !== undefined) conditions.push(Prisma.sql`d.settlement_id = ${query.settlementId}`);
    if (query.group !== undefined) conditions.push(Prisma.sql`d.nature_group = ${groupCode(query.group)}`);
    if (query.rooms !== undefined && query.rooms !== 0) conditions.push(roomsCondition(query.rooms));
    if (query.from !== undefined) conditions.push(Prisma.sql`d.deal_date >= ${query.from}::date`);
    if (query.to !== undefined) conditions.push(Prisma.sql`d.deal_date <= ${query.to}::date`);
    if (query.minPrice !== undefined) conditions.push(Prisma.sql`d.amount_ils >= ${query.minPrice}`);
    if (query.maxPrice !== undefined) conditions.push(Prisma.sql`d.amount_ils <= ${query.maxPrice}`);
    if (query.gush !== undefined) conditions.push(Prisma.sql`d.gush = ${query.gush}`);
    if (query.cursor !== undefined) {
      const [date, id] = query.cursor.split("|");
      conditions.push(Prisma.sql`(d.deal_date, d.id) < (${date}::date, ${BigInt(id ?? "0")})`);
    }
    const where = conditions.length > 0 ? Prisma.join(conditions, " AND ") : Prisma.sql`TRUE`;
    const rows = await this.prisma.$queryRaw<DealRow[]>`
      SELECT ${DEAL_COLUMNS}
      FROM market_deals d ${DEAL_JOINS}
      WHERE ${where}
      ORDER BY d.deal_date DESC, d.id DESC
      LIMIT ${query.limit + 1}`;
    const items = rows.slice(0, query.limit).map(toDealDto);
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && lastItem ? `${lastItem.date}|${lastItem.id}` : null,
    };
  }

  /* ============================================================
     איתור יזום ומפה
     ============================================================ */

  async prospecting(settlementId: number, now: Date): Promise<MarketProspectingDto> {
    const settlement = await this.settlementById(settlementId);
    if (!settlement) return { settlement: null, turnover: [], projects: [] };
    const since = monthsAgo(now, 24);
    const base = Prisma.sql`
      SELECT d.gush, d.helka, max(p.street) AS street, count(*)::int AS deals,
             max(d.deal_date) AS last_deal,
             (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ppsqm) FILTER (WHERE d.ppsqm IS NOT NULL))::int AS ppsqm
      FROM market_deals d
      LEFT JOIN market_parcels p ON p.gush = d.gush AND p.helka = d.helka
      WHERE d.settlement_id = ${settlementId} AND d.deal_date >= ${since}
        AND d.nature_group = ANY(${DWELLING_CODES}::int[])
        AND (d.flags & ${MARKET_FLAGS.partial | MARKET_FLAGS.tinyAmount}) = 0`;
    const [turnover, projects] = await Promise.all([
      this.prisma.$queryRaw<{ gush: number; helka: number; street: string | null; deals: number; last_deal: Date; ppsqm: number | null }[]>`
        ${base} AND (d.flags & ${MARKET_FLAGS.newBuild}) = 0
        GROUP BY d.gush, d.helka HAVING count(*) >= 3
        ORDER BY count(*) DESC, max(d.deal_date) DESC LIMIT 20`,
      this.prisma.$queryRaw<{ gush: number; helka: number; street: string | null; deals: number; last_deal: Date; ppsqm: number | null }[]>`
        ${base} AND (d.flags & ${MARKET_FLAGS.newBuild}) <> 0
        GROUP BY d.gush, d.helka HAVING count(*) >= 2
        ORDER BY max(d.deal_date) DESC LIMIT 20`,
    ]);
    const map = (row: { gush: number; helka: number; street: string | null; deals: number; last_deal: Date; ppsqm: number | null }): MarketBuildingDto => ({
      gush: row.gush,
      helka: row.helka,
      street: row.street,
      deals: row.deals,
      lastDeal: iso(row.last_deal),
      medianPpsqm: row.ppsqm,
    });
    return {
      settlement: { id: settlement.id, name: settlement.name },
      turnover: turnover.map(map),
      projects: projects.map(map),
    };
  }

  async map(settlementId: number, group: MarketNatureGroup, now: Date): Promise<MarketMapDto> {
    const since = monthsAgo(now, 24);
    const code = groupCode(group);
    const [points, coverage] = await Promise.all([
      this.prisma.$queryRaw<{ lat: number; lon: number; gush: number; helka: number; deals: number; ppsqm: number | null; last_deal: Date }[]>`
        SELECT p.lat, p.lon, d.gush, d.helka, count(*)::int AS deals,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ppsqm) FILTER (WHERE d.ppsqm IS NOT NULL))::int AS ppsqm,
               max(d.deal_date) AS last_deal
        FROM market_deals d
        JOIN market_parcels p ON p.gush = d.gush AND p.helka = d.helka AND p.lat IS NOT NULL
        WHERE d.settlement_id = ${settlementId} AND d.nature_group = ${code}
          AND d.deal_date >= ${since} AND (d.flags & ${EXCLUDED}) = 0
        GROUP BY p.lat, p.lon, d.gush, d.helka
        ORDER BY count(*) DESC
        LIMIT 3000`,
      this.prisma.$queryRaw<{ parcels: number; located: number }[]>`
        SELECT count(*)::int AS parcels, count(p.lat)::int AS located
        FROM (SELECT DISTINCT gush, helka FROM market_deals
              WHERE settlement_id = ${settlementId} AND deal_date >= ${since}) x
        LEFT JOIN market_parcels p ON p.gush = x.gush AND p.helka = x.helka`,
    ]);
    const cov = coverage[0];
    return {
      points: points.map((row) => ({
        lat: row.lat,
        lon: row.lon,
        gush: row.gush,
        helka: row.helka,
        deals: row.deals,
        medianPpsqm: row.ppsqm,
        lastDeal: iso(row.last_deal),
      })),
      locatedPct: cov && cov.parcels > 0 ? Math.round((cov.located / cov.parcels) * 100) : null,
    };
  }
}

