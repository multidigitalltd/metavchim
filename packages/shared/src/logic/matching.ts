import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import type { ScoreComponent } from "../schemas/match.js";
import { scoreEntryFit } from "./entry-timing.js";

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
/**
 * משקלי הקריטריונים — ברירת המחדל של המערכת.
 *
 * הערכים הם היחס ביניהם ולא אחוזים: הציון הסופי מנרמל לפי סכום
 * המשקלים שנבחנו **בפועל**, ולכן קריטריון שדולג (קונה בלי ערים,
 * נכס בלי שטח) אינו גורע מהציון.
 */
export const DEFAULT_MATCH_WEIGHTS = {
  location: 0.25,
  budget: 0.25,
  rooms: 0.15,
  property_type: 0.1,
  features_must: 0.15,
  features_nice: 0.05,
  area: 0.05,
  entry_date: 0.05,
} as const;

export type MatchCriterion = keyof typeof DEFAULT_MATCH_WEIGHTS;

/**
 * קריטריונים שאינם ניתנים לביטול.
 *
 * שלושת אלה אינם רק משוקללים — הם **פוסלים**: עיר שאינה ברשימת
 * הקונה, מחיר מעל התקציב, ודרישת חובה שהנכס מפר, כולם מוציאים את
 * ההתאמה מהרשימה לגמרי. חלקם אף מסננים כבר ב-SQL, לפני שהניקוד
 * בכלל רץ.
 *
 * לכן משקל אפס עליהם היה שקר: המסך היה מציג "מבוטל" בעוד שהקריטריון
 * ממשיך למחוק מועמדים (ביקורת Codex). במקום להתיר ביטול מדומה,
 * נאכף מינימום — ומי שרוצה באמת להתעלם מהמיקום, מסיר את הערים
 * מדרישות הקונה.
 */
export const HARD_MATCH_CRITERIA: readonly MatchCriterion[] = [
  "location",
  "budget",
  "features_must",
];

/** המשקל המזערי לקריטריון פוסל. */
export const MIN_HARD_WEIGHT = 0.05;
export type MatchWeights = Record<MatchCriterion, number>;

/** תוויות בעברית — למסך ההגדרות ולהסברים. */
export const MATCH_CRITERION_LABELS: Record<MatchCriterion, string> = {
  location: "מיקום (עיר ושכונה)",
  budget: "תקציב",
  rooms: "מספר חדרים",
  property_type: "סוג הנכס",
  features_must: "דרישות חובה",
  features_nice: "נחמד שיהיה",
  area: "שטח",
  entry_date: "מועד כניסה/מסירה",
};

/**
 * ניקוד התאמה בין נכס לקונה.
 *
 * `weights` אופציונלי בכוונה: **התאמות בשוק השת"פ חייבות לרוץ
 * בברירת המחדל**. משרד ששולט במשקלים שלו לא אמור לשנות את הציון
 * שמשרד אחר רואה על הביקוש שלו — אחרת "80% התאמה" מאבד כל משמעות
 * משותפת, ואפשר היה לנפח ציונים כדי למשוך הצעות.
 */
export function scoreMatch(
  property: PropertyFields,
  buyer: BuyerRequirements,
  weights: MatchWeights = DEFAULT_MATCH_WEIGHTS,
  /*
   * "עכשיו" נכנס כפרמטר ולא נקרא מהשעון בתוך הפונקציה: המנוע חייב
   * להישאר טהור ודטרמיניסטי — אותו נכס מול אותו קונה חייב לקבל אותו
   * ציון, אחרת אי אפשר לבדוק אותו ואי אפשר להסביר אותו.
   */
  now: Date = new Date(),
): MatchResult {
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
      weight: weights.location,
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
    parts.push({ criterion: "budget", weight: weights.budget, score, note });
  }

  // --- חדרים (0.15) ---
  if (property.rooms !== undefined && (buyer.roomsMin !== undefined || buyer.roomsMax !== undefined)) {
    const min = buyer.roomsMin ?? 0;
    const max = buyer.roomsMax ?? Number.POSITIVE_INFINITY;
    const inRange = property.rooms >= min && property.rooms <= max;
    const nearMiss = property.rooms >= min - 0.5 && property.rooms <= max + 0.5;
    parts.push({
      criterion: "rooms",
      weight: weights.rooms,
      score: inRange ? 1 : nearMiss ? 0.5 : 0,
      note: inRange ? `${property.rooms} חדרים — בטווח` : `${property.rooms} חדרים — מחוץ לטווח המבוקש`,
    });
  }

  // --- סוג נכס (0.1) ---
  if (property.propertyType !== undefined && buyer.propertyTypes.length > 0) {
    const ok = buyer.propertyTypes.includes(property.propertyType);
    parts.push({
      criterion: "property_type",
      weight: weights.property_type,
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
        weight: weights.features_must,
        score: 0,
        note: `חסר: ${mustMissingExplicit.join(", ")} (חובה עבור הקונה)`,
      });
    } else if (featureEntries.some(([, level]) => level === "must")) {
      /*
       * רק כשבאמת נדרשה דרישת חובה.
       *
       * קונה שסימן הכול כ"נחמד שיהיה" קיבל כאן ציון מלא על קריטריון
       * שלא ביקש, ומשרד שמעלה את משקל דרישות החובה היה מנפח בטעות
       * דווקא את ההתאמות האלה — ודוחף אותן מעל סף התצוגה מסיבה
       * שאינה קשורה לכלום (ביקורת Codex).
       */
      const mustScore = mustUnknown.length === 0 ? 1 : 0.5;
      parts.push({
        criterion: "features_must",
        weight: weights.features_must,
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
        weight: weights.features_nice,
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
      weight: weights.area,
      score: ok ? 1 : property.areaSqm >= buyer.areaSqmMin * 0.9 ? 0.5 : 0,
      note: ok ? undefined : `שטח קטן מהמבוקש (${property.areaSqm} מ"ר)`,
    });
  }

  // --- מועד כניסה/מסירה (0.05) --- לא רק תאריך; ראו entry-timing.ts
  const entryFit = scoreEntryFit(property, buyer, now);
  if (entryFit !== null) {
    parts.push({
      criterion: "entry_date",
      weight: weights.entry_date,
      score: entryFit.score,
      ...(entryFit.note !== undefined ? { note: entryFit.note } : {}),
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

/**
 * קריאת משקלים שנשמרו במשרד, עם נפילה לברירת המחדל.
 *
 * ההגנות כאן אינן פורמליות: הערכים מגיעים מ-JSON בבסיס הנתונים,
 * וקריטריון עם משקל שלילי או NaN היה מייצר ציונים חסרי משמעות (ואף
 * שליליים) בלי שום שגיאה גלויה. ערך פסול נופל לברירת המחדל של אותו
 * קריטריון בלבד — לא של כולם.
 *
 * סכום אפס מוחזר כברירת המחדל המלאה: משרד שאיפס את הכול היה מקבל
 * ציון 0 לכל נכס, וזה מסך ריק בלי הסבר.
 */
export function resolveMatchWeights(stored: unknown): MatchWeights {
  const source = (stored ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_MATCH_WEIGHTS } as MatchWeights;
  let sum = 0;

  for (const key of Object.keys(DEFAULT_MATCH_WEIGHTS) as MatchCriterion[]) {
    const raw = source[key];
    const value = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
    if (value !== undefined) out[key] = value;
    // קריטריון פוסל לא יורד מתחת למינימום — ראו HARD_MATCH_CRITERIA
    if (HARD_MATCH_CRITERIA.includes(key)) out[key] = Math.max(out[key], MIN_HARD_WEIGHT);
    sum += out[key];
  }

  return sum > 0 ? out : { ...DEFAULT_MATCH_WEIGHTS };
}
