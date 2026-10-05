import { Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  MARKET_SOURCE_ATTRIBUTION,
  marketPosition,
  marketPositionSentence,
  propertyTypeToNatureGroup,
  selectComparables,
  type MarketSubject,
  type PropertyMarketDto,
  type PropertyParcelInput,
  type PropertyType,
} from "@metavchim/shared";
import { TenantContext } from "../../common/tenant-context";
import { AuditService } from "../../core/audit.service";
import { PrismaService, type TenantTx } from "../../core/prisma.service";
import type { MarketIngest } from "./market-ingest";
import { MarketService, type SettlementRecord } from "./market.service";

/** כמה עסקאות בניין להציג בכרטיס. ההיסטוריה המלאה — במסך החלקה. */
const BUILDING_SHOWN = 30;

/** סבב צילומי המחיר — כל שעה, רק לנכסים שהשתנו או שהצילום שלהם ישן. */
const SNAPSHOT_TICK_MS = 60 * 60 * 1000;
const SNAPSHOT_FIRST_DELAY_MS = 5 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** תקרת נכסים לסבב אחד — הגנה, לא אופטימיזציה (כמו בסבב ההתאמות). */
const SNAPSHOTS_PER_TICK = 2_000;

/** סטטוסים שיש טעם להשוות בהם מחיר — נכס שנמכר כבר אינו מבקש מחיר. */
const PRICED_STATUSES = ["draft", "active", "on_hold"];

interface PropertyRow {
  id: string;
  city: string | null;
  propertyType: string | null;
  dealType: string | null;
  rooms: { toNumber(): number } | null;
  areaSqm: number | null;
  priceAgorot: bigint | null;
  gush: number | null;
  helka: number | null;
  subParcel: number | null;
  parcelSource: string | null;
}

const PROPERTY_SELECT = {
  id: true,
  city: true,
  propertyType: true,
  dealType: true,
  rooms: true,
  areaSqm: true,
  priceAgorot: true,
  gush: true,
  helka: true,
  subParcel: true,
  parcelSource: true,
} as const;

/**
 * ‎**הנכס של המשרד מול השוק** — הגשר בין טבלה תחת RLS לטבלאות ציבוריות.
 *
 * כל קריאה של נכס עוברת `withTenant`/`withExplicitTenant`; העסקאות
 * נקראות מ-`MarketService`, שאינו נוגע בשום טבלה של משרד. אין כאן
 * כתיבה לטבלאות השוק מתוך נתוני משרד, ואין זרימה הפוכה: מה שמשרד אחד
 * הקליד על הנכס שלו אינו מגיע לאף משרד אחר.
 */
@Injectable()
export class MarketPropertyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketPropertyService.name);
  private timer: NodeJS.Timeout | null = null;
  private kickoff: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.kickoff = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), SNAPSHOT_TICK_MS);
      this.timer.unref?.();
    }, SNAPSHOT_FIRST_DELAY_MS);
    this.kickoff.unref?.();
  }

  onModuleDestroy(): void {
    if (this.kickoff) clearTimeout(this.kickoff);
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshSnapshots({ onlyStale: true });
    } catch (error: unknown) {
      this.logger.error(`market snapshots failed: ${String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  /* ============================================================
     כרטיס הנכס
     ============================================================ */

  async forProperty(propertyId: string, now: Date): Promise<PropertyMarketDto> {
    const property = await this.prisma.withTenant((tx) => this.load(tx, propertyId));
    const settlement = await this.market.resolveSettlement(property.city);
    const parcel =
      property.gush !== null && property.helka !== null
        ? { gush: property.gush, helka: property.helka, subParcel: property.subParcel, source: property.parcelSource }
        : null;

    const [building, apartment, freshness] = await Promise.all([
      parcel ? this.market.parcelDeals(parcel.gush, parcel.helka, BUILDING_SHOWN) : Promise.resolve({ deals: [], total: 0 }),
      parcel && parcel.subParcel !== null
        ? this.market.parcelDeals(parcel.gush, parcel.helka, 20, parcel.subParcel).then((r) => r.deals)
        : Promise.resolve([]),
      settlement ? this.market.freshness(settlement) : Promise.resolve(null),
    ]);

    const comparable = property.dealType !== "rent";
    const evaluated = comparable && settlement ? await this.evaluate(property, settlement, now) : null;

    return {
      parcel,
      settlement: settlement ? { id: settlement.id, name: settlement.name } : null,
      freshness,
      apartment,
      building,
      comparison: evaluated
        ? { ...evaluated.comparison, comps: await this.market.dealsByIds(evaluated.comparison.comps.map((c) => c.id)) }
        : null,
      position: evaluated?.position ?? null,
      positionSentence:
        evaluated?.position && evaluated.comparison.sampleSize > 0
          ? marketPositionSentence(evaluated.position, evaluated.comparison.sampleSize)
          : null,
      comparable,
      attribution: MARKET_SOURCE_ATTRIBUTION,
    };
  }

  /**
   * גוש/חלקה מנסח הטאבו — אדם גובר על חישוב.
   *
   * ‎`null` מנתק, ואז הסבב יגזור שוב מהמיקום. הצילום מחושב מחדש מיד:
   * המתווך שהקליד גוש-חלקה מצפה לראות את ההשוואה החדשה עכשיו.
   */
  async setParcel(propertyId: string, input: PropertyParcelInput, now: Date): Promise<PropertyMarketDto> {
    const tenantId = TenantContext.current().tenantId;
    await this.prisma.withTenant(async (tx) => {
      await this.load(tx, propertyId);
      await tx.property.update({
        where: { id: propertyId },
        data:
          input === null
            ? { gush: null, helka: null, subParcel: null, parcelSource: null, marketCheckedAt: null }
            : {
                gush: input.gush,
                helka: input.helka,
                subParcel: input.subParcel ?? null,
                parcelSource: "agent",
                marketCheckedAt: null,
              },
      });
      await this.audit.record(tx, {
        action: "property.parcel",
        entityType: "property",
        entityId: propertyId,
        metadata: input === null ? { cleared: true } : { gush: input.gush, helka: input.helka },
      });
    });
    // רגע הצילום אחרי הכתיבה, ולא תחילת הבקשה — אחרת `updated_at` של
    // העריכה הזו היה מאוחר מהצילום, והסבב היה מצלם שוב בלי סיבה
    await this.snapshotOne(tenantId, propertyId, new Date());
    return this.forProperty(propertyId, now);
  }

  private async load(tx: TenantTx, propertyId: string): Promise<PropertyRow> {
    const property = await tx.property.findFirst({
      where: { id: propertyId, tenantId: TenantContext.current().tenantId, deletedAt: null },
      select: PROPERTY_SELECT,
    });
    if (!property) throw new NotFoundException("נכס לא נמצא");
    return property;
  }

  private async evaluate(property: PropertyRow, settlement: SettlementRecord, now: Date) {
    const subject: MarketSubject = {
      group: propertyTypeToNatureGroup(property.propertyType as PropertyType | null),
      rooms: property.rooms?.toNumber() ?? null,
      areaSqm: property.areaSqm,
      gush: property.gush,
      helka: property.helka,
      statArea: await this.market.statAreaOf(property.gush, property.helka),
    };
    const candidates = await this.market.candidates(settlement.id, subject.group, subject, now);
    const comparison = selectComparables(subject, candidates, now);
    const askingIls = property.priceAgorot === null ? null : Number(property.priceAgorot) / 100;
    return { comparison, position: marketPosition(askingIls, comparison.estimate) };
  }

  /* ============================================================
     צילומי מחיר — לתגית „מתחת לשוק” ברשימות ובהתאמות
     ============================================================ */

  private async snapshotOne(tenantId: string, propertyId: string, now: Date): Promise<void> {
    const property = await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.property.findFirst({ where: { id: propertyId, tenantId, deletedAt: null }, select: PROPERTY_SELECT }),
    );
    if (!property) return;
    const settlement = property.dealType === "rent" ? null : await this.market.resolveSettlement(property.city);
    const evaluated = settlement ? await this.evaluate(property, settlement, now) : null;
    const diffPct = evaluated?.position?.diffPct ?? null;
    const sample = evaluated && !evaluated.comparison.insufficient ? evaluated.comparison.sampleSize : null;
    /*
     * ‎**SQL ולא `update`, כדי לא לגעת ב-`updated_at`.** `@updatedAt` של
     * Prisma מעדכן אותו בכל כתיבה, והצילום היה הופך כל נכס ל„נערך
     * עכשיו” — גם ברשימות („עודכן לפני דקה” על נכס שאיש לא נגע בו),
     * וגם כאן: נכס שנערך אחרי הצילום נבחר לצילום חוזר, ולכן כל צילום
     * היה מזמין את הבא אחריו, לנצח.
     */
    await this.prisma.withExplicitTenant(tenantId, (tx) =>
      tx.$executeRaw`
        UPDATE properties
        SET market_diff_pct = ${diffPct}, market_sample = ${sample}, market_checked_at = ${now}
        WHERE id = ${propertyId} AND tenant_id = ${tenantId}`,
    );
  }

  /**
   * צילום מחודש לנכסי כל המשרדים.
   *
   * ‎`onlyStale` — רק נכס שאין לו צילום, שנערך אחרי הצילום, או שהצילום
   * שלו בן יותר משבוע. בלי הסינון, כל סבב היה מחשב מחדש אלפי נכסים
   * שלא השתנו בהם דבר.
   */
  async refreshSnapshots(options: { onlyStale?: boolean } = {}): Promise<number> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - SNAPSHOT_MAX_AGE_MS);
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let done = 0;
    for (const tenant of tenants) {
      if (done >= SNAPSHOTS_PER_TICK) break;
      const ids = await this.prisma.withExplicitTenant(tenant.id, async (tx) => {
        const rows = await tx.property.findMany({
          where: {
            tenantId: tenant.id,
            deletedAt: null,
            status: { in: PRICED_STATUSES },
            city: { not: null },
            ...(options.onlyStale
              ? { OR: [{ marketCheckedAt: null }, { marketCheckedAt: { lt: staleBefore } }] }
              : {}),
          },
          select: { id: true, updatedAt: true, marketCheckedAt: true },
          take: SNAPSHOTS_PER_TICK - done,
        });
        // נכס שנערך אחרי הצילום — נשלף בנפרד, כי Prisma אינו משווה שתי עמודות
        const edited = options.onlyStale
          ? await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM properties
              WHERE tenant_id = ${tenant.id} AND deleted_at IS NULL
                AND market_checked_at IS NOT NULL AND updated_at > market_checked_at
              LIMIT ${SNAPSHOTS_PER_TICK}`
          : [];
        return [...new Set([...rows.map((r) => r.id), ...edited.map((r) => r.id)])];
      });
      for (const id of ids) {
        try {
          await this.snapshotOne(tenant.id, id, now);
          done += 1;
        } catch (error: unknown) {
          this.logger.warn(`market snapshot failed for property ${id}: ${String(error)}`);
        }
      }
    }
    return done;
  }

  /* ============================================================
     קישור לחלקה — מהמיקום של הנכס
     ============================================================ */

  /**
   * גזירת גוש-חלקה לנכסים שיש להם מיקום ואין להם חלקה.
   *
   * ‎**הבקשה לרשת מחוץ לטרנזקציה**: קודם נשלפים המועמדים, אחר כך
   * פונים למקור, ורק אז נכתבת התוצאה בטרנזקציה קצרה — חיבור מסד לא
   * מוחזק פתוח בזמן שמחכים לשירות חיצוני. הכתיבה מותנית ב-
   * ‎`parcel_source IS NULL`: אם המתווך הקליד חלקה בדיוק באמצע, הוא גובר.
   *
   * ‎**מה יוצא החוצה**: קואורדינטה בלבד, בלי מזהה נכס, משרד או משתמש
   * (docs/14 §7).
   */
  async linkParcels(ingest: MarketIngest, limit: number): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let linked = 0;
    for (const tenant of tenants) {
      if (linked >= limit || !ingest.hasTime()) break;
      const pending = await this.prisma.withExplicitTenant(tenant.id, (tx) =>
        tx.property.findMany({
          where: {
            tenantId: tenant.id,
            deletedAt: null,
            parcelSource: null,
            latitude: { not: null },
            longitude: { not: null },
          },
          select: { id: true, latitude: true, longitude: true },
          take: limit - linked,
        }),
      );
      for (const property of pending) {
        if (!ingest.hasTime()) break;
        const parcel = await ingest.call(() =>
          ingest.dataSource.parcelAt(property.latitude!, property.longitude!),
        );
        if (parcel) {
          await this.prisma.marketParcel.upsert({
            where: { gush_helka: { gush: parcel.gush, helka: parcel.helka } },
            create: {
              gush: parcel.gush,
              helka: parcel.helka,
              statArea: parcel.statArea,
              socioEshkol: parcel.socioEshkol,
              lat: parcel.lat,
              lon: parcel.lon,
              street: parcel.street,
              status: "ok",
            },
            update: { statArea: parcel.statArea, socioEshkol: parcel.socioEshkol },
          });
        }
        // SQL ולא `update` — גזירה של המערכת אינה „עריכה” (ראו `snapshotOne`)
        await this.prisma.withExplicitTenant(tenant.id, (tx) =>
          parcel
            ? tx.$executeRaw`
                UPDATE properties
                SET gush = ${parcel.gush}, helka = ${parcel.helka}, parcel_source = 'lookup', market_checked_at = NULL
                WHERE id = ${property.id} AND tenant_id = ${tenant.id} AND parcel_source IS NULL`
            : tx.$executeRaw`
                UPDATE properties SET parcel_source = 'none'
                WHERE id = ${property.id} AND tenant_id = ${tenant.id} AND parcel_source IS NULL`,
        );
        linked += 1;
      }
    }
    return linked;
  }
}
