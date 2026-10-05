import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  MARKET_FLAGS,
  MARKET_NATURE_GROUPS,
  MARKET_OUTLIER_FENCE_IQR,
  MARKET_OUTLIER_MIN_SAMPLE,
  isDwellingGroup,
  marketDealFlags,
  marketDealKey,
  marketNatureGroup,
  pricePerSqm,
} from "@metavchim/shared";
import {
  MarketSourceTransientError,
  SOURCE_SEARCH_CAP,
  type MarketSource,
  type SourceDeal,
} from "./market-source";

/**
 * ‎**הקליטה עצמה — בלי טיימר, בלי נעילה ובלי הגדרות.**
 *
 * מופרדת מ-`MarketSyncService` כדי שאפשר יהיה להריץ אותה בבדיקה מול
 * מסד אמיתי ומקור מזויף: סמן שלא מתקדם, כפילות שנכנסת פעמיים או
 * סטטיסטיקה שנבנית על עסקאות חלקיות — כל אלה נראים רק מול Postgres.
 *
 * ## כל הארץ, יישוב אחר יישוב, עם סמן תאריך
 *
 * חיפוש אחד במקור נעצר ב-10,000 תוצאות, ות"א לבדה יש בה רבע מיליון.
 * לכן כל יישוב נקרא מהעסקה הישנה לחדשה: עמוד אחר עמוד באותו חלון,
 * וכשמתקרבים לתקרה — חלון חדש שמתחיל בתאריך האחרון שנקרא. הסמן נשמר
 * אחרי **כל** עמוד, כך שקריסה, פריסה או חסימה זמנית ממשיכות מאותה
 * נקודה ולא מההתחלה. עסקאות של התאריך שבגבול נקראות פעמיים — המזהה
 * הדטרמיניסטי הופך את זה ל-no-op.
 */

/** כמה שורות לבקש בעמוד. המקור עשוי להחזיר פחות — ראו `pageSize`. */
export const MARKET_PAGE_SIZE = 200;

/**
 * הסנכרון השוטף חוזר 60 יום אחורה מהעסקה האחרונה שנקלטה.
 *
 * עסקה מדווחת לרשות המסים שבועות אחרי החתימה, ומופיעה במקור עם תאריך
 * העסקה ולא עם תאריך הדיווח. סמן שמתחיל מהעסקה האחרונה היה מפספס כל
 * עסקה שדווחה באיחור — כלומר חלק ניכר מכל חודש.
 */
export const MARKET_LATE_REPORT_DAYS = 60;

/** תחילת המאגר. יישוב חדש נקרא מכאן. */
export const MARKET_EPOCH = "1998-01-01";

/** כמה פעמים לנסות שוב תקלה זמנית לפני שמוותרים על היישוב בסבב הזה. */
const TRANSIENT_RETRIES = 2;

export interface IngestClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const realClock: IngestClock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface IngestOptions {
  /** מרווח מזערי בין בקשות למקור. */
  intervalMs: number;
  /** אחרי הרגע הזה לא מתחילים בקשה חדשה — הסבב נגמר בעמוד שלם. */
  deadline: Date;
  clock?: IngestClock;
  /** לבדיקות: עמוד ותקרת חיפוש קטנים, כדי לעבור דרך חלונות בעשרות שורות. */
  pageSize?: number;
  searchCap?: number;
}

export interface SettlementOutcome {
  settlementId: number;
  rows: number;
  /** הקליטה ליישוב הגיעה עד היום (ולא נקטעה בגלל הזמן). */
  complete: boolean;
}

/** מזהה העסקה — 8 הבתים הראשונים של SHA-256 על המפתח הקנוני. */
export function marketDealId(deal: SourceDeal): bigint {
  const key = marketDealKey({
    date: deal.date,
    amountIls: deal.amountIls,
    gush: deal.gush,
    helka: deal.helka,
    subParcel: deal.subParcel,
    nature: deal.nature,
    areaSqm: deal.areaSqm,
    rooms: deal.rooms,
    portion: deal.portion,
  });
  return createHash("sha256").update(key).digest().readBigInt64BE(0);
}

const asDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

function daysBefore(iso: string, days: number): string {
  const date = asDate(iso);
  date.setUTCDate(date.getUTCDate() - days);
  const result = isoOf(date);
  return result < MARKET_EPOCH ? MARKET_EPOCH : result;
}

/** אינדקס הקבוצה ב-`MARKET_NATURE_GROUPS` — מה שנשמר בעמודה. */
export function natureGroupCode(nature: string): number {
  return MARKET_NATURE_GROUPS.indexOf(marketNatureGroup(nature));
}

/** קודי הקבוצות שהן דירת מגורים — לסטטיסטיקת חדרים. */
const DWELLING_CODES = MARKET_NATURE_GROUPS.flatMap((group, index) =>
  isDwellingGroup(group) ? [index] : [],
);

/** הדגלים שפוסלים מסטטיסטיקה — זהה ל-`countsForStats` ב-shared. */
const EXCLUDED_FLAGS = MARKET_FLAGS.partial | MARKET_FLAGS.tinyAmount | MARKET_FLAGS.outlier;

export class MarketIngest {
  /** רגע הבקשה האחרונה — לקצב. */
  private lastRequestAt = 0;
  private readonly clock: IngestClock;
  private natureIds = new Map<string, number>();
  rows = 0;
  private readonly pageSize: number;
  private readonly searchCap: number;

  constructor(
    private readonly db: PrismaClient,
    private readonly source: MarketSource,
    private readonly options: IngestOptions,
  ) {
    this.clock = options.clock ?? realClock;
    this.pageSize = options.pageSize ?? MARKET_PAGE_SIZE;
    this.searchCap = options.searchCap ?? SOURCE_SEARCH_CAP;
  }

  /** האם נשאר זמן להתחיל בקשה. */
  hasTime(): boolean {
    return this.clock.now() < this.options.deadline;
  }

  /**
   * בקשה למקור בקצב קבוע, עם ניסיון חוזר לתקלה זמנית.
   *
   * קצב קבוע ולא מקביליות: זה שירות ציבורי שמתנדבים מפעילים, עם תקציב
   * נתונים לכל כתובת. קליטה של כל הארץ בלילה אחד אינה שווה את הסיכון
   * להיחסם, ובקצב של בקשה לשנייה וחצי היא נגמרת בפחות מיממה.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const wait = this.lastRequestAt + this.options.intervalMs - this.clock.now().getTime();
      if (wait > 0) await this.clock.sleep(wait);
      this.lastRequestAt = this.clock.now().getTime();
      try {
        return await fn();
      } catch (error: unknown) {
        if (!(error instanceof MarketSourceTransientError) || attempt >= TRANSIENT_RETRIES) throw error;
        await this.clock.sleep(5_000 * 4 ** attempt);
      }
    }
  }

  /* ============================================================
     קטלוג — היישובים והסוגים
     ============================================================ */

  /**
   * רענון רשימת היישובים והסוגים, ומספרי העסקאות שהמקור מדווח לכל יישוב.
   *
   * מזהה חדש = MAX+1. בטוח כי יש כותב אחד בלבד (חכירת הסבב ב-
   * ‎`MarketSyncService`), וזה מה שכל המערכת עושה — אין ערך שהמסד ממציא.
   */
  async refreshCatalog(): Promise<{ settlements: number; natures: number }> {
    const settlements = await this.call(() => this.source.settlements());
    const natures = await this.call(() => this.source.natures());

    const known = new Map(
      (await this.db.marketSettlement.findMany({ select: { id: true, name: true } })).map((s) => [s.name, s.id]),
    );
    let nextId = Math.max(0, ...known.values()) + 1;
    for (const settlement of settlements) {
      const sourceLastDeal = settlement.lastDeal ? asDate(settlement.lastDeal) : null;
      const id = known.get(settlement.name);
      if (id === undefined) {
        await this.db.marketSettlement.create({
          data: {
            id: nextId,
            name: settlement.name,
            code: settlement.code,
            sourceDeals: settlement.deals,
            sourceLastDeal,
            backfillCursor: asDate(MARKET_EPOCH),
            status: "pending",
          },
        });
        known.set(settlement.name, nextId);
        nextId += 1;
      } else {
        await this.db.marketSettlement.update({
          where: { id },
          data: { code: settlement.code, sourceDeals: settlement.deals, sourceLastDeal },
        });
      }
    }

    for (const name of natures) await this.natureId(name);
    return { settlements: settlements.length, natures: natures.length };
  }

  /** מזהה הסוג, ויצירה כשהוא חדש — סוג שהופיע בעסקה ולא ברשימה עדיין נקלט. */
  private async natureId(name: string): Promise<number> {
    if (this.natureIds.size === 0) {
      for (const row of await this.db.marketNature.findMany({ select: { id: true, name: true } })) {
        this.natureIds.set(row.name, row.id);
      }
    }
    const key = name === "" ? "לא צוין" : name;
    const existing = this.natureIds.get(key);
    if (existing !== undefined) return existing;
    const id = Math.max(0, ...this.natureIds.values()) + 1;
    await this.db.marketNature.create({ data: { id, name: key, natureGroup: natureGroupCode(key) } });
    this.natureIds.set(key, id);
    return id;
  }

  /* ============================================================
     עסקאות
     ============================================================ */

  /**
   * קליטת יישוב אחד — מהסמן ועד היום, או עד שנגמר הזמן.
   *
   * יישוב בקליטה ראשונה ממשיך מ-`backfill_cursor`; יישוב שכבר נקלט
   * חוזר 60 יום מהעסקה האחרונה. אותה לולאה בדיוק לשני המקרים.
   */
  async syncSettlement(settlementId: number): Promise<SettlementOutcome> {
    const settlement = await this.db.marketSettlement.findUniqueOrThrow({ where: { id: settlementId } });
    let cursor =
      settlement.backfillCursor !== null
        ? isoOf(settlement.backfillCursor)
        : settlement.syncedThrough !== null
          ? daysBefore(isoOf(settlement.syncedThrough), MARKET_LATE_REPORT_DAYS)
          : MARKET_EPOCH;
    const backfilling = settlement.backfillCursor !== null || settlement.syncedThrough === null;
    let syncedThrough = settlement.syncedThrough ? isoOf(settlement.syncedThrough) : null;
    let offset = 0;
    let rows = 0;

    if (backfilling && settlement.status !== "backfill") {
      await this.db.marketSettlement.update({ where: { id: settlementId }, data: { status: "backfill" } });
    }

    while (this.hasTime()) {
      const page = await this.call(() => this.source.dealsSince(settlement.name, cursor, offset, this.pageSize));
      rows += await this.store(page.deals, settlementId);
      const last = page.deals.at(-1)?.date ?? null;
      if (last !== null && (syncedThrough === null || last > syncedThrough)) syncedThrough = last;

      // עמוד חסר = הגענו לסוף. `pageSize` ולא מספר העסקאות שנשמרו:
      // שורות בלי גוש נזרקות, והן אינן סימן לסוף
      if (page.pageSize < this.pageSize) {
        await this.db.marketSettlement.update({
          where: { id: settlementId },
          data: {
            backfillCursor: null,
            syncedThrough: syncedThrough ? asDate(syncedThrough) : null,
            status: "ok",
            lastError: null,
            syncedAt: this.clock.now(),
          },
        });
        this.rows += rows;
        return { settlementId, rows, complete: true };
      }

      if (offset + 2 * page.pageSize <= this.searchCap) {
        offset += page.pageSize;
      } else {
        // חלון חדש מהתאריך האחרון שנקרא. אם כל העמוד באותו תאריך
        // כמו הסמן, יש ביום אחד יותר עסקאות מהתקרה — אין דרך להתקדם
        if (last === null || last === cursor) {
          throw new Error(`ביום ${cursor} יש ביישוב ${settlement.name} יותר עסקאות ממה שהמקור מחזיר בחיפוש אחד`);
        }
        cursor = last;
        offset = 0;
      }

      // הסמן נשמר אחרי כל עמוד — קריסה ממשיכה מכאן
      await this.db.marketSettlement.update({
        where: { id: settlementId },
        data: {
          backfillCursor: backfilling ? asDate(cursor) : null,
          syncedThrough: syncedThrough ? asDate(syncedThrough) : null,
        },
      });
    }
    this.rows += rows;
    return { settlementId, rows, complete: false };
  }

  /** שמירת עמוד — מזהה דטרמיניסטי, ולכן כפילות היא no-op. */
  private async store(deals: readonly SourceDeal[], settlementId: number): Promise<number> {
    if (deals.length === 0) return 0;
    const data = [];
    for (const deal of deals) {
      const group = marketNatureGroup(deal.nature);
      data.push({
        id: marketDealId(deal),
        dealDate: asDate(deal.date),
        amountIls: BigInt(deal.amountIls),
        settlementId,
        natureId: await this.natureId(deal.nature),
        natureGroup: MARKET_NATURE_GROUPS.indexOf(group),
        areaSqm: deal.areaSqm,
        rooms: deal.rooms,
        yearBuilt: deal.yearBuilt,
        portion: deal.portion,
        ppsqm: pricePerSqm(deal.amountIls, deal.areaSqm, deal.portion),
        gush: deal.gush,
        helka: deal.helka,
        subParcel: deal.subParcel,
        flags: marketDealFlags({
          date: deal.date,
          amountIls: deal.amountIls,
          group,
          areaSqm: deal.areaSqm,
          rooms: deal.rooms,
          yearBuilt: deal.yearBuilt,
          portion: deal.portion,
        }),
      });
    }
    const result = await this.db.marketDeal.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  /* ============================================================
     סטטיסטיקה
     ============================================================ */

  /**
   * בנייה מחדש של הסטטיסטיקה ליישוב (או לכל הארץ, `settlementId = 0`).
   *
   * שני שלבים, בסדר הזה: קודם מסמנים חריגים (מחוץ לגדר
   * ‎[P25 − 3·IQR, P75 + 3·IQR] של המחיר למ"ר בסגמנט, כשיש בו לפחות 20
   * עסקאות — `marketOutlierFence` בחבילה המשותפת), ורק אז מחשבים חציונים בלי
   * עסקאות מסומנות. סדר הפוך היה מחשב חציון שכולל את ההקלדות השגויות.
   * החריגים מסומנים לפי יישוב ולא לפי הארץ — 30 אלף ₪ למ"ר חריג
   * בדימונה ורגיל בתל אביב.
   */
  async rebuildStats(settlementId: number): Promise<void> {
    const outlier = MARKET_FLAGS.outlier;
    if (settlementId !== 0) {
      await this.db.$transaction([
        this.db.$executeRaw`
          UPDATE market_deals SET flags = flags & ~${outlier}::smallint
          WHERE settlement_id = ${settlementId} AND (flags & ${outlier}) <> 0`,
        this.db.$executeRaw`
          UPDATE market_deals d SET flags = d.flags | ${outlier}::smallint
          FROM (
            SELECT nature_group, y, q1 - ${MARKET_OUTLIER_FENCE_IQR} * (q3 - q1) AS lo,
                   q3 + ${MARKET_OUTLIER_FENCE_IQR} * (q3 - q1) AS hi
            FROM (
              SELECT nature_group, EXTRACT(YEAR FROM deal_date)::int AS y,
                     percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsqm) AS q1,
                     percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsqm) AS q3
              FROM market_deals
              WHERE settlement_id = ${settlementId} AND ppsqm IS NOT NULL
                AND (flags & ${MARKET_FLAGS.partial | MARKET_FLAGS.tinyAmount}) = 0
              GROUP BY 1, 2
              HAVING count(*) >= ${MARKET_OUTLIER_MIN_SAMPLE}
            ) q
          ) b
          WHERE d.settlement_id = ${settlementId}
            AND d.nature_group = b.nature_group
            AND EXTRACT(YEAR FROM d.deal_date)::int = b.y
            AND d.ppsqm IS NOT NULL
            AND (d.ppsqm < b.lo OR d.ppsqm > b.hi)`,
      ]);
    }

    // ‎`0` = כל הארץ: אותה שאילתה בלי סינון יישוב
    const all = settlementId === 0;
    const dwellings = DWELLING_CODES;
    const statements = [
      this.db.$executeRaw`DELETE FROM market_segment_stats WHERE settlement_id = ${settlementId}`,
      // שנה שלמה, כל הגדלים
      this.db.$executeRaw`
        INSERT INTO market_segment_stats
          (settlement_id, nature_group, room_bucket, year, quarter, deals, new_build_deals,
           median_price, p25_price, p75_price, median_ppsqm, p25_ppsqm, p75_ppsqm, median_area)
        SELECT ${settlementId}, nature_group, 0, EXTRACT(YEAR FROM deal_date)::smallint, 0,
               count(*), count(*) FILTER (WHERE (flags & ${MARKET_FLAGS.newBuild}) <> 0),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY area_sqm) FILTER (WHERE area_sqm IS NOT NULL))::int
        FROM market_deals
        WHERE (${all}::boolean OR settlement_id = ${settlementId}) AND (flags & ${EXCLUDED_FLAGS}) = 0
        GROUP BY nature_group, EXTRACT(YEAR FROM deal_date)`,
      // רבעונים — לגרף המגמה ולדופק השוק
      this.db.$executeRaw`
        INSERT INTO market_segment_stats
          (settlement_id, nature_group, room_bucket, year, quarter, deals, new_build_deals,
           median_price, p25_price, p75_price, median_ppsqm, p25_ppsqm, p75_ppsqm, median_area)
        SELECT ${settlementId}, nature_group, 0, EXTRACT(YEAR FROM deal_date)::smallint,
               EXTRACT(QUARTER FROM deal_date)::smallint,
               count(*), count(*) FILTER (WHERE (flags & ${MARKET_FLAGS.newBuild}) <> 0),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY area_sqm) FILTER (WHERE area_sqm IS NOT NULL))::int
        FROM market_deals
        WHERE (${all}::boolean OR settlement_id = ${settlementId}) AND (flags & ${EXCLUDED_FLAGS}) = 0
        GROUP BY nature_group, EXTRACT(YEAR FROM deal_date), EXTRACT(QUARTER FROM deal_date)`,
      // לפי חדרים — לדירות בלבד; לקרקע ולמסחר אין חדרים
      this.db.$executeRaw`
        INSERT INTO market_segment_stats
          (settlement_id, nature_group, room_bucket, year, quarter, deals, new_build_deals,
           median_price, p25_price, p75_price, median_ppsqm, p25_ppsqm, p75_ppsqm, median_area)
        SELECT ${settlementId}, nature_group, rb, y, 0,
               count(*), count(*) FILTER (WHERE (flags & ${MARKET_FLAGS.newBuild}) <> 0),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.25) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               percentile_cont(0.75) WITHIN GROUP (ORDER BY amount_ils)::bigint,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.25) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.75) WITHIN GROUP (ORDER BY ppsqm) FILTER (WHERE ppsqm IS NOT NULL))::int,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY area_sqm) FILTER (WHERE area_sqm IS NOT NULL))::int
        FROM (
          SELECT nature_group, amount_ils, ppsqm, area_sqm, flags,
                 EXTRACT(YEAR FROM deal_date)::smallint AS y,
                 (CASE WHEN rooms < 2.5 THEN 2 WHEN rooms < 3.5 THEN 3 WHEN rooms < 4.5 THEN 4
                       WHEN rooms < 5.5 THEN 5 ELSE 6 END)::smallint AS rb
          FROM market_deals
          WHERE (${all}::boolean OR settlement_id = ${settlementId}) AND (flags & ${EXCLUDED_FLAGS}) = 0
            AND rooms IS NOT NULL AND rooms > 0 AND nature_group = ANY(${dwellings}::int[])
        ) d
        GROUP BY nature_group, rb, y`,
    ];
    await this.db.$transaction(statements);
  }

  /* ============================================================
     חלקות — מיקום ואזור סטטיסטי
     ============================================================ */

  /**
   * העשרת חלקות שיש בהן עסקאות ועוד אין להן שורה — מהחדשות לישנות.
   *
   * הדרגתי במכוון: 380 אלף חלקות הן כשבוע של בקשות בקצב מנומס. סדר
   * לפי העסקה האחרונה בחלקה, כי שם יושבות ההשוואות שמתווכים פותחים
   * היום; חלקה שנמכרה בה דירה אחרונה ב-2004 יכולה לחכות.
   */
  async enrichParcels(limit: number): Promise<number> {
    const pending = await this.db.$queryRaw<{ gush: number; helka: number; settlement_id: number | null }[]>`
      SELECT d.gush, d.helka, max(d.settlement_id) AS settlement_id
      FROM market_deals d
      LEFT JOIN market_parcels p ON p.gush = d.gush AND p.helka = d.helka
      WHERE p.gush IS NULL AND d.deal_date >= now() - interval '6 years'
      GROUP BY d.gush, d.helka
      ORDER BY max(d.deal_date) DESC
      LIMIT ${limit}`;
    let done = 0;
    for (const row of pending) {
      if (!this.hasTime()) break;
      const parcel = await this.call(() => this.source.parcel(row.gush, row.helka));
      await this.db.marketParcel.upsert({
        where: { gush_helka: { gush: row.gush, helka: row.helka } },
        create: {
          gush: row.gush,
          helka: row.helka,
          settlementId: row.settlement_id,
          statArea: parcel?.statArea ?? null,
          socioEshkol: parcel?.socioEshkol ?? null,
          lat: parcel?.lat ?? null,
          lon: parcel?.lon ?? null,
          street: parcel?.street ?? null,
          status: parcel ? "ok" : "missing",
        },
        update: {},
      });
      done += 1;
    }
    return done;
  }

  get requests(): number {
    return "requests" in this.source && typeof this.source.requests === "number" ? this.source.requests : 0;
  }

  /** המקור — לקריאות שאינן עסקאות (קישור נכס לחלקה), דרך `call` ובאותו קצב. */
  get dataSource(): MarketSource {
    return this.source;
  }
}
