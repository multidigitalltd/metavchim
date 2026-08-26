import type { Prisma, Property as PropertyRow } from "@prisma/client";
import { normalizeCustomFeatures, type CustomFeature, type PropertyFields } from "@metavchim/shared";

/**
 * המרה מפורשת שורת DB ⇄ DTO — אין החזרת שורות גולמיות ללקוח
 * (BigInt/Decimal לא נצמדים ל-JSON, וזה גם שער ה-allowlist של השדות).
 */
/**
 * הסף שממנו נכס נחשב „מוכן לשיווק” — **מספר אחד לכל הפולטים.**
 *
 * `property.ready` נפלט עד כה רק ביצירה, והסף היה כתוב שם כליטרל.
 * מרגע שתמונה יכולה לחצות אותו (תמונות הן אחד מתשעת שדות המוכנות),
 * יש שלושה מקומות שצריכים לשאול את אותה שאלה — יצירה, עדכון ושינוי
 * מדיה — ושלושה ליטרלים היו נפרדים ביום שהסף משתנה.
 */
export const PROPERTY_READY_SCORE = 80;

export function rowToFields(row: PropertyRow): PropertyFields {
  return {
    city: row.city ?? undefined,
    neighborhood: row.neighborhood ?? undefined,
    street: row.street ?? undefined,
    houseNumber: row.houseNumber ?? undefined,
    propertyType: (row.propertyType as PropertyFields["propertyType"]) ?? undefined,
    dealType: (row.dealType as PropertyFields["dealType"]) ?? undefined,
    rooms: row.rooms === null ? undefined : Number(row.rooms),
    areaSqm: row.areaSqm ?? undefined,
    floor: row.floor ?? undefined,
    totalFloors: row.totalFloors ?? undefined,
    hasElevator: row.hasElevator ?? undefined,
    hasParking: row.hasParking ?? undefined,
    hasBalcony: row.hasBalcony ?? undefined,
    hasSafeRoom: row.hasSafeRoom ?? undefined,
    hasStorage: row.hasStorage ?? undefined,
    condition: (row.condition as PropertyFields["condition"]) ?? undefined,
    priceAgorot: row.priceAgorot === null ? undefined : Number(row.priceAgorot),
    priceFlexible: row.priceFlexible ?? undefined,
    entryType: (row.entryType as PropertyFields["entryType"]) ?? undefined,
    entryDate: row.entryDate ?? undefined,
    entryNote: row.entryNote ?? undefined,
    exclusive: row.exclusive ?? undefined,
    exclusiveUntil: row.exclusiveUntil ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationSource: (row.locationSource as "pin" | "geocode" | null) ?? undefined,
    /*
     * המאפיינים שהמשרד הוסיף יושבים ב-`attributes` ולא בעמודות
     * ייעודיות — הקטלוג נבנה מלמטה ואינו ידוע בזמן המיגרציה. הקריאה
     * מתגוננת: JSON שנכתב ביד או נשאר מגרסה קודמת לא יפיל את
     * החישוב, הוא רק ייקרא כ"אין מאפיינים מותאמים".
     */
    customFeatures: readCustomFeatures(row.attributes),
  };
}

/** קריאה מתגוננת מעמודת ה-JSON. ראו ההסבר למעלה. */
export function readCustomFeatures(attributes: unknown): CustomFeature[] {
  if (attributes === null || typeof attributes !== "object") return [];
  const raw = (attributes as Record<string, unknown>)["customFeatures"];
  if (!Array.isArray(raw)) return [];
  const usable = raw.filter(
    (item): item is { label: string; value: boolean } =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { value?: unknown }).value === "boolean",
  );
  return normalizeCustomFeatures(usable);
}

export interface PropertyDto extends PropertyFields {
  id: string;
  status: string;
  marketingTitle?: string;
  marketingDescription?: string;
  internalNotes?: string;
  readinessScore: number;
  missingFields: string[];
  /** בעל הנכס (המוכר) — מוצג בעמוד הנכס ומזין את התיק המאוחד */
  /** בעל הנכס — הוא המוכר או המשכיר, ולכן כרטיס מלא כמו של קונה */
  ownerContact?: { id: string; name: string; phone: string; email?: string };
  /**
   * הנכס בארכיון.
   *
   * דגל ולא תאריך: המסך צריך לדעת שהנכס בארכיון כדי להציג מחיקה
   * לצמיתות, ולא צריך לדעת מתי. סטטוס `archived` לבדו אינו מספיק —
   * אפשר להגיע אליו גם בלי מחיקה רכה, והמסך היה מציע מחיקה שהשרת
   * דוחה.
   */
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function fieldsToColumns(fields: Partial<PropertyFields>): Prisma.PropertyUpdateInput {
  const out: Prisma.PropertyUpdateInput = {};
  if ("city" in fields) out.city = fields.city ?? null;
  if ("neighborhood" in fields) out.neighborhood = fields.neighborhood ?? null;
  if ("street" in fields) out.street = fields.street ?? null;
  if ("houseNumber" in fields) out.houseNumber = fields.houseNumber ?? null;
  if ("propertyType" in fields) out.propertyType = fields.propertyType ?? null;
  if ("dealType" in fields) out.dealType = fields.dealType ?? null;
  if ("rooms" in fields) out.rooms = fields.rooms ?? null;
  if ("areaSqm" in fields) out.areaSqm = fields.areaSqm ?? null;
  if ("floor" in fields) out.floor = fields.floor ?? null;
  if ("totalFloors" in fields) out.totalFloors = fields.totalFloors ?? null;
  if ("hasElevator" in fields) out.hasElevator = fields.hasElevator ?? null;
  if ("hasParking" in fields) out.hasParking = fields.hasParking ?? null;
  if ("hasBalcony" in fields) out.hasBalcony = fields.hasBalcony ?? null;
  if ("hasSafeRoom" in fields) out.hasSafeRoom = fields.hasSafeRoom ?? null;
  if ("hasStorage" in fields) out.hasStorage = fields.hasStorage ?? null;
  if ("condition" in fields) out.condition = fields.condition ?? null;
  if ("priceAgorot" in fields)
    out.priceAgorot = fields.priceAgorot === undefined ? null : BigInt(fields.priceAgorot);
  if ("priceFlexible" in fields) out.priceFlexible = fields.priceFlexible ?? null;
  if ("entryType" in fields) out.entryType = fields.entryType ?? null;
  if ("entryDate" in fields) out.entryDate = fields.entryDate ?? null;
  if ("entryNote" in fields) out.entryNote = fields.entryNote ?? null;
  if ("exclusive" in fields) out.exclusive = fields.exclusive ?? null;
  if ("exclusiveUntil" in fields) out.exclusiveUntil = fields.exclusiveUntil ?? null;
  /*
   * המיקום נכתב כיחידה אחת: קו רוחב בלי אורך אינו נקודה, ושמירת חצי
   * ממנו הייתה יוצרת נכס ש"יש לו מיקום" ואי אפשר להציג אותו.
   */
  if ("latitude" in fields || "longitude" in fields) {
    const lat = fields.latitude ?? null;
    const lon = fields.longitude ?? null;
    const both = lat !== null && lon !== null;
    out.latitude = both ? lat : null;
    out.longitude = both ? lon : null;
    out.locationSource = both ? (fields.locationSource ?? "pin") : null;
  }
  /*
   * המאפיינים המותאמים נכתבים לתוך `attributes` דרך הנרמול, ולא
   * כפי שהגיעו: כפילות כתיב שנשמרת ("מיזוג" לצד "מיזוג-מרכזי")
   * מייצרת שני מפתחות שקונה אחד ידרוש ואחר לא ימצא. הנרמול הוא
   * מה שהופך את התכונה לאמינה, ולכן הוא בשער הכתיבה ולא במסך.
   */
  if ("customFeatures" in fields) {
    out.attributes = {
      customFeatures: normalizeCustomFeatures(fields.customFeatures ?? []),
    } as unknown as Prisma.InputJsonValue;
  }
  return out;
}
