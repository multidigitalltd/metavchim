import { z } from "zod";
import {
  MARKET_NATURE_GROUPS,
  MARKET_ROOM_BUCKETS,
  type BudgetFitKind,
  type MarketCompScope,
  type MarketEstimate,
  type MarketFlag,
  type MarketNatureGroup,
  type MarketPosition,
  type MarketRoomBucket,
} from "../logic/market.js";

/**
 * ‎**חוזי נתוני השוק — מה שה-API מחזיר ומה שהמסכים קוראים** (docs/14).
 *
 * מקום אחד לשני הצדדים: `verify:shapes` משווה את טיפוס ההחזרה של
 * הבקר לטיפוס שהמסך מצהיר עליו, ושניהם מצביעים לכאן.
 */

/* ============================================================
   קלט
   ============================================================ */

export const MarketNatureGroupSchema = z.enum(MARKET_NATURE_GROUPS);

export const MarketRoomBucketSchema = z.coerce
  .number()
  .int()
  .refine((n): n is MarketRoomBucket => (MARKET_ROOM_BUCKETS as readonly number[]).includes(n), {
    message: "דלי חדרים לא מוכר",
  });

/**
 * גוש/חלקה/תת-חלקה מנסח הטאבו. `null` מנתק את הנכס מהחלקה, והסבב
 * יגזור אותה שוב מהמיקום.
 */
export const PropertyParcelSchema = z
  .object({
    gush: z.number().int().min(1).max(999_999),
    helka: z.number().int().min(1).max(99_999),
    subParcel: z.number().int().min(0).max(99_999).nullable().optional(),
  })
  .strict()
  .nullable();
export type PropertyParcelInput = z.infer<typeof PropertyParcelSchema>;

export const MarketScopeQuerySchema = z
  .object({
    settlementId: z.coerce.number().int().min(1).optional(),
    group: MarketNatureGroupSchema.default("apartment"),
    rooms: MarketRoomBucketSchema.default(0),
  })
  .strict();
export type MarketScopeQuery = z.infer<typeof MarketScopeQuerySchema>;

/** תאריך קלנדרי אמיתי — „2026-02-31” היה עובר את הביטוי ונופל ב-Postgres כ-500. */
const isRealDate = (date: string): boolean => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "תאריך בפורמט YYYY-MM-DD")
  .refine(isRealDate, "תאריך לא קיים");

export const MarketDealsQuerySchema = z
  .object({
    settlementId: z.coerce.number().int().min(1).optional(),
    group: MarketNatureGroupSchema.optional(),
    rooms: MarketRoomBucketSchema.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    gush: z.coerce.number().int().min(1).optional(),
    /** ‎`תאריך|מזהה` של השורה האחרונה בעמוד הקודם. */
    cursor: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}\|-?\d{1,19}$/u)
      // תאריך אמיתי ומזהה בטווח BIGINT — אחרת Postgres נכשל, והבקשה חוזרת כ-500
      .refine((value) => {
        const [date = "", id = ""] = value.split("|");
        if (!isRealDate(date)) return false;
        const big = BigInt(id);
        return big >= -(2n ** 63n) && big < 2n ** 63n;
      }, "סמן לא תקין")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MarketDealsQuery = z.infer<typeof MarketDealsQuerySchema>;

/* ============================================================
   פלט
   ============================================================ */

export interface MarketDealDto {
  /** מזהה העסקה (BIGINT כמחרוזת). */
  id: string;
  date: string;
  amountIls: number;
  /** הסוג כפי שרשות המסים פרסמה. */
  nature: string;
  group: MarketNatureGroup;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  portion: number | null;
  ppsqm: number | null;
  gush: number;
  helka: number;
  subParcel: number | null;
  settlement: string | null;
  flags: MarketFlag[];
}

export interface MarketFreshnessDto {
  /** העסקה האחרונה שנקלטה ליישוב. */
  syncedThrough: string | null;
  /** pending | backfill | ok | error */
  status: string;
  /** כמה מהעסקאות שהמקור מדווח כבר במאגר, באחוזים. */
  coveragePct: number | null;
}

export interface MarketComparisonDto {
  scope: MarketCompScope | null;
  months: number | null;
  sampleSize: number;
  insufficient: boolean;
  comps: MarketDealDto[];
  estimate: MarketEstimate | null;
  matchedOn: { rooms: boolean; area: boolean };
}

export interface PropertyMarketDto {
  parcel: { gush: number; helka: number; subParcel: number | null; source: string | null } | null;
  settlement: { id: number; name: string } | null;
  freshness: MarketFreshnessDto | null;
  /** היסטוריית הדירה עצמה — אותה תת-חלקה. ריק כשאין תת-חלקה. */
  apartment: MarketDealDto[];
  building: { deals: MarketDealDto[]; total: number };
  comparison: MarketComparisonDto | null;
  position: MarketPosition | null;
  positionSentence: string | null;
  /** עסקאות מיסוי הן מכירות; לנכס להשכרה אין השוואת מחיר. */
  comparable: boolean;
  attribution: string;
}

export interface MarketSettlementDto {
  id: number;
  name: string;
  /** עסקאות במקור. */
  deals: number;
  status: string;
}

export interface MarketYearRowDto {
  year: number;
  deals: number;
  newBuildDeals: number;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  medianPpsqm: number | null;
  medianArea: number | null;
  /** השנה עוד לא הסתיימה, או שהדיווחים עליה עוד מגיעים. */
  partial: boolean;
}

export interface MarketQuarterRowDto {
  year: number;
  quarter: number;
  deals: number;
  medianPrice: number | null;
  medianPpsqm: number | null;
  partial: boolean;
}

export interface MarketBreakdownRowDto {
  key: string;
  label: string;
  deals: number;
  medianPrice: number | null;
  medianPpsqm: number | null;
}

export interface MarketMoverDto {
  settlementId: number;
  name: string;
  deals: number;
  medianPpsqm: number | null;
  changePct: number | null;
}

export interface MarketOverviewDto {
  scope: {
    settlementId: number | null;
    settlement: string | null;
    group: MarketNatureGroup;
    rooms: MarketRoomBucket;
  };
  /** מצב המאגר כולו — כמה נקלט מתוך מה שהמקור מדווח. */
  database: {
    deals: number;
    sourceDeals: number;
    settlements: number;
    settlementsSynced: number;
    lastDeal: string | null;
  };
  /** השנה המלאה האחרונה מול זו שלפניה. */
  headline: {
    year: number | null;
    deals: number | null;
    medianPrice: number | null;
    medianPpsqm: number | null;
    dealsChangePct: number | null;
    ppsqmChangePct: number | null;
    newBuildSharePct: number | null;
  };
  yearly: MarketYearRowDto[];
  quarterly: MarketQuarterRowDto[];
  rooms: MarketBreakdownRowDto[];
  groups: MarketBreakdownRowDto[];
  /** בכל הארץ בלבד: הערים הפעילות והמשתנות ביותר. */
  topSettlements: MarketMoverDto[];
  movers: MarketMoverDto[];
  attribution: string;
}

export interface MarketDealsPageDto {
  items: MarketDealDto[];
  nextCursor: string | null;
}

export interface MarketParcelDto {
  gush: number;
  helka: number;
  street: string | null;
  statArea: number | null;
  socioEshkol: number | null;
  lat: number | null;
  lon: number | null;
  deals: MarketDealDto[];
  total: number;
}

export interface MarketBuildingDto {
  gush: number;
  helka: number;
  street: string | null;
  deals: number;
  lastDeal: string;
  medianPpsqm: number | null;
}

export interface MarketProspectingDto {
  settlement: { id: number; name: string } | null;
  /** בניינים עם הכי הרבה עסקאות דירה ב-24 החודשים האחרונים. */
  turnover: MarketBuildingDto[];
  /** חלקות עם מכירות מקבלן (שנת בנייה אחרי שנת העסקה) — פרויקטים חדשים. */
  projects: MarketBuildingDto[];
}

export interface MarketMapPointDto {
  lat: number;
  lon: number;
  gush: number;
  helka: number;
  deals: number;
  medianPpsqm: number | null;
  lastDeal: string;
}

export interface MarketMapDto {
  points: MarketMapPointDto[];
  /** כמה מהחלקות ביישוב כבר מוקמו — המפה מתמלאת בהדרגה. */
  locatedPct: number | null;
}

export interface BuyerMarketFitDto {
  settlement: string;
  rooms: MarketRoomBucket;
  kind: BudgetFitKind;
  median: number;
  deals: number;
}

export interface BuyerMarketDto {
  budgetIls: number | null;
  rooms: MarketRoomBucket;
  year: number | null;
  fits: BuyerMarketFitDto[];
  /** ערים שהקונה מחפש בהן ואין להן נתונים במאגר (עדיין). */
  unknownCities: string[];
  attribution: string;
}

export interface MarketSyncRunDto {
  id: string;
  kind: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  requests: number;
  rows: number;
  message: string | null;
}

export interface MarketPlatformStatusDto {
  enabled: boolean;
  /** הגדרה מפורשת במסך, או ברירת המחדל לפי הסביבה. */
  enabledSource: "setting" | "default";
  intervalMs: number;
  running: boolean;
  source: string;
  settlements: { total: number; ok: number; backfill: number; pending: number; error: number };
  deals: { local: number; source: number; coveragePct: number | null; lastDeal: string | null };
  parcels: { total: number; located: number };
  properties: { linked: number; pending: number };
  storageBytes: number;
  runs: MarketSyncRunDto[];
  errors: { name: string; error: string | null; syncedAt: string | null }[];
}

export interface MarketPublicEstimateDto {
  settlement: string | null;
  sampleSize: number;
  scope: MarketCompScope | null;
  estimate: MarketEstimate | null;
  /** אמת = נוצר ליד במשרד. */
  leadCreated: boolean;
  attribution: string;
}
