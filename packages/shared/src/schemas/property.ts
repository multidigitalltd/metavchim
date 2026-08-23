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
  "plot",
  "commercial",
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

/** השדות שבלעדיהם נכס לא נחשב "מוכן לשיווק" — הבסיס לציון המוכנות. */
export const PROPERTY_REQUIRED_FOR_MARKETING = [
  "city",
  "propertyType",
  "dealType",
  "rooms",
  "areaSqm",
  "priceAgorot",
  "floor",
  "hasElevator",
  "hasParking",
  /*
   * המצב ולא התאריך: "מיידי" ו"גמיש" הן תשובות מלאות לשאלת המסירה,
   * ונכס שנענה בהן מוכן לשיווק בדיוק כמו נכס עם תאריך נקוב. הדרישה
   * הקודמת ל-`entryDate` הורידה להם את ציון המוכנות על שדה שאין לו
   * ערך אמיתי במקרה שלהם.
   */
  "entryType",
] as const satisfies readonly (keyof PropertyFields)[];
