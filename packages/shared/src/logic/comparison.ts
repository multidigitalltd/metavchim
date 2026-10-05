import { pricePerSqmAgorot } from "./price-per-sqm.js";
import { shekelsLabel } from "./forum.js";

/**
 * ‏דף השוואה לקונה (docs/03 — comparisons).
 *
 * ‏שניים או שלושה נכסים זה לצד זה — מחיר, למ״ר, חדרים, שטח, קומה,
 * ‏מאפיינים — עם סימון „הכי טוב” בכל שורה שיש בה מה להשוות, ועם
 * ‏מה שהקונה ביקש (תקציב, חדרים) מולם. תמונת מצב שנשמרת בדף עצמו:
 * ‏הנכס יכול להיערך אחר כך, הדף שנשלח לא זז.
 */

export const COMPARISON_MIN_PROPERTIES = 2;
export const COMPARISON_MAX_PROPERTIES = 3;
/** ‏תוקף הקישור — קונה חוזר לדף אחרי שבועות, לא אחרי חודשים */
export const COMPARISON_TOKEN_DAYS = 60;

export interface ComparisonProperty {
  propertyId: string;
  title: string;
  city?: string;
  neighborhood?: string;
  propertyType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  features: string[];
  media: { key: string; alt?: string }[];
}

export interface ComparisonWants {
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  cities: string[];
}

export interface ComparisonRow {
  key: string;
  label: string;
  /** ‏ערך לכל נכס, באותו סדר; „—” כשאין */
  values: string[];
  /** ‏אינדקס הנכס הטוב ביותר בשורה, או null כשאין מה להשוות / תיקו */
  best: number | null;
}

const FEATURE_ROWS = ["מעלית", "חניה", "מרפסת", 'ממ"ד', "מחסן"] as const;

function bestIndex(values: (number | null)[], prefer: "min" | "max"): number | null {
  const present = values.map((v, i) => (v === null ? null : { v, i })).filter((x): x is { v: number; i: number } => x !== null);
  if (present.length < 2) return null;
  const sorted = [...present].sort((a, b) => (prefer === "min" ? a.v - b.v : b.v - a.v));
  if (sorted[0]!.v === sorted[1]!.v) return null;
  return sorted[0]!.i;
}

/** ‏השורות של הטבלה — כל שורה ערך לכל נכס, והטוב ביותר מסומן. */
export function comparisonRows(properties: readonly ComparisonProperty[]): ComparisonRow[] {
  const money = (agorot: number | null): string => (agorot === null ? "—" : shekelsLabel(agorot / 100));
  const prices = properties.map((p) => p.priceAgorot ?? null);
  const perSqm = properties.map((p) => pricePerSqmAgorot(p.priceAgorot ?? null, p.areaSqm ?? null));
  const rooms = properties.map((p) => p.rooms ?? null);
  const areas = properties.map((p) => p.areaSqm ?? null);
  const rows: ComparisonRow[] = [
    { key: "price", label: "מחיר", values: prices.map(money), best: bestIndex(prices, "min") },
    { key: "perSqm", label: "למ״ר", values: perSqm.map(money), best: bestIndex(perSqm, "min") },
    { key: "rooms", label: "חדרים", values: rooms.map((r) => (r === null ? "—" : String(r))), best: bestIndex(rooms, "max") },
    { key: "area", label: "שטח", values: areas.map((a) => (a === null ? "—" : `${a} מ״ר`)), best: bestIndex(areas, "max") },
    {
      key: "floor",
      label: "קומה",
      values: properties.map((p) => (p.floor === undefined ? "—" : p.totalFloors === undefined ? String(p.floor) : `${p.floor} מתוך ${p.totalFloors}`)),
      best: null,
    },
    {
      key: "where",
      label: "איפה",
      values: properties.map((p) => [p.neighborhood, p.city].filter((part) => part).join(", ") || "—"),
      best: null,
    },
  ];
  for (const feature of FEATURE_ROWS) {
    const has = properties.map((p) => p.features.includes(feature));
    if (!has.some(Boolean)) continue;
    rows.push({
      key: `feature:${feature}`,
      label: feature,
      values: has.map((h) => (h ? "✓" : "—")),
      best: has.filter(Boolean).length === 1 ? has.indexOf(true) : null,
    });
  }
  return rows;
}

/** ‏מה שהקונה ביקש מול הנכס — „בתקציב”, „מעל התקציב ב-8%”, „חדרים כמבוקש”. */
export function fitLabels(property: ComparisonProperty, wants: ComparisonWants): string[] {
  const out: string[] = [];
  if (wants.budgetMaxAgorot !== undefined && property.priceAgorot !== undefined) {
    if (property.priceAgorot <= wants.budgetMaxAgorot) out.push("בתקציב");
    else out.push(`מעל התקציב ב-${Math.round(((property.priceAgorot - wants.budgetMaxAgorot) / wants.budgetMaxAgorot) * 100)}%`);
  }
  if (property.rooms !== undefined && (wants.roomsMin !== undefined || wants.roomsMax !== undefined)) {
    const okMin = wants.roomsMin === undefined || property.rooms >= wants.roomsMin;
    const okMax = wants.roomsMax === undefined || property.rooms <= wants.roomsMax;
    out.push(okMin && okMax ? "חדרים כמבוקש" : okMin ? "יותר חדרים מהמבוקש" : "פחות חדרים מהמבוקש");
  }
  return out;
}

/** ‏ההודעה שהמתווך שולח עם הקישור. */
export function comparisonMessage(input: { count: number; url: string; agencyName: string }): string {
  return [
    `הכנתי לכם דף השוואה של ${input.count === 2 ? "שני הנכסים" : `${input.count} הנכסים`} שדיברנו עליהם — זה לצד זה, עם כל המספרים:`,
    input.url,
    "אפשר לסמן שם איזה מהם מעניין, ואחזור אליכם.",
    input.agencyName,
  ].join("\n");
}
