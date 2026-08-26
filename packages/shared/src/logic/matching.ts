import type { PropertyFields } from "../schemas/property.js";
import type { BuyerRequirements } from "../schemas/buyer.js";
import type { MatchCriterion, ScoreComponent } from "../schemas/match.js";
import { scoreEntryFit } from "./entry-timing.js";
import { bestLocationMatch } from "./location-text.js";
import { bestAreaMatch, describeDistance } from "./proximity.js";
import { CUSTOM_FEATURE_PREFIX, customFeatureMap, isCustomFeature } from "./custom-features.js";

export interface MatchResult {
  /** 0–100 */
  score: number;
  /**
   * איזה חלק ממשקל הליבה נבדק בפועל, 0–1.
   *
   * חשוף ולא פנימי, כי הוא ההבדל בין „מתאים” לבין „מתאים בכל מה
   * שהספקנו לבדוק” — ומסך שמציג ציון בלי לדעת על כמה הוא נשען
   * אינו יכול לומר את האמת עליו.
   */
  coverage: number;
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
 * הקריטריונים שעליהם „התאמה” נשענת.
 *
 * ארבעה, והם אינם שרירותיים: מיקום, תקציב, חדרים וסוג הנכס הם מה
 * שמתווך שואל בשיחה הראשונה. שטח, מועד כניסה ו„נחמד שיהיה” מוסיפים
 * דיוק להתאמה קיימת — הם אינם מייצרים אותה. לכן הכיסוי נמדד עליהם
 * בלבד: שלושה קריטריונים שוליים אינם „שלושה קריטריונים”.
 */
export const CORE_MATCH_CRITERIA: readonly MatchCriterion[] = [
  "location",
  "budget",
  "rooms",
  "property_type",
];

/**
 * כמה ממשקל הליבה חייב להיבחן בפועל כדי שתיווצר התאמה בכלל.
 *
 * חצי. בברירת המחדל (מיקום .25, תקציב .25, חדרים .15, סוג .1) זה
 * אומר בפועל „לפחות שני קריטריונים מרכזיים, ולפחות אחד מהכבדים”:
 * עיר+תקציב הם 67%, תקציב+חדרים 53%, ואילו תקציב לבדו 33% וחדרים
 * וסוג יחד 33% — ואלה נחסמים.
 *
 * ‎**זו החלפה של שער הספירה שהיה כאן, ולא הידוק שלו.** ספירה
 * התייחסה לכל הקריטריונים כשווים, ולכן תקציב+שטח+מועד-כניסה עברו
 * (שלושה!) וקיבלו 100%, בעוד עיר+תקציב — צמד שאומר הרבה יותר —
 * נחסם. הכיוון החדש מחמיר על הראשון ומקל על השני, וזה בדיוק
 * ההבדל שהמשקלים כבר מבטאים.
 */
export const MIN_CORE_COVERAGE = 0.5;

/**
 * ‎**רצועת הסטייה בשטח — 10% מתחת למבוקש.**
 *
 * מקבילה לרצועת התקציב, ומאותו נימוק: המספר שהקונה סימן הוא כוונה
 * ולא מדידה. ההבדל היחיד הוא שזו רצועה חד-צדדית — נכס **גדול**
 * מהמבוקש אינו חריגה.
 */
export const AREA_TOLERANCE = 0.1;

/**
 * קריטריונים שחייבים **להיבחן בפועל**, ולא רק להיות כבדים.
 *
 * ‎**כלל ברזל: התאמה בלי השוואת מיקום וסוג נכס אינה התאמה.** לא
 * „התאמה חלשה” ולא „התאמה עם כיסוי חלקי” — היא לא מוצגת בכלל.
 *
 * המשקל לבדו לא אכף את זה, וזה הפער שהיה כאן. מיקום שוקל .25 מתוך
 * ‎.75 של הליבה, ולכן בלעדיו הכיסוי הוא עדיין 67% — הרבה מעל הסף.
 * תקציב וחדרים לבדם נותנים 53%, גם הם עוברים. כלומר נכס וקונה יכלו
 * להיות מוצגים כהתאמה על סמך תקציב וחדרים, **בלי שאיש השווה איפה
 * הנכס ואיפה הקונה מחפש** — וזו בדיוק ההתאמה שגורמת למתווך להפסיק
 * להאמין לרשימה.
 *
 * „כבד” אינו „חובה”. שני מושגים שונים, ועד עכשיו היה כאן רק אחד.
 * סוג הנכס הוא הדוגמה החדה לכך: הוא הקל מבין ארבעת קריטריוני
 * הליבה (.1), ובכל זאת וילה שמוצעת למי שמחפש דירת 3 חדרים אינה
 * „התאמה חלשה” אלא טעות. משקל נמוך אומר שהוא מבדיל פחות בין
 * מועמדים, לא שמותר לדלג עליו.
 *
 * שניהם יחד הם .35 — **מתחת** ל-`MIN_CORE_COVERAGE`, ובכוונה: הם
 * תנאי סף ולא התאמה בפני עצמה. תמיד יידרש עוד קריטריון ליבה אחד
 * לפחות מעבר להם.
 *
 * התקציב אינו כאן. הוא כבר הכבד ביותר יחד עם המיקום (.25) והוא
 * פוסל בפועל דרך רצועת התקציב (`HARD_MATCH_CRITERIA`), כך שנכס
 * מחוץ לרצועה יוצא מהרשימה גם בלי להיות ברשימה הזו.
 */
export const MANDATORY_MATCH_CRITERIA: readonly MatchCriterion[] = [
  "location",
  "property_type",
];

/**
 * תווית לתצוגה בהסבר ההתאמה. מאפיין מותאם מוצג בשמו בלי הקידומת —
 * "custom:סורגים" בהסבר לסוכן הוא דליפה של מבנה פנימי אל המסך.
 */
export function propertyFeatureLabel(key: string): string {
  if (isCustomFeature(key)) return key.slice(CUSTOM_FEATURE_PREFIX.length);
  return FEATURE_LABELS[key] ?? key;
}

/**
 * ‎**תקציב התווים לרשימת תוויות בתוך הערה.**
 *
 * ההערות של המאפיינים משרשרות רשימה שאין עליה גבול: לקונה מותר
 * לדרוש כמה מאפיינים שירצה, ומפתח מותאם מגיע עד 64 תווים. הערה
 * כזו חרגה מ-`SCORE_NOTE_MAX`, נשמרה בלי אימות, ובקריאה חזרה
 * הרכיב **נשמט בשקט** — כך שקריטריון שפסל את ההתאמה הוצג כ„לא
 * נבדק” (ביקורת Codex).
 *
 * ‎180 ועוד הקידומת והסיומת הארוכות ביותר („ ‎— סומן כעדיפות ולא
 * כחובה”) ועוד „ ועוד 999” נשארים הרחק מתחת לתקרה. הבדיקה מודדת
 * זאת מול הסכמה עצמה ולא מול החשבון הזה.
 */
const NOTE_LABEL_BUDGET = 180;

/**
 * רשימת תוויות מקוצרת — **ובלי לאבד את הספירה.**
 *
 * „ועוד 4” אינו קישוט: מתווך שרואה שלושה מאפיינים חסרים מתוך
 * שבעה מקבל החלטה אחרת ממי שחושב שחסרים שלושה. הקיצוץ נוגע למה
 * שנכתב, לא למה שנספר.
 */
function joinFeatureLabels(labels: readonly string[]): string {
  const shown: string[] = [];
  let used = 0;
  for (const label of labels) {
    const cost = shown.length === 0 ? label.length : label.length + 2;
    if (used + cost > NOTE_LABEL_BUDGET) break;
    shown.push(label);
    used += cost;
  }
  if (shown.length === labels.length) return labels.join(", ");
  /*
   * תווית אחת לפחות תמיד. „ועוד 7” לבדו אינו אומר על מה, וזו הערה
   * שעדיף היה שלא תיכתב.
   */
  if (shown.length === 0 && labels.length > 0) {
    shown.push(labels[0]!.slice(0, NOTE_LABEL_BUDGET));
  }
  return `${shown.join(", ")} ועוד ${labels.length - shown.length}`;
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

/*
 * ‎`MatchCriterion` נגזר עכשיו מ-`MATCH_CRITERIA` שבסכמה, ולא
 * מהמשקלים. ההיפוך מכוון: הסכמה היא מה שנכתב למסד ומה שנקרא ממנו,
 * ולכן היא המקור. משקל שיחסר לקריטריון קיים נופל בקומפילציה במקום
 * להישאר `undefined` ולהתגלות כציון שגוי.
 */
export type { MatchCriterion };

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
  "property_type",
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
   * ‎**כששני המסלולים אינם חלים, המיקום פשוט לא נבחן — ואז אין
   * התאמה בכלל.** אין כאן `else` בכוונה: ההכרעה נעשית במקום אחד,
   * מול `MANDATORY_MATCH_CRITERIA`, ולא בשכפול התנאי כאן.
   *
   * קודם נכתב כאן שקונה בלי ערים ובלי אזורים הוא „בלי מגבלת אזור”
   * ולכן הקריטריון מדולג. זה היה הפער: „לא ביקש להגביל” הפך
   * ל„נבדק”, והתוצאה הייתה התאמות שהוצגו בלי שאיש השווה מיקום.
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

  /*
   * --- סוג נכס (0.1) ---
   *
   * ‎**סוג שאינו מבוקש פוסל, ולא רק גורע ניקוד.** קודם הוא קיבל
   * ציון אפס והמשיך הלאה, ומכיוון שמשקלו הוא הקל בליבה, וילה מול
   * מי שביקש דירה קיבלה ציון של כ-88 ונשארה ברשימה (ביקורת Codex).
   *
   * זו אינה „התאמה חלשה”. אי אפשר להפוך וילה לדירת שלושה חדרים,
   * בדיוק כפי שאי אפשר להזיז אותה לעיר אחרת — ולכן ההתנהגות כאן
   * זהה לזו של המיקום ושל החדרים שמעל.
   */
  if (property.propertyType !== undefined && buyer.propertyTypes.length > 0) {
    const ok = buyer.propertyTypes.includes(property.propertyType);
    parts.push({
      criterion: "property_type",
      weight: weights.property_type,
      score: ok ? 1 : 0,
      note: ok ? undefined : "סוג הנכס שונה מהמבוקש",
    });
    if (!ok) excluded = true;
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
        note: `חסר: ${joinFeatureLabels(mustMissingExplicit)} (חובה עבור הקונה)`,
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
            ? `לא ידוע אם יש ${joinFeatureLabels(mustUnknown)} — להשלים בנכס`
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
            ? `חסר ${joinFeatureLabels(missedNice)} — סומן כעדיפות ולא כחובה`
            : "כל ההעדפות מתקיימות",
      });
    }
  }

  // --- שטח (0.05) ---
  /*
   * ‎**רצועת סטייה, כמו בתקציב** (בקשת המשתמשת).
   *
   * „‎88 מ״ר” אינו מספר שהקונה מדד — הוא סימון של מה שהוא מחפש.
   * נכס של 85 מ״ר אינו „לא מתאים”, והורדתו לאפס הייתה מוחקת ממנו
   * ‎5% מהציון על שלושה מטרים.
   *
   * הרצועה **חד-צדדית**, כי לקונה יש מינימום בלבד ואין מקסימום:
   * נכס גדול מהמבוקש אינו חריגה אלא בונוס, ואין מה לנכות עליו.
   * זה ההבדל מהתקציב, ששם החריגה כלפי מטה **כן** משמעותית (מי
   * שסימן 3.5 מיליון אינו מחפש 2.5).
   *
   * ‎**הניקוד יורד ברצף ולא במדרגה.** מדרגה ל-0.5 הייתה מתייחסת
   * ל-87 מ״ר ול-80 מ״ר כאל אותו דבר, וזו בדיוק ההשטחה שהופכת ציון
   * למספר שאי אפשר לסמוך עליו.
   *
   * שטח אינו קריטריון חובה ואינו פוסל — נכס מחוץ לרצועה מקבל 0
   * בקריטריון שמשקלו .05, ותו לא.
   */
  if (property.areaSqm !== undefined && buyer.areaSqmMin !== undefined) {
    const min = buyer.areaSqmMin;
    const actual = property.areaSqm;
    const shortfall = min > 0 ? (min - actual) / min : 0;
    const score =
      shortfall <= 0 ? 1 : shortfall >= AREA_TOLERANCE ? 0 : 1 - shortfall / AREA_TOLERANCE;
    parts.push({
      criterion: "area",
      weight: weights.area,
      score,
      /*
       * ההערה נוקבת בפער ולא רק בעובדה: „קטן ב-3%” אומר למתווך אם
       * זה בכלל מפריע, ו„קטן מהמבוקש” אינו אומר דבר.
       */
      note:
        shortfall <= 0
          ? undefined
          : `שטח קטן ב-${Math.round(shortfall * 100)}% מהמבוקש (${actual} מ"ר מול ${min})`,
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
  /*
   * ‎**הכיסוי נמדד במשקלי ברירת המחדל, לא במשקלי המשרד.**
   *
   * הכיסוי עונה על „כמה ממה שחשוב באמת נבדק” — תכונה של הנתונים,
   * לא של ההעדפות. גזירתו מ-`weights` הפכה אותו לניתן לכיול, וזה
   * החזיר בדיוק את הבאג: משרד שמעלה את משקל התקציב ל-0.5 (התקרה,
   * ובכיול האוטומטי שדולק כברירת מחדל זה קורה מעצמו) הופך את משקל
   * הליבה ל-1.0, וקונה עם תקציב בלבד מקבל כיסוי 0.5 — עובר את
   * השער, מקבל ציון 50, ו-`MATCH_THRESHOLDS.review` הוא 50 בדיוק,
   * כך שהוא נשמר. נמדד (ביקורת Codex).
   *
   * בברירת המחדל אף קריטריון ליבה בודד אינו מגיע לחצי (הכבד ביותר
   * הוא 0.25 מתוך 0.75), ולכן „לפחות חצי” פירושו בהכרח לפחות שניים
   * — בלי תלות במה שהמשרד כיוון.
   *
   * זה גם מה שמאפשר להשוות: „87%” על ביקוש ברשת חייב לומר את אותו
   * דבר בשני משרדים, בדיוק כמו הציון עצמו שרץ שם בברירת המחדל.
   */
  const coreWeight = CORE_MATCH_CRITERIA.reduce((sum, c) => sum + DEFAULT_MATCH_WEIGHTS[c], 0);
  const examinedCore = parts
    .filter((p) => CORE_MATCH_CRITERIA.includes(p.criterion as MatchCriterion))
    .reduce((sum, p) => sum + DEFAULT_MATCH_WEIGHTS[p.criterion as MatchCriterion], 0);
  const coverage = coreWeight > 0 ? Math.min(1, examinedCore / coreWeight) : 0;

  /*
   * שני שערים, ולא אחד: „מספיק נבחן” ו„הדברים שחייבים להיבחן
   * נבחנו”. הכיסוי הוא כמות, והחובה היא זהות — ומיקום שנשמט עובר
   * את הראשון בקלות (ראו `MANDATORY_MATCH_CRITERIA`).
   */
  const missingMandatory = MANDATORY_MATCH_CRITERIA.some(
    (c) => !parts.some((p) => p.criterion === c),
  );

  /*
   * ‎**דחייה מפורשת גוברת על „חסר מידע”.**
   *
   * ‎`!excluded` אינו קישוט: נכס בעיר שאינה מבוקשת **וגם** בלי סוג
   * נכס הוא גם נדחה וגם חסר — ובלי התנאי הזה החזרה המוקדמת הייתה
   * מדווחת עליו „אין מספיק פרטים”, בעוד שהמיקום נבדק ונדחה
   * מפורשות (ביקורת Codex).
   *
   * זו בדיוק ההבחנה שהקובץ הזה מגן עליה, והיא נשברה כאן דווקא
   * בשער שנועד לחזק אותה: „בדקנו וזה לא מתאים” אינו „לא היה מה
   * לבדוק”, ומי שנדחה מסיבה ידועה צריך לראות אותה — ולא הזמנה
   * להשלים פרטים שלא ישנו דבר.
   */
  if (!excluded && (coverage < MIN_CORE_COVERAGE || missingMandatory)) {
    const missing = CORE_MATCH_CRITERIA.filter(
      (c) => !parts.some((p) => p.criterion === c),
    ).map((c) => MATCH_CRITERION_LABELS[c]);
    return {
      score: 0,
      coverage,
      breakdown: parts,
      /* נוקב במה שחסר, כי „אין מספיק פרטים” לבדו אינו אומר מה לעשות */
      explanation: `אין מספיק פרטים להתאמה — לא נבדקו ${missing.join(", ")}. השלימו את הפרטים בכרטיס.`,
      excluded: true,
      insufficientData: true,
    };
  }

  /*
   * --- שקלול: מה שנבדק, כפול כמה שנבדק ---
   *
   * ‎**הממוצע המשוקלל לבדו הוא „מתאים בכל מה שנבדק”, והוא נקרא
   * „מתאים”.** אלה אינם אותו דבר: קונה שיש עליו תקציב ועיר בלבד
   * קיבל 100% על נכס בעיר הנכונה ובמחיר הנכון — בלי שאיש בדק
   * חדרים או סוג נכס. המתווך ראה „100%”, פתח את הכרטיס, וגילה
   * וילה לזוג שחיפש דירת שלושה חדרים. אחרי פעמיים כאלה הוא מפסיק
   * להאמין למספר, וזה מבטל את המנוע כולו.
   *
   * הכפלה בכיסוי הופכת את המספר לכן: 100% אומר „נבדק הכול והכול
   * התאים”, ו-67% על התאמה מושלמת אומר „מה שנבדק התאים, ושליש לא
   * נבדק”. הדירוג בין המועמדים כמעט אינו משתנה — כולם מוכפלים
   * באותו כיסוי כשהכרטיס זהה — אבל המשמעות המוחלטת של המספר כן,
   * והיא זו שנשענים עליה כדי להחליט אם בכלל להתקשר.
   */
  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const weighted = parts.reduce((sum, p) => sum + p.weight * p.score, 0);
  const fit = totalWeight > 0 ? weighted / totalWeight : 0;
  const score = Math.round(fit * coverage * 100);

  return {
    score: excluded ? 0 : score,
    coverage,
    breakdown: parts,
    explanation: buildExplanation(parts, excluded, coverage),
    excluded,
    insufficientData: false,
  };
}

/**
 * ‎**קונה שמבקש הכול — כלי מדידה, לא נתון.**
 *
 * כל קריטריון נבחן רק כששני הצדדים תרמו: הנכס נותן מחיר והקונה
 * נותן תקציב, הנכס נותן שטח והקונה נותן מינימום. הקונה הזה מספק
 * את **כל** החצי שלו, ולכן מה שנשאר אחרי הרצה מולו הוא בדיוק
 * החצי של הנכס.
 *
 * הערכים חסרי משמעות בכוונה — הם נבחרו כדי שהקריטריון **ייבחן**,
 * לא כדי שיעבור. הציון שיוצא נזרק; רק זהות הרכיבים נקראת.
 *
 * ‎`entryType: "flexible"` הוא המפתח בשורת מועד הכניסה: קונה גמיש
 * מקבל ציון מיד כשלנכס יש מצב כניסה כלשהו, בלי לדרוש תאריך — כלומר
 * הוא מודד את הנכס ולא את עצמו. אותו עיקרון בשאר השדות.
 */
const EVERY_REQUIREMENT_BUYER: BuyerRequirements = {
  cities: ["*"],
  neighborhoods: [],
  /* שני מסלולי המיקום מסופקים — ייבחן זה שהנכס תומך בו */
  searchAreas: [{ lat: 32, lon: 34.8, radiusKm: 50 }],
  dealType: "sale",
  propertyTypes: ["apartment"],
  budgetMaxAgorot: Number.MAX_SAFE_INTEGER,
  roomsMin: 0,
  areaSqmMin: 1,
  /* דרישה אחת מכל רמה — כדי ששני קריטריוני המאפיינים ייבחנו */
  features: { hasElevator: "must", hasParking: "nice" },
  entryType: "flexible",
};

/**
 * ‎**אילו קריטריונים הנכס הזה מסוגל להיבחן בהם בכלל.**
 *
 * ## השאלה שזה עונה עליה
 *
 * קריטריון שאינו בפירוט ההתאמה יכול להיות שני דברים הפוכים:
 *
 * - ‎**חסר בנכס** — אין מחיר, אין שטח. המתווך יכול לתקן, וכדאי
 *   שיידע.
 * - ‎**הקונה לא ביקש** — לא הגדיר תקציב, לא סימן „נחמד שיהיה”.
 *   אין כאן פער ואין מה להשלים; ההתאמה **מלאה כפי שהיא**.
 *
 * רצועת ההסבר צבעה את שניהם באפור „לא נבדק”, ולכן התאמה תקינה
 * לחלוטין נראתה כמלאה בשדות פתוחים (ביקורת Codex). זו אותה טעות
 * שהרצועה עצמה נבנתה כדי לתקן — שני מצבים שונים באותו צבע — רק
 * מדרגה אחת פנימה.
 *
 * ## למה זה מריץ את המנוע ולא מפרט תנאים
 *
 * אפשר היה לכתוב כאן „תקציב דורש `priceAgorot`, שטח דורש
 * ‎`areaSqm`”. זו הייתה **רשימה שנייה שמסכימה עם `scoreMatch`
 * בקריאה שלי בלבד** — ותנאי שישתנה שם היה משאיר כאן טענה שקרית,
 * בשקט.
 *
 * במקום זה `scoreMatch` עצמו הוא התשובה: מריצים אותו מול קונה
 * שמבקש הכול, ומה שיצא הוא מה שהנכס מסוגל לתרום. אין תנאי משוכפל
 * ואין מה שיתיישן.
 */
export function propertyEvaluableCriteria(
  property: PropertyFields,
  now: Date = new Date(),
): Set<MatchCriterion> {
  const probe = scoreMatch(property, EVERY_REQUIREMENT_BUYER, DEFAULT_MATCH_WEIGHTS, now);
  return new Set(probe.breakdown.map((p) => p.criterion));
}

function buildExplanation(
  parts: ScoreComponent[],
  excluded: boolean,
  coverage: number,
): string {
  const notes = parts.filter((p) => p.note).map((p) => p.note as string);
  if (excluded) {
    const blocker = parts.find((p) => p.score === 0 && p.note);
    return blocker?.note ?? "לא מתאים לדרישות הקונה";
  }
  const body = notes.length > 0 ? notes.join(". ") + "." : "התאמה מלאה לדרישות שהוגדרו.";
  if (coverage >= 1) return body;
  /*
   * ‎**הסיבה לציון מופיעה לצד הציון.** בלי המשפט הזה „67%” נראה
   * כמו „מתאים חלקית”, כלומר כמו פגם בנכס — בעוד שהוא אומר שחסר
   * מידע בכרטיס. הפעולה הנדרשת שונה לגמרי: לא לוותר על הנכס אלא
   * להשלים את הקונה.
   */
  const missing = CORE_MATCH_CRITERIA.filter((c) => !parts.some((p) => p.criterion === c)).map(
    (c) => MATCH_CRITERION_LABELS[c],
  );
  const why =
    missing.length > 0
      ? `הציון מוגבל ל-${Math.round(coverage * 100)}% כי לא נבדקו ${missing.join(", ")} — להשלים בכרטיס.`
      : `הציון מוגבל ל-${Math.round(coverage * 100)}% כי לא כל הקריטריונים המרכזיים נבדקו.`;
  return `${body} ${why}`;
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
