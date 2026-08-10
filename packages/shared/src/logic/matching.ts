import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import type { ScoreComponent } from "../schemas/match.js";

export interface MatchResult {
  /** 0–100 */
  score: number;
  breakdown: ScoreComponent[];
  /** הסבר קריא בעברית — נבנה מהפירוט, לא מנוסח חופשי (docs/01 §5.4) */
  explanation: string;
  /** דרישת חובה מופרת במפורש — לא מציגים בכלל */
  excluded: boolean;
}

const FEATURE_LABELS: Record<string, string> = {
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
};

/**
 * מנוע הניקוד (docs/02 §5, docs/07 §5 — שלב 2 של הצנרת):
 * פונקציה טהורה, דטרמיניסטית וניתנת לבדיקה. שלב הסינון הגס נעשה ב-SQL
 * לפני הקריאה; כאן רק ניקוד מפורט + הסבר.
 *
 * עקרונות:
 * - דרישת חובה שמופרת במפורש (הקונה דורש מעלית, בנכס אין) ⇒ excluded.
 * - שדה לא ידוע בנכס ⇒ ניקוד חלקי, לא פסילה — חוסר מידע אינו אי-התאמה.
 * - כל קריטריון תורם משקל; הציון הוא ממוצע משוקלל של המשקלים שנבחנו בפועל.
 */
export function scoreMatch(property: PropertyFields, buyer: BuyerRequirements): MatchResult {
  const parts: ScoreComponent[] = [];
  let excluded = false;

  // --- מיקום (0.25) --- קונה בלי ערים = בלי מגבלת אזור, הקריטריון מדולג
  if (property.city !== undefined && buyer.cities.length > 0) {
    const cityOk = buyer.cities.some((c) => c.trim() === property.city?.trim());
    const neighborhoodBonus =
      cityOk &&
      buyer.neighborhoods.length > 0 &&
      property.neighborhood !== undefined &&
      buyer.neighborhoods.includes(property.neighborhood);
    parts.push({
      criterion: "location",
      weight: 0.25,
      score: cityOk ? (buyer.neighborhoods.length === 0 || neighborhoodBonus ? 1 : 0.75) : 0,
      note: cityOk ? `באזור המבוקש (${property.city})` : `מחוץ לאזורים המבוקשים`,
    });
    if (!cityOk) excluded = true; // עיר לא מבוקשת — לא רלוונטי להציע
  }

  // --- תקציב (0.25) ---
  if (property.priceAgorot !== undefined) {
    const max = buyer.budgetMaxAgorot;
    const price = property.priceAgorot;
    let score: number;
    let note: string;
    if (price <= max) {
      score = 1;
      note = "בתקציב";
    } else if (price <= max * 1.07) {
      score = 0.6; // עד 7% מעל — גמישות מקובלת בשוק
      note = "מעט מעל התקציב (עד 7%)";
    } else {
      score = 0;
      note = "מעל התקציב";
      excluded = true;
    }
    if (buyer.budgetMinAgorot !== undefined && price < buyer.budgetMinAgorot) {
      score = Math.min(score, 0.5);
      note = "מתחת לרף התקציב שהוגדר";
    }
    parts.push({ criterion: "budget", weight: 0.25, score, note });
  }

  // --- חדרים (0.15) ---
  if (property.rooms !== undefined && (buyer.roomsMin !== undefined || buyer.roomsMax !== undefined)) {
    const min = buyer.roomsMin ?? 0;
    const max = buyer.roomsMax ?? Number.POSITIVE_INFINITY;
    const inRange = property.rooms >= min && property.rooms <= max;
    const nearMiss = property.rooms >= min - 0.5 && property.rooms <= max + 0.5;
    parts.push({
      criterion: "rooms",
      weight: 0.15,
      score: inRange ? 1 : nearMiss ? 0.5 : 0,
      note: inRange ? `${property.rooms} חדרים — בטווח` : `${property.rooms} חדרים — מחוץ לטווח המבוקש`,
    });
  }

  // --- סוג נכס (0.1) ---
  if (property.propertyType !== undefined && buyer.propertyTypes.length > 0) {
    const ok = buyer.propertyTypes.includes(property.propertyType);
    parts.push({
      criterion: "property_type",
      weight: 0.1,
      score: ok ? 1 : 0,
      note: ok ? undefined : "סוג הנכס שונה מהמבוקש",
    });
  }

  // --- מאפייני חובה/עדיפות (0.15) ---
  const featureEntries = Object.entries(buyer.features) as [
    keyof typeof FEATURE_LABELS & keyof PropertyFields,
    "must" | "nice",
  ][];
  if (featureEntries.length > 0) {
    const mustMissingExplicit: string[] = [];
    const mustUnknown: string[] = [];
    let niceTotal = 0;
    let niceHit = 0;
    for (const [feature, level] of featureEntries) {
      const value = property[feature] as boolean | undefined;
      if (level === "must") {
        if (value === false) mustMissingExplicit.push(FEATURE_LABELS[feature] ?? feature);
        else if (value === undefined) mustUnknown.push(FEATURE_LABELS[feature] ?? feature);
      } else {
        niceTotal += 1;
        if (value === true) niceHit += 1;
      }
    }
    if (mustMissingExplicit.length > 0) {
      excluded = true;
      parts.push({
        criterion: "features_must",
        weight: 0.15,
        score: 0,
        note: `חסר: ${mustMissingExplicit.join(", ")} (חובה עבור הקונה)`,
      });
    } else {
      const mustScore = mustUnknown.length === 0 ? 1 : 0.5;
      parts.push({
        criterion: "features_must",
        weight: 0.15,
        score: mustScore,
        note:
          mustUnknown.length > 0
            ? `לא ידוע אם יש ${mustUnknown.join(", ")} — להשלים בנכס`
            : "כל דרישות החובה מתקיימות",
      });
    }
    if (niceTotal > 0) {
      const missedNice = featureEntries
        .filter(([f, l]) => l === "nice" && property[f] !== true)
        .map(([f]) => FEATURE_LABELS[f] ?? f);
      parts.push({
        criterion: "features_nice",
        weight: 0.05,
        score: niceHit / niceTotal,
        note:
          missedNice.length > 0
            ? `חסר ${missedNice.join(", ")} — סומן כעדיפות ולא כחובה`
            : "כל ההעדפות מתקיימות",
      });
    }
  }

  // --- שטח (0.05) ---
  if (property.areaSqm !== undefined && buyer.areaSqmMin !== undefined) {
    const ok = property.areaSqm >= buyer.areaSqmMin;
    parts.push({
      criterion: "area",
      weight: 0.05,
      score: ok ? 1 : property.areaSqm >= buyer.areaSqmMin * 0.9 ? 0.5 : 0,
      note: ok ? undefined : `שטח קטן מהמבוקש (${property.areaSqm} מ"ר)`,
    });
  }

  // --- תאריך כניסה (0.05) ---
  if (property.entryDate !== undefined && buyer.entryBy !== undefined) {
    const ok = property.entryDate <= buyer.entryBy;
    parts.push({
      criterion: "entry_date",
      weight: 0.05,
      score: ok ? 1 : 0.3,
      note: ok ? undefined : "תאריך הכניסה מאוחר מהמבוקש",
    });
  }

  // --- שקלול: ממוצע משוקלל של מה שנבחן בפועל ---
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.weight * p.score, 0);
  const score = totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;

  return {
    score: excluded ? 0 : score,
    breakdown: parts,
    explanation: buildExplanation(parts, excluded),
    excluded,
  };
}

function buildExplanation(parts: ScoreComponent[], excluded: boolean): string {
  const notes = parts.filter((p) => p.note).map((p) => p.note as string);
  if (excluded) {
    const blocker = parts.find((p) => p.score === 0 && p.note);
    return blocker?.note ?? "לא מתאים לדרישות הקונה";
  }
  return notes.length > 0 ? notes.join(". ") + "." : "התאמה מלאה לדרישות שהוגדרו.";
}
