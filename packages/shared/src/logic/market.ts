/**
 * נתוני שוק — **עסקאות אמת מרשות המסים, והכללים שהופכים אותן למספר
 * שמתווך יכול להגן עליו מול בעלים** (docs/18).
 *
 * ## למה הכללים כאן ולא בשאילתה
 *
 * אותה הערכה מוצגת בכרטיס הנכס, בדו"ח לבעלים, בטופס הציבורי של
 * המשרד ובתשובה של הסוכן הקולי. ארבעה עותקים של „מה נחשב עסקה
 * דומה” היו מתפצלים תוך חודש, והבעלים היה מקבל בדו"ח מספר אחר
 * ממה שהמתווך ראה בכרטיס רגע לפני. כאן יושבת האמת היחידה; ה-SQL
 * רק מביא מועמדים.
 *
 * ## הנתונים מלוכלכים, וזה לא תקלה שלנו לתקן אלא עובדה לנהל
 *
 * הסכום הוא מה שדווח למס, לא מחיר שוק מאומת. שורה אחת יכולה להיות
 * דירה, חצי דירה או בניין שלם; „מגורים” ברוב המקרים אינו דירה כלל;
 * ועסקה מקבלן על הנייר אינה מחיר יד שנייה. לכן: **חציון ולא ממוצע,
 * N מינימלי ולא מספר מכל דבר, ודגלים ולא מחיקה** — עסקה חריגה נשארת
 * בהיסטוריה של הבניין, היא רק לא נכנסת לסטטיסטיקה.
 */

import type { PropertyType } from "../schemas/property.js";
import { formatIsraeliNumber } from "./israel-time.js";

/* ============================================================
   1 · סוגי נכס — 47 הסוגים של המקור, שמונה קבוצות שלנו
   ============================================================ */

export const MARKET_NATURE_GROUPS = [
  "apartment",
  "garden",
  "penthouse",
  "house",
  "residential_other",
  "commercial",
  "land",
  "other",
] as const;

export type MarketNatureGroup = (typeof MARKET_NATURE_GROUPS)[number];

export const MARKET_NATURE_GROUP_LABELS: Record<MarketNatureGroup, string> = {
  apartment: "דירה",
  garden: "דירת גן",
  penthouse: "דירת גג / פנטהאוז",
  house: "בית פרטי / קוטג'",
  residential_other: "מגורים — לא מסווג",
  commercial: "מסחרי / משרדים",
  land: "קרקע",
  other: "אחר",
};

/**
 * הקבוצות שהן **דירת מגורים שאפשר להשוות אליה**.
 *
 * ‎`residential_other` אינה כאן במכוון. אצל המקור עצמו: ב-99% מעסקאות
 * „מגורים” אין מספר חדרים וב-68% אין שטח — הן עסקאות בקרקע או
 * בזכויות. הכנסתן להשוואה הייתה מורידה את החציון של עיר שלמה.
 */
export const MARKET_DWELLING_GROUPS: readonly MarketNatureGroup[] = [
  "apartment",
  "garden",
  "penthouse",
  "house",
];

export function isDwellingGroup(group: MarketNatureGroup): boolean {
  return MARKET_DWELLING_GROUPS.includes(group);
}

/*
 * הסדר חשוב: „דירת גן” מכילה „דירה”, ו„קוטג' דו משפחתי” מכיל
 * „משפחתי”. הכלל הספציפי נבדק ראשון.
 */
const NATURE_RULES: readonly [RegExp, MarketNatureGroup][] = [
  [/דירת\s*גן/u, "garden"],
  [/גג|פנטהאוז|פנטהאוס|פנטאוז/u, "penthouse"],
  [/קוטג|בית\s*בודד|משפחתי|וילה|בית\s*פרטי|טורי/u, "house"],
  [/^דירה|דופלקס|טריפלקס|דירת\s*נופש|דירה\s*בבית/u, "apartment"],
  [/^(ד\.\s*)?מגורים$/u, "residential_other"],
  [/משרד|חנות|מסחר|תעשי|מחסנ|חני|מלונ|אולם|מבנה\s*ציבור|מרפאה/u, "commercial"],
  [/קרקע|מעובדת|ללא\s*תיכנון|ללא\s*תכנון|חקלא|מגרש|פרדס|בור/u, "land"],
];

/** קבוצת הסוג ממחרוזת הסוג של רשות המסים. סוג לא מוכר → `other`, לעולם לא ניחוש. */
export function marketNatureGroup(sourceNature: string | null | undefined): MarketNatureGroup {
  const name = (sourceNature ?? "").trim();
  if (name === "") return "other";
  for (const [pattern, group] of NATURE_RULES) {
    if (pattern.test(name)) return group;
  }
  return "other";
}

/**
 * סוג הנכס במערכת → קבוצת הסוג במאגר.
 *
 * ערכי `propertyType` הם `PropertyTypeSchema`. סוג שאין לו מקבילה
 * במאגר (מגרש, מסחרי) מוחזר כקבוצה שלו, וההשוואה פשוט לא תמצא דירות
 * דומות — עדיף מהשוואה לדירות.
 *
 * ‎`satisfies` ולא `Record<string, …>`: סוג נכס שיתווסף ל-enum מחר
 * יפיל את הקומפילציה כאן, במקום ליפול בשקט ל„דירה”.
 */
const PROPERTY_TYPE_GROUP = {
  apartment: "apartment",
  garden_apartment: "garden",
  penthouse: "penthouse",
  duplex: "apartment",
  private_house: "house",
  two_family: "house",
  studio: "apartment",
  unit: "apartment",
  shared_tabu: "apartment",
  divisible_apartment: "apartment",
  accessible_apartment: "apartment",
  plot: "land",
  commercial: "commercial",
  commercial_shop: "commercial",
  commercial_office: "commercial",
  commercial_warehouse: "commercial",
  commercial_industrial: "commercial",
  commercial_basement: "commercial",
  commercial_building: "commercial",
  commercial_logistics: "commercial",
  commercial_parking: "commercial",
  commercial_gas_station: "commercial",
  other: "other",
} as const satisfies Record<PropertyType, MarketNatureGroup>;

export function propertyTypeToNatureGroup(propertyType: PropertyType | null | undefined): MarketNatureGroup {
  return propertyType ? PROPERTY_TYPE_GROUP[propertyType] : "apartment";
}

/* ============================================================
   2 · דגלים — מה חריג בעסקה, בלי למחוק אותה
   ============================================================ */

export const MARKET_FLAGS = {
  /** נמכר חלק מהנכס (portion < 1) — אינו מחיר של דירה שלמה. */
  partial: 1,
  /** שנת הבנייה אחרי שנת העסקה — מכירה מקבלן, „על הנייר”. */
  newBuild: 2,
  /** אין שטח — אי אפשר לחשב מחיר למ"ר. */
  noArea: 4,
  /** אין מספר חדרים. */
  noRooms: 8,
  /** סכום נמוך מכדי להיות דירה (העברה בין קרובים, זכויות). */
  tinyAmount: 16,
  /** מחוץ לגדר החריגים של המחיר למ"ר בסגמנט (`marketOutlierFence`) — נקבע בבניית הסטטיסטיקה. */
  outlier: 32,
} as const;

export type MarketFlag = keyof typeof MARKET_FLAGS;

/** סכום שמתחתיו „דירה” אינה דירה. נמוך במכוון — עדיף לשמור חריג מאשר לזרוק אמת. */
export const MARKET_TINY_AMOUNT_ILS = 60_000;

export interface MarketDealFacts {
  /** ‎`YYYY-MM-DD`. */
  date: string;
  amountIls: number;
  group: MarketNatureGroup;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  /** החלק שנמכר, 0–1. `null` = לא דווח, ומתפרש כנכס שלם. */
  portion: number | null;
}

export function marketDealFlags(deal: MarketDealFacts): number {
  let flags = 0;
  if (deal.portion !== null && deal.portion < 0.999) flags |= MARKET_FLAGS.partial;
  const dealYear = Number(deal.date.slice(0, 4));
  if (deal.yearBuilt !== null && Number.isFinite(dealYear) && deal.yearBuilt > dealYear) {
    flags |= MARKET_FLAGS.newBuild;
  }
  if (deal.areaSqm === null || deal.areaSqm <= 0) flags |= MARKET_FLAGS.noArea;
  if (deal.rooms === null || deal.rooms <= 0) flags |= MARKET_FLAGS.noRooms;
  if (isDwellingGroup(deal.group) && deal.amountIls < MARKET_TINY_AMOUNT_ILS) {
    flags |= MARKET_FLAGS.tinyAmount;
  }
  return flags;
}

export function hasMarketFlag(flags: number, flag: MarketFlag): boolean {
  return (flags & MARKET_FLAGS[flag]) !== 0;
}

/** הדגלים כשמות — מה שיוצא ב-API, כדי שהמסך לא יכיר ביטים. */
export function marketFlagNames(flags: number): MarketFlag[] {
  return (Object.keys(MARKET_FLAGS) as MarketFlag[]).filter((flag) => hasMarketFlag(flags, flag));
}

export const MARKET_FLAG_LABELS: Record<MarketFlag, string> = {
  partial: "חלק מהנכס",
  newBuild: "מקבלן",
  noArea: "ללא שטח",
  noRooms: "ללא חדרים",
  tinyAmount: "סכום חריג",
  outlier: "מחיר חריג",
};

/**
 * דגלים שפוסלים עסקה מסטטיסטיקה של מחיר.
 *
 * ‎`newBuild` אינו כאן: מחיר מקבלן הוא מחיר אמיתי, והוא נספר בסגמנט
 * נפרד (ראו `excludeNewBuild` ב-`selectComparables`). `noRooms` גם
 * אינו כאן — עסקה בלי חדרים עדיין נכנסת לחציון של היישוב.
 */
const STATS_EXCLUDING =
  MARKET_FLAGS.partial | MARKET_FLAGS.tinyAmount | MARKET_FLAGS.outlier;

export function countsForStats(flags: number): boolean {
  return (flags & STATS_EXCLUDING) === 0;
}

/**
 * מחיר למ"ר — על החלק שנמכר בלבד.
 *
 * השטח במקור הוא שטח הנכס כולו, והסכום שולם על החלק שנמכר. בלי
 * הנרמול, רבע דירה ב-500 אלף נראה כמו דירה שלמה ב-5,000 ₪ למ"ר.
 */
export function pricePerSqm(amountIls: number, areaSqm: number | null, portion: number | null): number | null {
  if (areaSqm === null || areaSqm <= 0) return null;
  const share = portion === null || portion <= 0 ? 1 : Math.min(portion, 1);
  const value = amountIls / (areaSqm * share);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/* ============================================================
   3 · חדרים — דליים קבועים לסטטיסטיקה
   ============================================================ */

/** ‎`0` = כל הדליים. הערכים עצמם הם מה שמוצג: „3 חדרים”, „6+”. */
export const MARKET_ROOM_BUCKETS = [0, 2, 3, 4, 5, 6] as const;
export type MarketRoomBucket = (typeof MARKET_ROOM_BUCKETS)[number];

export function marketRoomBucket(rooms: number | null | undefined): MarketRoomBucket {
  if (rooms === null || rooms === undefined || !(rooms > 0)) return 0;
  if (rooms < 2.5) return 2;
  if (rooms < 3.5) return 3;
  if (rooms < 4.5) return 4;
  if (rooms < 5.5) return 5;
  return 6;
}

export function marketRoomBucketLabel(bucket: MarketRoomBucket): string {
  switch (bucket) {
    case 0:
      return "כל הגדלים";
    case 2:
      return "עד 2 חדרים";
    case 6:
      return "6 חדרים ומעלה";
    default:
      return `${bucket} חדרים`;
  }
}

/* ============================================================
   4 · סטטיסטיקה — חציון ורבעונים, לעולם לא ממוצע
   ============================================================ */

/** מינימום עסקאות להצגת מספר. פחות מזה — „אין מספיק עסקאות”, ולא הערכה. */
export const MARKET_MIN_SAMPLE = 5;

/** מתחת לכך אין טעם לחפש חריגים: רבעונים של שמונה מספרים אינם יציבים. */
export const MARKET_OUTLIER_MIN_SAMPLE = 20;

/** רוחב הגדר, בכפולות של הטווח הבין-רבעוני — „חריג רחוק” של Tukey. */
export const MARKET_OUTLIER_FENCE_IQR = 3;

/** אחוזון בשיטת האינטרפולציה הלינארית — זהה ל-`percentile_cont` של Postgres. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * weight;
}

/**
 * גדר החריגים: [P25 − 3·IQR, P75 + 3·IQR].
 *
 * ‎**לא חיתוך של P5/P95**, וזה תוקן אחרי שבדיקה מול מסד אמיתי תפסה
 * אותו: חיתוך אחוזונים מסמן **תמיד** את שתי העסקאות הקיצוניות בכל
 * מדגם של 20, גם כשהן רגילות לגמרי — והמתווך היה רואה „מחיר חריג”
 * על דירה שנמכרה במחיר השוק. הגדר מסמנת רק מה שרחוק באמת מהגוף
 * (הקלדה של אפס מיותר, עסקה בין קרובים), ואותה גדר בדיוק משמשת את
 * ה-SQL בבניית הסטטיסטיקה ואת ההערכה כאן.
 */
export function marketOutlierFence(sorted: readonly number[]): { lo: number; hi: number } | null {
  if (sorted.length < MARKET_OUTLIER_MIN_SAMPLE) return null;
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  const iqr = p75 - p25;
  return { lo: p25 - MARKET_OUTLIER_FENCE_IQR * iqr, hi: p75 + MARKET_OUTLIER_FENCE_IQR * iqr };
}

export interface MarketSpread {
  n: number;
  median: number;
  p25: number;
  p75: number;
}

/** חציון ורבעונים, בלי חריגים רחוקים כשיש מספיק נתונים. `null` = פחות מהמינימום. */
export function marketSpread(values: readonly number[], minSample = MARKET_MIN_SAMPLE): MarketSpread | null {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const fence = marketOutlierFence(clean);
  const trimmed = fence ? clean.filter((v) => v >= fence.lo && v <= fence.hi) : clean;
  if (trimmed.length < minSample) return null;
  return {
    n: trimmed.length,
    median: Math.round(quantile(trimmed, 0.5)),
    p25: Math.round(quantile(trimmed, 0.25)),
    p75: Math.round(quantile(trimmed, 0.75)),
  };
}

/** שינוי באחוזים, מעוגל. `null` כשאין בסיס להשוואה. */
export function percentChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  if (!(from > 0) || !Number.isFinite(to)) return null;
  return Math.round(((to - from) / from) * 100);
}

/* ============================================================
   5 · עסקאות דומות — סולם הרחבה
   ============================================================ */

export interface MarketComparable {
  id: string;
  date: string;
  amountIls: number;
  group: MarketNatureGroup;
  areaSqm: number | null;
  rooms: number | null;
  floor?: number | null;
  yearBuilt: number | null;
  gush: number;
  helka: number;
  subParcel: number | null;
  statArea: number | null;
  ppsqm: number | null;
  flags: number;
}

export interface MarketSubject {
  group: MarketNatureGroup;
  rooms: number | null;
  areaSqm: number | null;
  gush: number | null;
  helka: number | null;
  statArea: number | null;
}

export type MarketCompScope = "building" | "block" | "stat_area" | "settlement";

export const MARKET_COMP_SCOPE_LABELS: Record<MarketCompScope, string> = {
  building: "באותו בניין",
  block: "באותו גוש",
  stat_area: "באותו אזור סטטיסטי",
  settlement: "ביישוב",
};

interface CompTier {
  scope: MarketCompScope;
  months: number;
}

/**
 * הסולם: **הכי קרוב שיש בו מספיק**, ולא הכי קרוב בכל מחיר.
 *
 * הבניין עצמו הוא ההשוואה הטובה ביותר שיש, ולכן הוא מקבל את החלון
 * הארוך ביותר — שלוש שנים באותו בניין עדיפות על שנה ביישוב. הגוש הוא
 * יחידה מרחבית אמיתית (רחוב או שניים), ומשמש קירוב לשכונה בלי שום
 * בקשה חיצונית. היישוב הוא המוצא האחרון, וזה מה שהמסך יאמר.
 */
const COMP_TIERS: readonly CompTier[] = [
  { scope: "building", months: 36 },
  { scope: "block", months: 24 },
  { scope: "stat_area", months: 24 },
  { scope: "settlement", months: 12 },
  { scope: "settlement", months: 24 },
];

/** החלון הארוך ביותר בסולם — כמה עסקאות לשלוף מראש. */
export const MARKET_COMP_LOOKBACK_MONTHS = 36;

/** כמה עסקאות להציג למתווך מתוך מה שנמצא — הקרובות ביותר בזמן. */
export const MARKET_COMPS_SHOWN = 12;

function monthsBefore(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

function inScope(subject: MarketSubject, deal: MarketComparable, scope: MarketCompScope): boolean {
  switch (scope) {
    case "building":
      return subject.gush !== null && subject.helka !== null && deal.gush === subject.gush && deal.helka === subject.helka;
    case "block":
      return subject.gush !== null && deal.gush === subject.gush;
    case "stat_area":
      return subject.statArea !== null && deal.statArea === subject.statArea;
    case "settlement":
      return true;
  }
}

/**
 * דמיון בגודל: ±חצי חדר ו-±25% שטח, **כשהשדה ידוע בשני הצדדים**.
 *
 * שדה חסר אינו פוסל. נכס שהמתווך עוד לא מילא לו שטח עדיין מקבל
 * השוואה לפי חדרים, והמסך אומר לפי מה הושווה.
 */
function similarSize(subject: MarketSubject, deal: MarketComparable): boolean {
  if (subject.rooms !== null && deal.rooms !== null && Math.abs(subject.rooms - deal.rooms) > 0.5) {
    return false;
  }
  if (subject.areaSqm !== null && subject.areaSqm > 0 && deal.areaSqm !== null && deal.areaSqm > 0) {
    const ratio = deal.areaSqm / subject.areaSqm;
    if (ratio < 0.75 || ratio > 1.25) return false;
  }
  return true;
}

export interface MarketEstimate {
  /** ההערכה המרכזית בשקלים — מעוגלת לעשרת אלפים. */
  mid: number;
  low: number;
  high: number;
  /** ‎`ppsqm` = לפי מחיר למ"ר × שטח הנכס. `price` = חציון המחירים עצמם. */
  basis: "ppsqm" | "price";
  /** חציון המחיר למ"ר שעליו נשענת ההערכה, כשיש. */
  medianPpsqm: number | null;
}

export interface MarketComparison {
  scope: MarketCompScope | null;
  months: number | null;
  /** כל העסקאות שנמצאו בדרגה שנבחרה (לפני הקיצוץ לתצוגה). */
  sampleSize: number;
  /** אמת = אפילו הדרגה הרחבה ביותר לא הגיעה למינימום. */
  insufficient: boolean;
  comps: MarketComparable[];
  estimate: MarketEstimate | null;
  /** לפי מה הושווה — לשורת ההסבר במסך. */
  matchedOn: { rooms: boolean; area: boolean };
}

const roundTo = (value: number, step: number): number => Math.round(value / step) * step;

export function estimateFromComps(subject: MarketSubject, comps: readonly MarketComparable[]): MarketEstimate | null {
  const usable = comps.filter((c) => countsForStats(c.flags));
  if (subject.areaSqm !== null && subject.areaSqm > 0) {
    const ppsqm = marketSpread(usable.map((c) => c.ppsqm ?? Number.NaN));
    if (ppsqm) {
      return {
        mid: roundTo(ppsqm.median * subject.areaSqm, 10_000),
        low: roundTo(ppsqm.p25 * subject.areaSqm, 10_000),
        high: roundTo(ppsqm.p75 * subject.areaSqm, 10_000),
        basis: "ppsqm",
        medianPpsqm: ppsqm.median,
      };
    }
  }
  const prices = marketSpread(usable.map((c) => c.amountIls));
  if (!prices) return null;
  return {
    mid: roundTo(prices.median, 10_000),
    low: roundTo(prices.p25, 10_000),
    high: roundTo(prices.p75, 10_000),
    basis: "price",
    medianPpsqm: null,
  };
}

/**
 * עסקאות דומות לנכס, מתוך מועמדים שכבר נשלפו לפי יישוב.
 *
 * המועמדים מגיעים מהמסד (יישוב, 36 חודשים אחרונים, אותה קבוצת סוג);
 * כאן נבחרת הדרגה, נבדק הדמיון ומחושבת ההערכה. טהור, ולכן נבדק
 * בלי מסד — וזהה בכל מקום שבו מוצג.
 */
export function selectComparables(
  subject: MarketSubject,
  candidates: readonly MarketComparable[],
  now: Date,
  options: { excludeNewBuild?: boolean } = {},
): MarketComparison {
  const pool = candidates.filter(
    (deal) =>
      deal.group === subject.group &&
      countsForStats(deal.flags) &&
      (!options.excludeNewBuild || !hasMarketFlag(deal.flags, "newBuild")) &&
      similarSize(subject, deal),
  );
  const matchedOn = {
    rooms: subject.rooms !== null,
    area: subject.areaSqm !== null && subject.areaSqm > 0,
  };

  let best: { tier: CompTier; deals: MarketComparable[] } | null = null;
  for (const tier of COMP_TIERS) {
    const since = monthsBefore(now, tier.months);
    const deals = pool.filter((deal) => deal.date >= since && inScope(subject, deal, tier.scope));
    if (deals.length >= MARKET_MIN_SAMPLE) {
      best = { tier, deals };
      break;
    }
    // שומרים את הדרגה הכי עשירה שנמצאה, למקרה שאף אחת לא תגיע לסף
    if (!best || deals.length > best.deals.length) best = { tier, deals };
  }

  const chosen = best?.deals ?? [];
  const sorted = [...chosen].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const insufficient = chosen.length < MARKET_MIN_SAMPLE;
  return {
    scope: best && chosen.length > 0 ? best.tier.scope : null,
    months: best && chosen.length > 0 ? best.tier.months : null,
    sampleSize: chosen.length,
    insufficient,
    comps: sorted.slice(0, MARKET_COMPS_SHOWN),
    estimate: insufficient ? null : estimateFromComps(subject, chosen),
    matchedOn,
  };
}

/* ============================================================
   6 · מחיר מבוקש מול השוק
   ============================================================ */

export type MarketPositionKind = "below" | "within" | "above";

export interface MarketPosition {
  kind: MarketPositionKind;
  /** פער מההערכה המרכזית, באחוזים. חיובי = מעל. */
  diffPct: number;
  /** מתחת לרבעון התחתון — „הזדמנות” בהתאמות. */
  opportunity: boolean;
}

/** המחיר המבוקש מול טווח ההערכה. `null` כשאין מחיר או אין הערכה. */
export function marketPosition(askingIls: number | null | undefined, estimate: MarketEstimate | null): MarketPosition | null {
  if (!estimate || askingIls === null || askingIls === undefined || !(askingIls > 0) || !(estimate.mid > 0)) {
    return null;
  }
  const diffPct = Math.round(((askingIls - estimate.mid) / estimate.mid) * 100);
  const kind: MarketPositionKind =
    askingIls < estimate.low ? "below" : askingIls > estimate.high ? "above" : "within";
  return { kind, diffPct, opportunity: kind === "below" };
}

/** משפט אחד, בגוף שלישי ובלי שיפוט — המתווך מחליט מה לעשות איתו. */
export function marketPositionSentence(position: MarketPosition, sampleSize: number): string {
  const base = `${sampleSize} עסקאות דומות`;
  if (position.kind === "within") {
    return `המחיר המבוקש בתוך הטווח של ${base} (${signed(position.diffPct)} מהחציון).`;
  }
  const direction = position.kind === "above" ? "מעל" : "מתחת ל";
  return `המחיר המבוקש ${direction}טווח של ${base} — ${signed(position.diffPct)} מהחציון.`;
}

const signed = (pct: number): string => (pct > 0 ? `+${pct}%` : `${pct}%`);

/* ============================================================
   7 · תקציב הקונה מול השוק
   ============================================================ */

export interface MarketCityPrices {
  settlement: string;
  rooms: MarketRoomBucket;
  /** עסקאות בשנה האחרונה בסגמנט. */
  deals: number;
  p25: number;
  median: number;
  p75: number;
}

export type BudgetFitKind = "comfortable" | "tight" | "below";

export interface BudgetFit {
  settlement: string;
  rooms: MarketRoomBucket;
  kind: BudgetFitKind;
  median: number;
  deals: number;
}

/**
 * האם התקציב מגיע לשוק — **בכל עיר בנפרד**.
 *
 * ‎`comfortable` = מעל החציון; `tight` = בין הרבעון התחתון לחציון,
 * כלומר יש עסקאות כאלה אבל לא רוב; `below` = מתחת לרבעון התחתון —
 * שלושה מכל ארבעה קונים בעיר הזו שילמו יותר.
 */
export function budgetFit(budgetIls: number | null | undefined, prices: readonly MarketCityPrices[]): BudgetFit[] {
  if (budgetIls === null || budgetIls === undefined || !(budgetIls > 0)) return [];
  return prices
    .filter((p) => p.deals >= MARKET_MIN_SAMPLE)
    .map((p) => ({
      settlement: p.settlement,
      rooms: p.rooms,
      kind: budgetIls >= p.median ? "comfortable" : budgetIls >= p.p25 ? "tight" : "below",
      median: p.median,
      deals: p.deals,
    }));
}

/* ============================================================
   8 · דופק השוק — משפט אחד למנטור
   ============================================================ */

export interface MarketPulseInput {
  /** שם האזור כפי שיוצג: עיר אחת, או „באזורים שלך”. */
  area: string;
  current: { deals: number; medianPpsqm: number | null };
  /** אותה תקופה בשנה הקודמת — לא התקופה הקודמת, בגלל עונתיות. */
  previous: { deals: number; medianPpsqm: number | null };
  periodLabel: string;
}

/**
 * „ברבעון האחרון בחיפה: 1,240 עסקאות, 8% פחות מאשתקד; המחיר החציוני
 * למ"ר עלה 3%.”
 *
 * ‎`null` כשהבסיס דל מדי לטענה — מנטור שאומר „השוק ירד ב-40%” על
 * סמך חמש עסקאות מאבד אמון בשבוע הראשון.
 */
export function marketPulseSentence(input: MarketPulseInput): string | null {
  const { current, previous } = input;
  if (current.deals < MARKET_MIN_SAMPLE * 4 || previous.deals < MARKET_MIN_SAMPLE * 4) return null;
  const volume = percentChange(previous.deals, current.deals);
  const price = percentChange(previous.medianPpsqm, current.medianPpsqm);
  const parts = [`${input.periodLabel} ${input.area}: ${formatIsraeliNumber(current.deals)} עסקאות`];
  if (volume !== null) parts[0] += volume === 0 ? ", כמו אשתקד" : `, ${Math.abs(volume)}% ${volume > 0 ? "יותר" : "פחות"} מאשתקד`;
  if (price !== null) {
    parts.push(
      price === 0
        ? "המחיר החציוני למ\"ר יציב"
        : `המחיר החציוני למ"ר ${price > 0 ? "עלה" : "ירד"} ${Math.abs(price)}%`,
    );
  }
  return `${parts.join("; ")}.`;
}

/* ============================================================
   9 · עדכניות — דיווח מאוחר
   ============================================================ */

/**
 * החודשים האחרונים חלקיים: עסקה מדווחת לרשות המסים שבועות ואף חודשים
 * אחרי החתימה. ב-2026 עד ספטמבר נקלטו כ-47 אלף עסקאות דירה, מול
 * כ-105 אלף בשנה מלאה — לא כי השוק נעצר.
 */
export const MARKET_PARTIAL_MONTHS = 3;

export function isPartialPeriod(isoDate: string, now: Date): boolean {
  return isoDate >= monthsBefore(now, MARKET_PARTIAL_MONTHS);
}

/* ============================================================
   10 · מפתח עסקה — זהות יציבה בין סנכרונים
   ============================================================ */

export interface MarketDealIdentity {
  date: string;
  amountIls: number;
  gush: number;
  helka: number;
  subParcel: number | null;
  nature: string;
  areaSqm: number | null;
  rooms: number | null;
  portion: number | null;
}

/**
 * המחרוזת הקנונית שממנה נגזר מזהה העסקה.
 *
 * למקור אין מזהה, והסנכרון האינקרמנטלי חוזר 60 יום אחורה בכל ריצה
 * כדי לתפוס דיווחים מאוחרים — כלומר רואה את אותה עסקה שוב ושוב.
 * המזהה הזה הוא מה שהופך את זה ל-upsert ולא לכפילות. שתי עסקאות זהות
 * בכל השדות האלה (אותו יום, סכום, חלקה, תת-חלקה, שטח וחדרים) נספרות
 * כאחת — מחיר מקובל לעומת אלפי כפילויות.
 */
export function marketDealKey(deal: MarketDealIdentity): string {
  return [
    deal.date,
    deal.amountIls,
    deal.gush,
    deal.helka,
    deal.subParcel ?? "",
    deal.nature.trim(),
    deal.areaSqm ?? "",
    deal.rooms ?? "",
    deal.portion === null ? "" : deal.portion.toFixed(3),
  ].join("|");
}

/* ============================================================
   11 · שם יישוב — „תל אביב” של המשרד מול „תל אביב -יפו” של המקור
   ============================================================ */

/**
 * מפתח השוואה לשם יישוב: אותיות בלבד, ובלי הכפלות של כתיב מלא.
 *
 * המשרד מקליד „תל אביב”, „קריית אתא” או „פתח-תקווה”; המקור מפרסם
 * „תל אביב -יפו”, „קרית אתא” ו„פתח תקווה”. השוואת מחרוזות הייתה
 * מחזירה „אין נתונים” על שלוש הערים הגדולות בארץ.
 */
export function marketSettlementKey(name: string): string {
  return name
    .replace(/[^\p{L}]/gu, "")
    .replace(/יי/gu, "י")
    .replace(/וו/gu, "ו")
    .toLowerCase();
}

export interface MarketSettlementRef {
  id: number;
  name: string;
  /** עסקאות במקור — מכריע בין שתי התאמות חלקיות. */
  deals: number;
}

/**
 * היישוב במאגר שמתאים לעיר שהמשרד הקליד, או `null`.
 *
 * התאמה מלאה קודם; אחריה תחילית בשני הכיוונים („תלאביב” ⊂
 * „תלאביביפו”), ומבין כמה תחיליות — היישוב עם הכי הרבה עסקאות.
 * תחילית קצרה משלוש אותיות אינה נבדקת: „אור” היה תופס את „אור עקיבא”
 * ואת „אור יהודה” גם יחד.
 */
export function resolveMarketSettlement(
  city: string | null | undefined,
  settlements: readonly MarketSettlementRef[],
): MarketSettlementRef | null {
  if (!city) return null;
  const key = marketSettlementKey(city);
  if (key.length === 0) return null;
  const exact = settlements.find((s) => marketSettlementKey(s.name) === key);
  if (exact) return exact;
  if (key.length < 3) return null;
  const partial = settlements.filter((s) => {
    const other = marketSettlementKey(s.name);
    return other.length >= 3 && (other.startsWith(key) || key.startsWith(other));
  });
  if (partial.length === 0) return null;
  return partial.reduce((best, s) => (s.deals > best.deals ? s : best));
}

/* ============================================================
   12 · תצוגה
   ============================================================ */

/** ‎`1250000` → „1.25 מיליון ₪”; `880000` → „880 אלף ₪”. */
export function formatMarketIls(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000;
    const text = millions >= 10 ? millions.toFixed(1) : millions.toFixed(2);
    return `${text.replace(/\.?0+$/u, "")} מיליון ₪`;
  }
  if (Math.abs(value) >= 1_000) return `${formatIsraeliNumber(Math.round(value / 1_000))} אלף ₪`;
  return `${formatIsraeliNumber(Math.round(value))} ₪`;
}

/** ייחוס המקור — מופיע בכל מסך שמציג נתון מהמאגר. */
export const MARKET_SOURCE_ATTRIBUTION =
  'מקור: עסקאות מיסוי מקרקעין, רשות המסים — באמצעות „גרסאות לעם” (over.org.il). הסכומים מדווחים ואינם שמאות.';
