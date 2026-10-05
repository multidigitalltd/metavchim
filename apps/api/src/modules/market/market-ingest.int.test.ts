import { PrismaClient } from "@prisma/client";
import { prismaAdapter } from "../../core/prisma-adapter";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MARKET_FLAGS } from "@metavchim/shared";
import { MarketIngest, type IngestClock } from "./market-ingest";
import type { MarketSource, SourceDeal, SourceDealPage, SourceParcel } from "./market-source";

/**
 * ‎**הקליטה מול Postgres אמיתי ומקור מזויף.**
 *
 * מה שאי אפשר לבדוק בלי מסד: שהסמן באמת מתקדם בין חלונות ונשמר
 * באמצע, שקליטה חוזרת אינה מכפילה (המזהה הדטרמיניסטי + `ON CONFLICT`),
 * ושהחציון שה-SQL מחשב מתעלם מעסקאות חלקיות ומסמן חריגים — אותם
 * כללים של `countsForStats` בחבילה המשותפת, הפעם מול `percentile_cont`.
 *
 * עמוד של 4 ותקרת חיפוש של 10 מאלצים את הסנכרון לעבור דרך כמה
 * חלונות תאריכים בעשרות שורות, במקום ב-10,000.
 */

/* גושים מטווח שאינו קיים — לא נוגעים בנתונים של בדיקה אחרת */
const GUSH = 990_001;
const CITY_A = "יישוב בדיקה א";
const CITY_B = "יישוב בדיקה ב";

let db: PrismaClient;

function deal(i: number, overrides: Partial<SourceDeal> = {}): SourceDeal {
  const day = String((i % 28) + 1).padStart(2, "0");
  const month = String(Math.floor(i / 28) % 12 + 1).padStart(2, "0");
  return {
    date: `2024-${month}-${day}`,
    amountIls: 1_000_000 + i * 10_000,
    nature: "דירה בבית קומות",
    areaSqm: 100,
    rooms: 4,
    yearBuilt: 1995,
    portion: 1,
    subParcel: i,
    settlement: CITY_A,
    gush: GUSH,
    helka: 1 + (i % 3),
    ...overrides,
  };
}

/** מקור מזויף — מתנהג כמו המקור: מיון עולה, `date_from` כולל, היסט ותקרה. */
class FakeSource implements MarketSource {
  readonly name = "fake";
  requests = 0;
  constructor(
    public deals: SourceDeal[],
    private readonly cap: number,
    /** תקרת עמוד בצד השרת — מקור שמקצץ `limit` בלי לומר שאין עוד. */
    private readonly serverLimit = Number.POSITIVE_INFINITY,
  ) {}

  stats() {
    return Promise.resolve({ deals: this.deals.length, firstDeal: null, lastDeal: null, settlements: 2 });
  }
  settlements() {
    return Promise.resolve([
      { name: CITY_A, code: 9_991, deals: this.deals.filter((d) => d.settlement === CITY_A).length, lastDeal: null },
      { name: CITY_B, code: null, deals: 0, lastDeal: null },
    ]);
  }
  natures() {
    return Promise.resolve(["דירה בבית קומות", "חנות"]);
  }
  dealsSince(settlement: string, dateFrom: string, offset: number, limit: number): Promise<SourceDealPage> {
    this.requests += 1;
    if (offset + limit > this.cap) throw new Error(`היסט מעבר לתקרה: ${offset}+${limit}`);
    const matching = this.deals
      .filter((d) => d.settlement === settlement && d.date >= dateFrom)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.subParcel! - b.subParcel!));
    const applied = Math.min(limit, this.serverLimit);
    const page = matching.slice(offset, offset + applied);
    return Promise.resolve({ deals: page, pageSize: page.length, limit: applied });
  }
  parcelAt(): Promise<SourceParcel | null> {
    return Promise.resolve(null);
  }
  parcel(gush: number, helka: number): Promise<SourceParcel | null> {
    return Promise.resolve({ gush, helka, settlementCode: 9_991, statArea: 99_910_001, socioEshkol: 7, lat: 32.1, lon: 34.8, street: "רחוב הבדיקה" });
  }
}

/** שעון מזויף — `sleep` מקדם אותו במקום לחכות. */
function fakeClock(start = Date.UTC(2026, 9, 5)): IngestClock & { t: number } {
  const clock = {
    t: start,
    now: () => new Date(clock.t),
    sleep: (ms: number) => {
      clock.t += ms;
      return Promise.resolve();
    },
  };
  return clock;
}

function ingestWith(source: MarketSource, clock = fakeClock(), budgetMs = 60 * 60 * 1000): MarketIngest {
  return new MarketIngest(db, source, {
    intervalMs: 1_000,
    deadline: new Date(clock.t + budgetMs),
    clock,
    pageSize: 4,
    searchCap: 10,
  });
}

async function clean(): Promise<void> {
  await db.$executeRaw`DELETE FROM market_parcels WHERE gush >= ${GUSH}`;
  await db.$executeRaw`DELETE FROM market_deals WHERE gush >= ${GUSH}`;
  const ids = await db.marketSettlement.findMany({ where: { name: { in: [CITY_A, CITY_B] } }, select: { id: true } });
  await db.$executeRaw`DELETE FROM market_segment_stats WHERE settlement_id = ANY(${ids.map((r) => r.id)}::int[])`;
  await db.marketSettlement.deleteMany({ where: { name: { in: [CITY_A, CITY_B] } } });
}

async function settlementA() {
  return db.marketSettlement.findUniqueOrThrow({ where: { name: CITY_A } });
}

beforeAll(async () => {
  const url = process.env["DIRECT_DATABASE_URL"];
  if (url === undefined || url === "") throw new Error("DIRECT_DATABASE_URL חסר — הבדיקה דורשת מסד אמיתי");
  db = new PrismaClient({ adapter: prismaAdapter(url) });
  await clean();
});

afterAll(async () => {
  await clean();
  await db.$disconnect();
});

beforeEach(clean);

describe("קליטת יישוב", () => {
  it("קולט את כל העסקאות דרך כמה חלונות, פעם אחת כל אחת", async () => {
    const source = new FakeSource(Array.from({ length: 25 }, (_, i) => deal(i)), 10);
    const ingest = ingestWith(source);
    await ingest.refreshCatalog();
    const outcome = await ingest.syncSettlement((await settlementA()).id);

    expect(outcome.complete).toBe(true);
    expect(await db.marketDeal.count({ where: { gush: GUSH } })).toBe(25);
    const after = await settlementA();
    expect(after.status).toBe("ok");
    expect(after.backfillCursor).toBeNull();
    expect(after.syncedThrough?.toISOString().slice(0, 10)).toBe("2024-01-25");
    // יותר מחלון אחד: 25 שורות בעמודים של 4 ותקרה של 10
    expect(source.requests).toBeGreaterThan(7);
  });

  it("קליטה חוזרת אינה מכפילה, וקולטת רק את החדש", async () => {
    const source = new FakeSource(Array.from({ length: 12 }, (_, i) => deal(i)), 10);
    await ingestWith(source).refreshCatalog();
    const id = (await settlementA()).id;
    await ingestWith(source).syncSettlement(id);

    source.deals.push(deal(30), deal(31));
    const second = ingestWith(source);
    const outcome = await second.syncSettlement(id);
    expect(outcome.rows).toBe(2);
    expect(await db.marketDeal.count({ where: { gush: GUSH } })).toBe(14);
  });

  it("נעצר בזמן, שומר סמן, וממשיך מאותה נקודה", async () => {
    const source = new FakeSource(Array.from({ length: 25 }, (_, i) => deal(i)), 10);
    await ingestWith(source).refreshCatalog();
    const id = (await settlementA()).id;

    // שלוש בקשות בלבד ואז נגמר הזמן
    const partial = await ingestWith(source, fakeClock(), 2_500).syncSettlement(id);
    expect(partial.complete).toBe(false);
    const mid = await settlementA();
    expect(mid.status).toBe("backfill");
    expect(mid.backfillCursor).not.toBeNull();
    const stored = await db.marketDeal.count({ where: { gush: GUSH } });
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(25);

    const rest = await ingestWith(source).syncSettlement(id);
    expect(rest.complete).toBe(true);
    expect(await db.marketDeal.count({ where: { gush: GUSH } })).toBe(25);
  });

  it("מקור שמקצץ את גודל העמוד אינו נראה כסוף הנתונים", async () => {
    // מבקשים 4, השרת מחזיר 3 — עמוד מלא של 3 אינו העמוד האחרון
    const source = new FakeSource(Array.from({ length: 25 }, (_, i) => deal(i)), 10, 3);
    await ingestWith(source).refreshCatalog();
    const outcome = await ingestWith(source).syncSettlement((await settlementA()).id);
    expect(outcome.complete).toBe(true);
    expect(await db.marketDeal.count({ where: { gush: GUSH } })).toBe(25);
  });

  it("מחיר למ\"ר שחורג מ-INTEGER נשמר כ-null ואינו מפיל את העמוד", async () => {
    const source = new FakeSource([deal(0, { amountIls: 3_000_000_000, areaSqm: 1 }), deal(1)], 10);
    await ingestWith(source).refreshCatalog();
    await ingestWith(source).syncSettlement((await settlementA()).id);
    const rows = await db.marketDeal.findMany({ where: { gush: GUSH }, orderBy: { amountIls: "desc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ppsqm).toBeNull();
  });

  it("סנכרון שלא הביא עסקאות חדשות אינו מסמן את היישוב לבנייה מחדש", async () => {
    const source = new FakeSource(Array.from({ length: 6 }, (_, i) => deal(i)), 10);
    await ingestWith(source).refreshCatalog();
    const id = (await settlementA()).id;
    const first = ingestWith(source);
    await first.syncSettlement(id);
    expect(first.touched.has(id)).toBe(true);
    const again = ingestWith(source);
    await again.syncSettlement(id);
    expect(again.touched.size).toBe(0);
    expect(again.rows).toBe(0);
  });

  it("סוג שלא היה ברשימה נוצר בזמן הקליטה", async () => {
    const source = new FakeSource([deal(0, { nature: "סוג חדש לגמרי" })], 10);
    await ingestWith(source).refreshCatalog();
    await ingestWith(source).syncSettlement((await settlementA()).id);
    expect(await db.marketNature.count({ where: { name: "סוג חדש לגמרי" } })).toBe(1);
    await db.marketDeal.deleteMany({ where: { gush: GUSH } });
    await db.marketNature.deleteMany({ where: { name: "סוג חדש לגמרי" } });
  });
});

describe("סטטיסטיקה", () => {
  it("חציון בלי עסקאות חלקיות, וחריגים מסומנים", async () => {
    // 24 עסקאות רגילות ב-20,000–25,000 ₪ למ"ר, אחת חלקית ואחת חריגה
    const deals = Array.from({ length: 24 }, (_, i) => deal(i, { amountIls: 2_000_000 + i * 20_000 }));
    deals.push(deal(40, { amountIls: 300_000, portion: 0.1 }));
    deals.push(deal(41, { amountIls: 30_000_000 }));
    const source = new FakeSource(deals, 10);
    await ingestWith(source).refreshCatalog();
    const id = (await settlementA()).id;
    const ingest = ingestWith(source);
    await ingest.syncSettlement(id);
    await ingest.rebuildStats(id);

    const outlier = await db.marketDeal.findFirst({ where: { gush: GUSH, amountIls: 30_000_000n } });
    expect(outlier && (outlier.flags & MARKET_FLAGS.outlier) !== 0).toBe(true);

    const row = await db.marketSegmentStat.findFirstOrThrow({
      where: { settlementId: id, natureGroup: 0, roomBucket: 0, year: 2024, quarter: 0 },
    });
    // כל 24 הרגילות נספרות — הגדר אינה חותכת את הקצוות של מדגם רגיל —
    // והחלקית והחריגה לא
    expect(row.deals).toBe(24);
    expect(Number(row.medianPrice)).toBeGreaterThan(2_000_000);
    expect(Number(row.medianPrice)).toBeLessThan(2_500_000);

    const byRooms = await db.marketSegmentStat.findFirst({
      where: { settlementId: id, natureGroup: 0, roomBucket: 4, year: 2024, quarter: 0 },
    });
    expect(byRooms?.deals).toBe(24);
    const quarter = await db.marketSegmentStat.findMany({
      where: { settlementId: id, natureGroup: 0, roomBucket: 0, year: 2024, quarter: { gt: 0 } },
    });
    expect(quarter.reduce((sum, q) => sum + q.deals, 0)).toBe(24);
    const flagged = await db.marketDeal.count({ where: { gush: GUSH, flags: { gte: MARKET_FLAGS.outlier } } });
    expect(flagged).toBe(1);
  });

  it("בנייה מחדש מוחקת את הישן ואינה מצטברת", async () => {
    const source = new FakeSource(Array.from({ length: 6 }, (_, i) => deal(i)), 10);
    await ingestWith(source).refreshCatalog();
    const id = (await settlementA()).id;
    const ingest = ingestWith(source);
    await ingest.syncSettlement(id);
    await ingest.rebuildStats(id);
    await ingest.rebuildStats(id);
    const rows = await db.marketSegmentStat.findMany({ where: { settlementId: id, roomBucket: 0, quarter: 0 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deals).toBe(6);
  });
});

describe("חלקות", () => {
  it("מעשיר חלקות שיש בהן עסקאות, פעם אחת", async () => {
    const source = new FakeSource(Array.from({ length: 6 }, (_, i) => deal(i, { date: "2025-06-01" })), 10);
    await ingestWith(source).refreshCatalog();
    const ingest = ingestWith(source);
    await ingest.syncSettlement((await settlementA()).id);
    expect(await ingest.enrichParcels(50)).toBe(3);
    expect(await ingestWith(source).enrichParcels(50)).toBe(0);
    const parcel = await db.marketParcel.findUniqueOrThrow({ where: { gush_helka: { gush: GUSH, helka: 1 } } });
    expect(parcel.statArea).toBe(99_910_001);
    expect(parcel.lat).toBeCloseTo(32.1);
  });
});
