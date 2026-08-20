import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import type { ScoreComponent } from "../schemas/match.js";
import { scoreEntryFit } from "./entry-timing.js";
import { bestLocationMatch } from "./location-text.js";
import { bestAreaMatch, describeDistance } from "./proximity.js";
import { CUSTOM_FEATURE_PREFIX, customFeatureMap, isCustomFeature } from "./custom-features.js";

export interface MatchResult {
  /** 0–100 */
  score: number;
  breakdown: ScoreComponent[];
  /** הסבר קריא בעברית — נבנה מהפירוט, לא מנוסח חופשי (docs/01 §5.4) */
  explanation: string;
  /** דרישת חובה מופרת במפורש — לא מציגים בכלל */
  excluded: boolean;
  /**
   * נפסל מחוסר מידע ולא מאי-התאמה.
   *
   * נפרד מ-`excluded` אף ששניהם מסתירים את ההתאמה, כי המשמעות
   * הפוכה: `excluded` אומר „בדקנו, וזה לא מתאים”, וזה אומר „לא
   * היה מה לבדוק”. מי שסופר „כמה נכסים נפסלו לקונה” צריך את
   * ההבחנה, וכך גם כל מסך שמסביר למה הרשימה ריקה.
   */
  insufficientData: boolean;
}

/**
 * כמה קריטריונים חייבים להיבחן כדי שהתאמה תיחשב בכלל.
 *
 * שלושה, ולא אחד: ציון של 100% שנשען על קריטריון יחיד אינו התאמה
 * אלא צירוף מקרים — נכס שמחירו מתחת לתקציב, בלי שנבדקו אזור,
 * חדרים או סוג. שלושה קריטריונים הם המינימום שבו „מתאים” אומר
 * משהו על יותר ממימד אחד.
 *
 * לא ארבעה ומעלה: כרטיס סביר לגמרי — אזור, תקציב וחדרים — היה
 * נופל בשער, וזה בדיוק סוג הקונה שהמנוע נועד לשרת.
 */
export const MIN_MATCH_CRITERIA = 3;

/**
 * תווית לתצוגה בהסבר ההתאמה. מאפיין מותאם מוצג בשמו בלי הקידומת —
 * "custom:סורגים" בהסבר לסוכן הוא דליפה של מבנה פנימי אל המסך.
 */
export function propertyFeatureLabel(key: string): string {
  if (isCustomFeature(key)) return key.slice(CUSTOM_FEATURE_PREFIX.length);
  return FEATURE_LABELS[key] ?? key;
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
 * אלה אינם רק משוקללים — הם **פוסלים**: עיר שאינה ברשימת הקונה,
 * מחיר מחוץ לרצועת התקציב, מספר חדרים מחוץ לטווח שביקש הקונה,
 * ודרישת חובה שהנכס מפר, כולם מוציאים את ההתאמה מהרשימה לגמרי.
 * חלקם אף מסננים כבר ב-SQL, לפני שהניקוד בכלל רץ.
 *
 * לכן משקל אפס עליהם היה שקר: המסך היה מציג "מבוטל" בעוד שהקריטריון
 * ממשיך למחוק מועמדים (ביקורת Codex). במקום להתיר ביטול מדומה,
 * נאכף מינימום — ומי שרוצה באמת להתעלם מהמיקום, מסיר את הערים
 * מדרישות הקונה.
 */
export const HARD_MATCH_CRITERIA: readonly MatchCriterion[] = [
  "location",
  "budget",
  "rooms",
  "features_must",
];

/** המשקל המזערי לקריטריון פוסל. */
export const MIN_HARD_WEIGHT = 0.05;

/**
 * רצועת הסטייה המותרת מהתקציב המסומן — לכל כיוון, במכירה.
 *
 * 400 אלף ₪ (בקשת המשתמש): קונה שסימן 3.5 מיליון לא מחפש דירות של
 * 2.5 מיליון — סטייה של מיליון ומטה אינה "מציאה" אלא סגמנט אחר —
 * ונכס שמעל התקציב ביותר מהרצועה אינו גמישות אלא חלום.
 */
export const BUDGET_BAND_AGOROT = 40_000_000;
/**
 * בשכירות הרצועה יחסית: 400 אלף ₪ על שכר דירה של 6,000 ₪ הייתה
 * מוחקת את הקריטריון. 15% לכל כיוון — הגמישות המקובלת בשוק השכירות.
 */
export const RENT_BUDGET_BAND_RATIO = 0.15;

/** רוחב הרצועה סביב סכום נתון — לפי סוג העסקה. */
export function budgetBandAgorot(
  refAgorot: number,
  dealType: string | undefined,
): number {
  return dealType === "rent"
    ? Math.round(refAgorot * RENT_BUDGET_BAND_RATIO)
    : BUDGET_BAND_AGOROT;
}
/**
 * תקרת משקל לקריטריון בודד — גם במחוון וגם בכיול האוטומטי.
 * ערך אחד לשניהם: כיול שהיה חורג מטווח המחוון היה מציג במסך ערך
 * שהמחוון לא יודע לייצג, ונגיעה בו הייתה "מקפיצה" את המשקל חזרה.
 */
export const MAX_MATCH_WEIGHT = 0.5;
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

  /*
   * --- מיקום (0.25) ---
   *
   * **שני מסלולים, ומרחק גובר על טקסט.** כשהקונה סימן אזורי חיפוש
   * על מפה והנכס ממוקם, השאלה "באיזו עיר זה" מפסיקה להיות רלוונטית:
   * נכס 300 מטר מעבר לגבול מוניציפלי הוא בדיוק מה שהקונה מחפש, ושם
   * העיר שלו אינו אמור להסתיר אותו.
   *
   * כשאין קואורדינטות משני הצדדים נופלים להשוואת שמות — עכשיו
   * סלחנית, כך ש"רמת גן" מול "רמת-גן" מתאימים.
   *
   * קונה בלי ערים ובלי אזורים = בלי מגבלת אזור, והקריטריון מדולג.
   */
  const areas = buyer.searchAreas ?? [];
  const propertyPoint =
    property.latitude !== undefined && property.longitude !== undefined
      ? { lat: property.latitude, lon: property.longitude }
      : null;

  if (areas.length > 0 && propertyPoint !== null) {
    const hit = bestAreaMatch(propertyPoint, areas)!;
    const where = hit.area.label ?? "האזור המבוקש";
    parts.push({
      criterion: "location",
      weight: weights.location,
      score: hit.score,
      note:
        hit.score > 0
          ? `${describeDistance(hit.distanceKm)} מ${where}`
          : `רחוק מכל אזורי החיפוש (${describeDistance(hit.distanceKm)})`,
    });
    // מעבר לפי שניים מהרדיוס — מחוץ לכל סבירות, כמו עיר שאינה ברשימה
    if (hit.score === 0) excluded = true;
  } else if (property.city !== undefined && buyer.cities.length > 0) {
    const city = bestLocationMatch(property.city, buyer.cities);
    /*
     * השכונה נבדקת באותה סלחנות כמו העיר. שכונה שנכתבה אחרת אינה
     * "שכונה אחרת", והבונוס נועד לתגמל דיוק ולא לתגמל כתיב.
     */
    const neighborhood =
      city.score > 0 && buyer.neighborhoods.length > 0 && property.neighborhood !== undefined
        ? bestLocationMatch(property.neighborhood, buyer.neighborhoods).score
        : 0;
    const score =
      city.score === 0
        ? 0
        : buyer.neighborhoods.length === 0
          ? city.score
          : /*
             * שכונה תואמת מחזירה את מלוא ניקוד העיר; שכונה שאינה
             * ברשימה גורעת רבע. הקונה ביקש שכונות מסוימות, אבל הוא
             * ביקש גם את העיר — ולכן זו גריעה ולא פסילה.
             */
            city.score * (neighborhood > 0 ? 1 : 0.75);
    parts.push({
      criterion: "location",
      weight: weights.location,
      score,
      note: city.score > 0 ? `באזור המבוקש (${property.city})` : `מחוץ לאזורים המבוקשים`,
    });
    if (city.score === 0) excluded = true; // עיר לא מבוקשת — לא רלוונטי להציע
  }

  /*
   * --- תקציב (0.25) ---
   *
   * נדרשים **שני** הנתונים. בלי מחיר לנכס אין מה להשוות, ובלי
   * תקציב לקונה אין למה — ובשני המקרים הקריטריון מדולג והציון
   * מנורמל לפי מה שכן נבחן.
   *
   * ההשמטה של תנאי התקציב כאן אינה זהירות יתר: `price <= undefined`
   * הוא `false`, ולכן בלי הבדיקה **כל** נכס מתומחר היה מסומן
   * `excluded` וקונה בלי תקציב לא היה מקבל ולו התאמה אחת.
   */
  if (property.priceAgorot !== undefined && buyer.budgetMaxAgorot !== undefined) {
    const max = buyer.budgetMaxAgorot;
    const price = property.priceAgorot;
    /*
     * רצועת סטייה לשני הכיוונים (בקשת המשתמש): המחיר אינו חורג
     * מהתקציב המסומן ביותר מ-400 אלף ₪ למעלה **או למטה** — קונה
     * שסימן 3.5 מיליון אינו מחפש נכסים של 2.5 מיליון, והצעה כזו
     * אינה "מציאה" אלא רעש. בשכירות הרצועה יחסית (15%).
     *
     * הרף התחתון: המינימום שהקונה הצהיר, ואם לא הצהיר — התקציב
     * עצמו הוא הסימון, והרצועה נמדדת ממנו.
     */
    const dealType = property.dealType ?? buyer.dealType;
    const band = budgetBandAgorot(max, dealType);
    /*
     * הרצפה לפסילה: המינימום המוצהר, ואם אין — התקציב עצמו הוא
     * הסימון והרצועה נמדדת ממנו. מתחת לרצפה פחות הרצועה — פסילה;
     * ניקוד חלקי על "מתחת" ניתן רק כשהקונה הצהיר מינימום במפורש —
     * מי שאמר רק "עד 2.8" לא ביקש שנעניש נכס של 2.6.
     *
     * רצועת הרצפה נמדדת **מהרצפה עצמה** ולא מהתקרה (ביקורת Codex):
     * בשכירות הרצועה יחסית, וטווח 5,000–10,000 ₪ עם רצועה שנגזרת
     * מהתקרה היה מקבל נכס של 4,000 ₪ — 20% מתחת למינימום המפורש.
     * במכירה אין הבדל — הרצועה קבועה.
     */
    const lowRef = buyer.budgetMinAgorot ?? max;
    const lowBand = budgetBandAgorot(lowRef, dealType);
    let score: number;
    let note: string;
    if (price > max + band) {
      score = 0;
      note = "מעל התקציב";
      excluded = true;
    } else if (price > max) {
      score = 0.6; // בתוך רצועת הגמישות — מוצג, עם הסתייגות
      note = "מעט מעל התקציב — בתוך רצועת הגמישות";
    } else if (price < lowRef - lowBand) {
      score = 0;
      note = "נמוך מהתקציב המסומן בהרבה — כנראה סגמנט אחר";
      excluded = true;
    } else if (
      buyer.budgetMinAgorot !== undefined &&
      price < buyer.budgetMinAgorot
    ) {
      score = 0.5;
      note = "מתחת לרף התקציב שהוגדר";
    } else {
      score = 1;
      note = "בתקציב";
    }
    parts.push({ criterion: "budget", weight: weights.budget, score, note });
  }

  /*
   * --- חדרים (0.15, פוסל) ---
   *
   * טווח החדרים הוא קריטי (בקשת המשתמש): נכס מחוץ לטווח שהקונה
   * ביקש — ביותר מחצי חדר — נפסל ולא רק מאבד ניקוד. חצי חדר הוא
   * גמישות סבירה (4.5 מוצג למי שביקש עד 4); שני חדרים אינם.
   * נכס בלי מספר חדרים אינו נפסל — "לא ידוע" אינו "מחוץ לטווח".
   */

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
    // מעבר לחצי חדר מהטווח — פסילה, לא רק גריעת ניקוד
    if (!nearMiss) excluded = true;
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
  const featureEntries = Object.entries(buyer.features) as [string, "must" | "nice"][];
  if (featureEntries.length > 0) {
    /*
     * שני מקורות לאותה שאלה, ובכוונה. מאפיין קבוע הוא שדה על הנכס
     * (`property.hasElevator`), ומאפיין שהמשרד הוסיף חי ברשימה —
     * כי הקטלוג נבנה מלמטה ואי אפשר לייצר לו שדה מראש. הקידומת
     * `custom:` היא מה שאומר מאיפה לקרוא.
     *
     * מה שאינו קיים בשני המקורות נשאר `undefined`, כלומר **לא
     * ידוע** — ההבחנה שכבר קיימת כאן: "אין מעלית" פוסל, "לא ידוע"
     * רק מוריד ניקוד. מאפיין מותאם שלא סומן בנכס אינו שקר עליו.
     */
    const custom = customFeatureMap(property.customFeatures ?? []);
    const mustMissingExplicit: string[] = [];
    const mustUnknown: string[] = [];
    let niceTotal = 0;
    let niceHit = 0;
    for (const [feature, level] of featureEntries) {
      const value = isCustomFeature(feature)
        ? custom[feature]
        : (property[feature as keyof PropertyFields] as boolean | undefined);
      if (level === "must") {
        if (value === false) mustMissingExplicit.push(propertyFeatureLabel(feature));
        else if (value === undefined) mustUnknown.push(propertyFeatureLabel(feature));
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
      /* אותה קריאה דו-מקורית כמו למעלה — מותאם מהרשימה, קבוע מהשדה */
      const missedNice = featureEntries
        .filter(([f, l]) => {
          const value = isCustomFeature(f)
            ? custom[f]
            : (property[f as keyof PropertyFields] as boolean | undefined);
          return l === "nice" && value !== true;
        })
        .map(([f]) => propertyFeatureLabel(f));
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

  /*
   * --- סף המידע ---
   *
   * **הבאג שהשער הזה סוגר.** הציון הוא ממוצע משוקלל של
   * הקריטריונים שאפשר היה להשוות בפועל, ולכן קונה שיש עליו רק
   * תקציב נבחן בקריטריון אחד — ואם הנכס בתקציב, אותו קריטריון
   * יחיד מקבל 1 והממוצע יוצא **100%**. משרד שייבא רשימת קונים עם
   * שם, טלפון ותקציב קיבל התאמה מושלמת לכל נכס במאגר.
   *
   * „100%” פירושו „מתאים בכל מה שנבדק”, אבל הוא נקרא כ„מתאים”.
   * כשנבדק דבר אחד, שתי המשמעויות אינן אותו דבר בכלל.
   *
   * הכלל: כרטיס שאין בו מספיק מידע אינו נכנס למנגנון. השער חל על
   * **שני הצדדים** מעצם היותו נספר על ההשוואה: גם קונה ריק וגם
   * נכס ריק מייצרים מעט קריטריונים משותפים.
   *
   * דירוג נמוך לא היה מספיק. התאמה חלשה נשארת ברשימה ומזמינה
   * לפעול לפיה; מה שנדרש כאן הוא שהיא לא תיווצר, והמסך שיפנה את
   * הסוכן להשלים את הכרטיס הוא מונה השלמות שכבר קיים בכרטיס
   * הקונה ובציון המוכנות של הנכס.
   */
  const decisive = parts.length;
  if (decisive < MIN_MATCH_CRITERIA) {
    return {
      score: 0,
      breakdown: parts,
      explanation: `אין מספיק פרטים להתאמה — נבדקו ${decisive} קריטריונים מתוך ${MIN_MATCH_CRITERIA} נדרשים. השלימו את הפרטים בכרטיס.`,
      excluded: true,
      insufficientData: true,
    };
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
    insufficientData: false,
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
