import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ulid } from "ulid";
import { TenantContext } from "../../common/tenant-context";
import type { AuditService } from "../../core/audit.service";
import { PrismaService } from "../../core/prisma.service";
import type { WebLeadService } from "../leads/web-lead.service";
import { MarketIngest } from "./market-ingest";
import { MarketPropertyService } from "./market-property.service";
import { MarketPublicService } from "./market-public.service";
import type { MarketSource } from "./market-source";
import { MarketService } from "./market.service";

/**
 * ‎**הגשר בין נכס של משרד לבין נתוני השוק — מבעד לתפקיד האפליקציה.**
 *
 * הטבלאות של השוק פתוחות, ו-`properties` תחת FORCE RLS. מה שנבדק כאן
 * הוא בדיוק התפר:
 *
 * 1. הצילום והקישור לחלקה נכתבים ב-SQL גולמי תחת הקשר דייר — ואינם
 *    נוגעים ב-`updated_at` (אחרת כל צילום היה מזמין את הבא, לנצח).
 * 2. הכרטיס מחשב השוואה מהבניין עצמו כשיש בו מספיק עסקאות.
 * 3. הטופס הציבורי מחשב טווח בלי פרטים, ויוצר ליד מוכר רק עם פרטים.
 *
 * כל זה מול Postgres אמיתי ותפקיד אמיתי: מוק של Prisma היה מאשר
 * כתיבה שה-RLS חוסם בשקט.
 */

const TENANT = "01MARKETBRIDGEAAAAAAAAAAAA";
const CITY = "יישוב גשר השוק";
const GUSH = 990_200;
/** קוד למ"ס פיקטיבי — שלא יתנגש ביישוב אמיתי. */
const SETTLEMENT_CODE = 99_002;
const KEY = "marketbridgetestkey000000000001";

let owner: PrismaClient;
let app: PrismaService;
let market: MarketService;
let properties: MarketPropertyService;
let settlementId: number;

const run = <T>(fn: () => Promise<T>): Promise<T> =>
  TenantContext.run(
    { tenantId: TENANT, userId: "", capabilities: new Set(), billingOnly: false },
    fn,
  );

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`חסר משתנה סביבה ${name}`);
  return value;
}

/** עסקאות אחרונות בחלקה — מספיק כדי שהבניין לבדו יגיע לסף. */
async function seedDeals(): Promise<void> {
  await owner.$executeRaw`
    INSERT INTO market_natures (id, name, nature_group)
    VALUES (32000, 'דירה בבית קומות — בדיקת גשר', 0) ON CONFLICT DO NOTHING`;
  const recent = new Date();
  recent.setUTCMonth(recent.getUTCMonth() - 4);
  for (let i = 0; i < 6; i += 1) {
    const amount = 2_000_000 + i * 50_000;
    await owner.$executeRaw`
      INSERT INTO market_deals (id, deal_date, amount_ils, settlement_id, nature_id, nature_group,
                                area_sqm, rooms, year_built, portion, ppsqm, gush, helka, sub_parcel, flags)
      VALUES (${BigInt(-9_000_000 - i)}, ${recent}, ${amount}, ${settlementId}, 32000, 0,
              100, 4, 1990, 1, ${amount / 100}, ${GUSH}, 5, ${i + 1}, 0)`;
  }
}

async function insertProperty(fields: { gush?: number; helka?: number; source?: string; lat?: number; lon?: number }): Promise<string> {
  const id = ulid();
  await owner.$executeRaw`
    INSERT INTO properties (id, tenant_id, status, city, property_type, deal_type, rooms, area_sqm,
                            price_agorot, gush, helka, parcel_source, latitude, longitude,
                            created_at, updated_at)
    VALUES (${id}, ${TENANT}, 'active', ${CITY}, 'apartment', 'sale', 4, 100, ${260_000_000n},
            ${fields.gush ?? null}, ${fields.helka ?? null}, ${fields.source ?? null},
            ${fields.lat ?? null}, ${fields.lon ?? null},
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`;
  return id;
}

async function cleanup(): Promise<void> {
  await owner.$executeRaw`DELETE FROM properties WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM lead_webhooks WHERE tenant_id = ${TENANT}`;
  await owner.$executeRaw`DELETE FROM market_deals WHERE gush = ${GUSH}`;
  await owner.$executeRaw`DELETE FROM market_parcels WHERE gush = ${GUSH}`;
  await owner.$executeRaw`DELETE FROM market_natures WHERE id = 32000`;
  await owner.$executeRaw`DELETE FROM market_settlements WHERE name = ${CITY}`;
  await owner.$executeRaw`DELETE FROM tenants WHERE id = ${TENANT}`;
}

beforeAll(async () => {
  owner = new PrismaClient({ datasources: { db: { url: requiredEnv("DIRECT_DATABASE_URL") } } });
  await cleanup();
  await owner.$executeRaw`
    INSERT INTO tenants (id, name, created_at, updated_at) VALUES (${TENANT}, 'משרד גשר השוק', now(), now())`;
  const [row] = await owner.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(max(id), 0) + 1 AS next FROM market_settlements`;
  settlementId = Number(row?.next ?? 1);
  await owner.$executeRaw`
    INSERT INTO market_settlements (id, name, code, source_deals, status, synced_through)
    VALUES (${settlementId}, ${CITY}, ${SETTLEMENT_CODE}, 6, 'ok', now())`;
  await seedDeals();
  await owner.$executeRaw`
    INSERT INTO lead_webhooks (id, tenant_id, key, source_label, created_at)
    VALUES (${ulid()}, ${TENANT}, ${KEY}, 'אתר', now())`;

  app = new PrismaService({ datasources: { db: { url: requiredEnv("APP_DATABASE_URL") } } });
  market = new MarketService(app);
  properties = new MarketPropertyService(app, market, { record: async () => undefined } as unknown as AuditService);
});

afterAll(async () => {
  await cleanup();
  await owner.$disconnect();
  await app.$disconnect();
});

describe("צילום המחיר", () => {
  it("נכתב תחת RLS, בלי לגעת ב-updated_at", async () => {
    const id = await insertProperty({ gush: GUSH, helka: 5, source: "agent" });
    await properties.refreshSnapshots({ onlyStale: true });

    const [row] = await owner.$queryRaw<
      { market_position: string | null; market_diff_pct: number | null; market_sample: number | null; updated_at: Date }[]
    >`SELECT market_position, market_diff_pct, market_sample, updated_at FROM properties WHERE id = ${id}`;
    // 2.6 מיליון מול חציון של כ-2.12 — מעל הטווח
    expect(row?.market_position).toBe("above");
    expect(row?.market_diff_pct).toBeGreaterThan(15);
    expect(row?.market_sample).toBe(6);
    expect(row?.updated_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // סבב שני אינו מצלם שוב נכס שלא השתנה
    expect(await properties.refreshSnapshots({ onlyStale: true })).toBe(0);
  });

  it("נכס שנמכר מאבד את התגית בסבב הבא", async () => {
    const id = await insertProperty({ gush: GUSH, helka: 5, source: "agent" });
    await properties.refreshSnapshots({ onlyStale: true });
    // עריכה אחרי הצילום — כמו מעבר ל„נמכר” מהכרטיס
    await owner.$executeRaw`UPDATE properties SET status = 'sold', updated_at = now() WHERE id = ${id}`;
    await properties.refreshSnapshots({ onlyStale: true });

    const [row] = await owner.$queryRaw<{ market_position: string | null; market_sample: number | null }[]>`
      SELECT market_position, market_sample FROM properties WHERE id = ${id}`;
    expect(row).toEqual({ market_position: null, market_sample: null });
  });
});

describe("כרטיס הנכס", () => {
  it("משווה לבניין עצמו כשיש בו מספיק עסקאות", async () => {
    const id = await insertProperty({ gush: GUSH, helka: 5, source: "agent" });
    const dto = await run(() => properties.forProperty(id, new Date()));
    expect(dto.settlement?.name).toBe(CITY);
    expect(dto.comparison?.scope).toBe("building");
    expect(dto.comparison?.sampleSize).toBe(6);
    expect(dto.building.total).toBe(6);
    expect(dto.position?.kind).toBe("above");
    expect(dto.comparison?.comps[0]?.nature).toContain("דירה");
  });

  it("נכס של משרד אחר אינו נגיש — 404 ולא נתונים", async () => {
    const id = await insertProperty({ gush: GUSH, helka: 5, source: "agent" });
    await expect(
      TenantContext.run(
        { tenantId: "01OTHERTENANTAAAAAAAAAAAAA", userId: "", capabilities: new Set(), billingOnly: false },
        () => properties.forProperty(id, new Date()),
      ),
    ).rejects.toThrow("נכס לא נמצא");
  });
});

describe("קישור לחלקה מהמיקום", () => {
  it("גוזר גוש-חלקה ומסמן lookup, בלי לגעת ב-updated_at", async () => {
    const id = await insertProperty({ lat: 32.08, lon: 34.78 });
    const source = {
      name: "fake",
      parcelAt: (lat: number, lon: number) =>
        Promise.resolve({ gush: GUSH, helka: 7, settlementCode: SETTLEMENT_CODE, statArea: 555, socioEshkol: 8, lat, lon, street: null }),
    } as unknown as MarketSource;
    const ingest = new MarketIngest(app, source, { intervalMs: 0, deadline: new Date(Date.now() + 60_000) });
    expect(await properties.linkParcels(ingest, 10)).toBeGreaterThanOrEqual(1);

    const [row] = await owner.$queryRaw<{ gush: number | null; helka: number | null; parcel_source: string | null; updated_at: Date }[]>`
      SELECT gush, helka, parcel_source, updated_at FROM properties WHERE id = ${id}`;
    expect(row).toMatchObject({ gush: GUSH, helka: 7, parcel_source: "lookup" });
    expect(row?.updated_at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    const parcel = await owner.marketParcel.findUnique({ where: { gush_helka: { gush: GUSH, helka: 7 } } });
    expect(parcel?.statArea).toBe(555);
    // היישוב מקוד הלמ"ס — אחרת חיפוש הרחוב בטופס הציבורי לא רואה את החלקה
    expect(parcel?.settlementId).toBe(settlementId);
  });
});

describe("הטופס הציבורי", () => {
  const calls: { tenantId: string; input: Record<string, unknown>; source: string }[] = [];
  const webLeads = {
    ingestForTenant: (tenantId: string, input: Record<string, unknown>, source: string) => {
      calls.push({ tenantId, input, source });
      return Promise.resolve();
    },
  } as unknown as WebLeadService;

  it("טווח בלי פרטים — ובלי ליד", async () => {
    const svc = new MarketPublicService(app, market, webLeads);
    const result = await svc.estimate(KEY, { city: CITY, rooms: 4, areaSqm: 100 }, new Date());
    expect(result.settlement).toBe(CITY);
    expect(result.sampleSize).toBe(6);
    expect(result.estimate?.basis).toBe("ppsqm");
    expect(result.leadCreated).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("עם פרטים — ליד מוכר אחד, במקור „הערכת שווי”", async () => {
    const svc = new MarketPublicService(app, market, webLeads);
    const result = await svc.estimate(
      KEY,
      { city: CITY, rooms: 4, contact: { name: "דנה", phone: "+972501234567" } },
      new Date(),
    );
    expect(result.leadCreated).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tenantId: TENANT, source: "הערכת שווי", input: { intent: "sell" } });
  });

  it("מפתח לא מוכר — 404", async () => {
    const svc = new MarketPublicService(app, market, webLeads);
    await expect(svc.estimate("nosuchkeynosuchkeynosuchkey", { city: CITY, rooms: 4 }, new Date())).rejects.toThrow("לא נמצא");
  });
});
