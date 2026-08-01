import type { PropertyFields } from "../schemas/property.js";

/**
 * חילוץ שדות נכס מתמלול עברי (אפיון §6) — מנוע חוקים דטרמיניסטי.
 *
 * זו שכבת הבסיס: מהירה, חינמית, צפויה וניתנת לבדיקה. בפרודקשן ספק LLM
 * ירוץ מעליה (ExtractionProvider ב-API) וישלים מקרים מורכבים; החוקים
 * נשארים כ-Fallback וכרשת ביקורת על תוצרי ה-LLM.
 */

export const CITIES = [
  "בני ברק",
  "ירושלים",
  "תל אביב",
  "בית שמש",
  "פתח תקווה",
  "חיפה",
  "אלעד",
  "מודיעין עילית",
  "ביתר עילית",
  "אשדוד",
  "רמת גן",
  "גבעת שמואל",
  "רחובות",
  "נתניה",
  "צפת",
  "טבריה",
  "באר שבע",
  "רכסים",
  "קרית ספר",
] as const;

export const HEB_NUM: Record<string, number> = {
  אחד: 1, שניים: 2, שני: 2, שלושה: 3, שלוש: 3, ארבעה: 4, ארבע: 4,
  חמישה: 5, חמש: 5, שישה: 6, שש: 6, שבעה: 7, שבע: 7, שמונה: 8,
};

export function parseNumberWord(raw: string): number | undefined {
  const asNumber = Number(raw.replace(",", "."));
  if (!Number.isNaN(asNumber)) return asNumber;
  return HEB_NUM[raw.trim()];
}

export interface ExtractionResult {
  fields: PropertyFields;
  /** ביטויים שזוהו — לשקיפות מול המתווך ("ממה הבנו כל שדה") */
  evidence: Partial<Record<keyof PropertyFields, string>>;
}

export function extractPropertyFromTranscript(transcript: string): ExtractionResult {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const fields: PropertyFields = {};
  const evidence: ExtractionResult["evidence"] = {};

  // --- עיר ---
  for (const city of CITIES) {
    if (text.includes(city)) {
      fields.city = city;
      evidence.city = city;
      break;
    }
  }

  // --- חדרים: "3 חדרים", "3.5 חדרים", "שלושה חדרים", "3 וחצי חדרים", "דירת 4" ---
  const roomsMatch =
    /(?<num>\d+(?:[.,]5)?|[א-ת]+)(?:\s+וחצי)?\s+חדרים/u.exec(text) ??
    /דירת\s+(?<num>\d+(?:[.,]5)?)/u.exec(text);
  if (roomsMatch?.groups?.["num"] !== undefined) {
    let rooms = parseNumberWord(roomsMatch.groups["num"]);
    if (rooms !== undefined && roomsMatch[0].includes("וחצי")) rooms += 0.5;
    if (rooms !== undefined && rooms >= 1 && rooms <= 20) {
      fields.rooms = rooms;
      evidence.rooms = roomsMatch[0];
    }
  }

  // --- רחוב: "רחוב הרב שך", "ברחוב רבי עקיבא 10" ---
  const streetMatch = /ב?רחוב\s+(?<street>[א-ת"״׳'\d ]+?)(?=,| קומה| בקומה| עם| בלי| מחיר| ב?עיר|\.|$)/u.exec(text);
  if (streetMatch?.groups?.["street"]) {
    fields.street = streetMatch.groups["street"].trim();
    evidence.street = streetMatch[0];
  }

  // --- קומה: "קומה 2 מתוך 4" ---
  const floorMatch = /קומה\s+(?<floor>\d+|קרקע)(?:\s+מתוך\s+(?<total>\d+))?/u.exec(text);
  if (floorMatch?.groups?.["floor"] !== undefined) {
    fields.floor = floorMatch.groups["floor"] === "קרקע" ? 0 : Number(floorMatch.groups["floor"]);
    evidence.floor = floorMatch[0];
    if (floorMatch.groups["total"] !== undefined) {
      fields.totalFloors = Number(floorMatch.groups["total"]);
    }
  }

  // --- שטח: "68 מטר", '95 מ"ר' ---
  const areaMatch = /(?<area>\d{2,4})\s*(?:מטר|מ["״]ר)/u.exec(text);
  if (areaMatch?.groups?.["area"] !== undefined) {
    fields.areaSqm = Number(areaMatch.groups["area"]);
    evidence.areaSqm = areaMatch[0];
  }

  // --- מחיר: "2.15 מיליון", "מיליון וחצי", "850 אלף", "6,500 שקל" ---
  const priceMillion = /(?<n>\d+(?:[.,]\d+)?)\s*מיליון/u.exec(text);
  const millionHalf = /מיליון וחצי/u.exec(text);
  const priceThousand = /(?<n>\d{2,4})\s*אלף/u.exec(text);
  const priceShekel = /(?<n>\d[\d,]{2,})\s*(?:שקל|ש["״]ח|₪)/u.exec(text);
  if (priceMillion?.groups?.["n"] !== undefined) {
    fields.priceAgorot = Math.round(Number(priceMillion.groups["n"].replace(",", ".")) * 100_000_000);
    evidence.priceAgorot = priceMillion[0];
  } else if (millionHalf) {
    fields.priceAgorot = 150_000_000;
    evidence.priceAgorot = millionHalf[0];
  } else if (priceThousand?.groups?.["n"] !== undefined) {
    fields.priceAgorot = Number(priceThousand.groups["n"]) * 100_000;
    evidence.priceAgorot = priceThousand[0];
  } else if (priceShekel?.groups?.["n"] !== undefined) {
    fields.priceAgorot = Number(priceShekel.groups["n"].replace(/,/gu, "")) * 100;
    evidence.priceAgorot = priceShekel[0];
  }

  // --- סוג עסקה ---
  if (/להשכרה|שכירות|לשכירות/u.test(text)) {
    fields.dealType = "rent";
    evidence.dealType = "להשכרה";
  } else if (fields.priceAgorot !== undefined && fields.priceAgorot >= 30_000_000) {
    fields.dealType = "sale"; // מחיר בסדר גודל של מכירה
    evidence.dealType = "מחיר בסדר גודל של מכירה";
  } else if (/למכירה|מכירה/u.test(text)) {
    fields.dealType = "sale";
    evidence.dealType = "למכירה";
  }

  // --- סוג נכס ---
  const typeMap: [RegExp, PropertyFields["propertyType"]][] = [
    [/פנטהאוז/u, "penthouse"],
    [/דירת גן/u, "garden_apartment"],
    [/דופלקס/u, "duplex"],
    [/בית פרטי|קוטג/u, "private_house"],
    [/יחידת דיור/u, "unit"],
    [/דירה|דירת/u, "apartment"],
  ];
  for (const [re, type] of typeMap) {
    if (re.test(text)) {
      fields.propertyType = type;
      evidence.propertyType = re.source;
      break;
    }
  }

  // --- מאפיינים: "עם/יש X" ⇒ true, "בלי/אין X" ⇒ false, לא הוזכר ⇒ לא ידוע ---
  const featureMap: [string, "hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage"][] = [
    ["מעלית", "hasElevator"],
    ["חניה", "hasParking"],
    ["מרפסת", "hasBalcony"],
    ['ממ"ד', "hasSafeRoom"],
    ["ממ״ד", "hasSafeRoom"],
    ["מחסן", "hasStorage"],
  ];
  for (const [word, field] of featureMap) {
    if (new RegExp(`(?:בלי|אין|ללא)\\s+${word}`, "u").test(text)) {
      fields[field] = false;
      evidence[field] = `בלי ${word}`;
    } else if (new RegExp(`(?:עם|יש|כולל)\\s+${word}`, "u").test(text) || text.includes(`ו${word}`)) {
      fields[field] = true;
      evidence[field] = word;
    }
  }

  // --- מצב הנכס ---
  if (/משופצת|משופץ|אחרי שיפוץ/u.test(text)) {
    fields.condition = "renovated";
    evidence.condition = "משופצת";
  } else if (/חדשה מקבלן|דירה חדשה/u.test(text)) {
    fields.condition = "new";
  } else if (/דורשת שיפוץ|צריך שיפוץ/u.test(text)) {
    fields.condition = "needs_renovation";
  }

  // --- בלעדיות ---
  if (/בלעדיות/u.test(text)) {
    fields.exclusive = true;
    evidence.exclusive = "בלעדיות";
  }

  // --- כניסה מיידית ---
  if (/כניסה מיידית|פינוי מיידי/u.test(text)) {
    fields.entryDate = new Date();
    evidence.entryDate = "כניסה מיידית";
  }

  return { fields, evidence };
}
