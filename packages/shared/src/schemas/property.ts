import { z } from "zod";
import { IdSchema, MoneyAgorotSchema } from "./common.js";

export const PropertyTypeSchema = z.enum([
  "apartment",
  "garden_apartment",
  "penthouse",
  "duplex",
  "private_house",
  "two_family",
  "studio",
  "unit",
  /*
   * טאבו משותף — הזכות רשומה במשותף ולא כתת-חלקה נפרדת. זה אינו
   * „עוד סוג דירה” אלא מצב קנייני שמשנה את המימון, את שיתוף הפעולה
   * עם הבנק ואת קהל הקונים, ולכן הוא סוג נכס בפני עצמו ולא הערה.
   */
  "shared_tabu",
  /*
   * דירה מתאימה לחלוקה — נמכרת כיחידה אחת, והערך שלה לקונה הוא
   * האפשרות לפצל אותה לשתיים. קונה שמחפש בדיוק את זה לא היה מוצא
   * אותה תחת „דירה”.
   */
  "divisible_apartment",
  /*
   * דירת נכה — דירה מותאמת נגישות. היא נכנסת כאן ולא כמאפיין מאותה
   * סיבה בדיוק ש„טאבו משותף” ו„מתאימה לחלוקה” נכנסו: קונה שמחפש
   * בדיוק את זה מחפש **קטגוריה**, ותחת „דירה” הוא לא היה מוצא אותה.
   * זה גם מה שהמתווך אומר בטלפון — „יש לי דירת נכה” — ולא „דירה עם
   * מאפיין נגישות”.
   */
  "accessible_apartment",
  "plot",
  /*
   * ‎**„מסחרי” נשאר, ותשעת הסוגים נוספים לצידו.**
   *
   * הוא אינו רק תאימות לאחור לשורות קיימות: הוא **„מסחרי שלא נאמר
   * איזה”** — מה שמתווך רושם בשיחה ראשונה לפני שראה את הנכס, ומה
   * שקונה מתכוון אליו כשהוא אומר „מחפש נכס מסחרי”. ראו
   * ‎`logic/commercial-types.ts`: בהתאמה הוא נחשב כמתאים לכל
   * הענפים, בשני הכיוונים.
   */
  "commercial",
  "commercial_shop",
  "commercial_office",
  "commercial_warehouse",
  "commercial_industrial",
  "commercial_basement",
  "commercial_building",
  "commercial_logistics",
  "commercial_parking",
  "commercial_gas_station",
  "other",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PropertyStatusSchema = z.enum([
  "draft",
  "active",
  "on_hold",
  "sold",
  "rented",
  "archived",
]);
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

/**
 * נכס נסרק מול קונים רק בסטטוסים האלה.
 *
 * ‎**הצד השני כבר סינן כך** (`recomputeForBuyer`), והאי-סימטריה
 * הייתה באג של ממש: עריכה של נכס שנמכר ייצרה לו התאמות מחדש,
 * והסבב הבא מצד הקונה מחק אותן. הסוכן ראה קונים מוצעים לנכס שאינו
 * למכירה, ואז ראה אותם נעלמים בלי סיבה נראית לעין.
 *
 * ‎**וכאן בחבילה ולא ב-API**, כי גם המסך צריך את התשובה: רשימת
 * התאמות ריקה על נכס שנמכר אינה „אין קונים מתאימים”, והעצה „הוסיפו
 * קונה” שגויה שם. עותק שני של הרשימה במסך היה מסכים עם הראשון
 * בקריאה בלבד — וזה בדיוק מה ש-PR זה בא לסלק.
 */
export const MATCHABLE_PROPERTY_STATUSES: readonly PropertyStatus[] = [
  "draft",
  "active",
];

export const DealTypeSchema = z.enum(["sale", "rent"]);

/** השדות שמנוע החילוץ מהקול מנסה לזהות; הכל אופציונלי — החוסרים מסומנים למתווך. */
export const PropertyFieldsSchema = z.object({
  city: z.string().min(1).max(80).optional(),
  neighborhood: z.string().max(80).optional(),
  street: z.string().max(120).optional(),
  houseNumber: z.string().max(10).optional(),
  propertyType: PropertyTypeSchema.optional(),
  dealType: DealTypeSchema.optional(),
  rooms: z.number().multipleOf(0.5).min(1).max(20).optional(),
  areaSqm: z.number().int().min(10).max(2000).optional(),
  floor: z.number().int().min(-2).max(60).optional(),
  totalFloors: z.number().int().min(1).max(60).optional(),
  hasElevator: z.boolean().optional(),
  hasParking: z.boolean().optional(),
  hasBalcony: z.boolean().optional(),
  hasSafeRoom: z.boolean().optional(),
  hasStorage: z.boolean().optional(),
  /**
   * מאפיינים שהמשרד הוסיף בעצמו — ראו `logic/custom-features.ts`.
   *
   * חמשת הקבועים נכונים לרוב הדירות ולא מספיקים לאף שוק אמיתי.
   * הם נשמרים כרשימה ולא כשדות, כי הקטלוג נבנה מלמטה ואינו ידוע
   * מראש — והמנוע קורא אותם דרך המפתח עם הקידומת.
   */
  customFeatures: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        label: z.string().min(1).max(24),
        value: z.boolean(),
      }),
    )
    .max(12)
    .optional(),
  condition: z.enum(["new", "renovated", "good", "needs_renovation"]).optional(),
  priceAgorot: MoneyAgorotSchema.optional(),
  priceFlexible: z.boolean().optional(),
  /**
   * מועד כניסה/מסירה — **צורת התשובה, לא רק התאריך.**
   *
   * תאריך מלוח לבדו לא מתאר את השוק: רוב הנכסים נמסרים "מיידי",
   * "גמיש", "בתיאום עם השוכר" או "החל מ-" — ומי שנאלץ לבחור יום
   * מדויק בחר יום שקרי, והמערכת התאימה לפיו. לכן המצב הוא השדה,
   * והתאריך נלווה אליו רק כשהוא באמת קיים.
   *
   * `on_date` = מסירה בתאריך נקוב · `from_date` = פנוי החל מ-,
   * ומאוחר יותר גם כן · `immediate` = אפשר להיכנס עכשיו ·
   * `flexible` = ייקבע בתיאום, בלי מחויבות לתאריך.
   */
  entryType: z.enum(["immediate", "on_date", "from_date", "flexible"]).optional(),
  /** רלוונטי ל-`on_date` ו-`from_date` בלבד. */
  entryDate: z.coerce.date().optional(),
  /** הניואנס שאין לו שדה: "לאחר פינוי השוכר במאי", "בכפוף למשכנתה". */
  entryNote: z.string().max(160).optional(),
  exclusive: z.boolean().optional(),
  exclusiveUntil: z.coerce.date().optional(),
  /*
   * מיקום — WGS84 תמיד. שני השדות הולכים יחד: קו רוחב בלי אורך אינו
   * נקודה, והשרת דוחה חצי מיקום במקום לשמור אותו ולהיראות תקין.
   */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  /** pin = סומן ידנית · geocode = נגזר מהכתובת. */
  locationSource: z.enum(["pin", "geocode"]).optional(),
});
export type PropertyFields = z.infer<typeof PropertyFieldsSchema>;

export const PropertySchema = PropertyFieldsSchema.extend({
  id: IdSchema,
  tenantId: IdSchema,
  status: PropertyStatusSchema,
  ownerContactId: IdSchema.optional(),
  marketingTitle: z.string().max(160).optional(),
  marketingDescription: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
  /** מאפיינים נדירים/עתידיים — לא נכנסים כעמודות עד שיש להם שימוש בהתאמות. */
  attributes: z.record(z.string(), z.unknown()).default({}),
  readinessScore: z.number().int().min(0).max(100),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Property = z.infer<typeof PropertySchema>;

/**
 * תשעת השדות שמהם נגזרת מוכנות הנכס — **רשימה אחת לכל המערכת.**
 *
 * ## למה דווקא התשעה האלה
 *
 * חבילת העיצוב נוקבת בהם בשמם (SPEC-3b §4) ומוסיפה כלל: „That count,
 * the grid below and the percentage above MUST agree. Never three
 * numbers for one listing”. הרשימה שקדמה להם הייתה אחרת — עיר, סוג
 * נכס וסוג עסקה נספרו בה, תמונות ובעל הנכס לא — והציון היה משוקלל
 * (80% לשדות החובה, 10% לכותרת, 10% לתיאור). כלומר „10 מתוך 10 שדות
 * מלאים” הופיע לצד „90%”, ושתי השורות סתרו זו את זו על המסך.
 *
 * עכשיו הציון הוא בדיוק ‎`filled / 9`‎, ולכן שלושת המספרים שהמסמך
 * מדבר עליהם הם אותו מספר בשלוש צורות. **בעל הפלטפורמה אישר את
 * המעבר במפורש**, כולל המשמעות שלו: ציוני מוכנות של נכסים קיימים
 * זזים — נכס בלי תמונות או בלי פרטי בעלים יורד, ונכס שקיבל ניקוד
 * על עיר וסוג נכס עולה.
 *
 * ## שלושה מהם אינם שדות תוכן
 *
 * ‎`images`, `marketingDescription` ו-`owner` אינם ב-`PropertyFields`:
 * הראשון הוא מדיה, השני טקסט שיווקי והשלישי איש קשר מקושר. הם
 * נמסרים ל-`computeReadiness` בנפרד, ומופיעים כאן כדי שהרשימה תהיה
 * **תשעה** — המכנה שהמסך מדפיס נגזר מאורכה, ולא נכתב קשיח.
 */
export const PROPERTY_READINESS_FIELDS = [
  "priceAgorot",
  "areaSqm",
  "rooms",
  "floor",
  "hasElevator",
  "hasParking",
  "images",
  "marketingDescription",
  "owner",
] as const;
export type PropertyReadinessField = (typeof PROPERTY_READINESS_FIELDS)[number];

/**
 * שמות התשעה בעברית — **המקור היחיד**, לרשת השדות שבכרטיס ולכל
 * מקום שמונה חוסרים („חסרים: מחיר, תמונות”).
 *
 * מיפוי שני היה נפרד ביום שהרשימה משתנה, ואז המתווך היה רואה מפתח
 * באנגלית באחד המסכים.
 */
export const PROPERTY_READINESS_LABELS: Record<PropertyReadinessField, string> = {
  priceAgorot: "מחיר",
  areaSqm: 'שטח במ"ר',
  rooms: "חדרים",
  floor: "קומה",
  hasElevator: "מעלית",
  hasParking: "חניה",
  images: "תמונות",
  marketingDescription: "תיאור",
  owner: "בעל הנכס",
};

/**
 * תווית לשדה מוכנות שהגיע כמחרוזת — מה-DTO, שאינו נושא את הטיפוס.
 *
 * המפה עצמה נשארת ‎`Record<PropertyReadinessField, string>`‎ כדי
 * שהוספת שדה עשירי תפיל את הקומפילציה עד שתינתן לו תווית; הנגישה
 * הזאת היא הגשר לצד הקורא, ולא הרפיה של הדרישה.
 */
export function readinessFieldLabel(field: string): string {
  return PROPERTY_READINESS_LABELS[field as PropertyReadinessField] ?? field;
}
