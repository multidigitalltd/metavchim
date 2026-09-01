import type { PropertyFields } from "../schemas/property.js";
import type { PropertyType } from "../schemas/property.js";

/**
 * מיפוי CSV לשדות נכס (docs/08 §6 — Onboarding). מנתח CSV פשוט
 * (מפריד פסיקים, תומך בגרשיים) וממפה כותרות עבריות נפוצות לשדות.
 * טהור וניתן לבדיקה — הפרונט קורא לו לפני שליחה לשרת.
 */

/**
 * נרמול כותרת לפני ההשוואה — משותף לשלושת המפרקים (נכסים, קונים,
 * לידים). גיליון אמיתי לא מגיע נקי: מרכאות מייצוא, כוכבית של
 * "חובה", ניקוד, רווח כפול ורווח קשיח. כל אחד מהם לבדו הופך
 * כותרת מוכרת ללא-מוכרת.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/u, "")
    .replace(/["'*׳״]/gu, "")
    .replace(/[֑-ׇ]/gu, "") // ניקוד וטעמים
    .replace(/[\u00A0\s]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** "כן"/"יש"/"true"/"1"/"v" → true · "לא"/"אין"/"0" → false · אחרת לא ידוע. */
export function parseYesNo(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase();
  if (["כן", "יש", "true", "1", "v", "x", "✓", "yes", "קיים", "קיימת"].includes(value)) return true;
  if (["לא", "אין", "false", "0", "no", "-", "—"].includes(value)) return false;
  return undefined;
}

/** מכירה/השכרה בכל הכתיבים המקובלים — משותף לנכסים, לקונים וללידים. */
export const DEAL_TYPE_MAP: Record<string, "sale" | "rent"> = {
  מכירה: "sale",
  קנייה: "sale",
  קניה: "sale",
  רכישה: "sale",
  לקנות: "sale",
  קונה: "sale",
  למכירה: "sale",
  מכר: "sale",
  sale: "sale",
  buy: "sale",
  השכרה: "rent",
  להשכרה: "rent",
  שכירות: "rent",
  לשכור: "rent",
  שוכר: "rent",
  rent: "rent",
};

/**
 * נורמליזציה של טלפון ישראלי ל-E.164 (‎+972…). מקבל 050-1234567,
 * 03 1234567, 972501234567 וכד'. מחזיר undefined אם לא ניתן לנרמל —
 * ההחלטה הסופית (דחיית השורה) נעשית בוולידציה בצד השרת.
 *
 * ## האפס שאקסל בולע
 *
 * תא שנראה כמו מספר מקבל באקסל טיפול של מספר, והאפס המוביל נעלם:
 * ‎"0583216016"‎ נשמר בקובץ כ-‎583216016‎. זה קורה בלי שהמשתמש עשה
 * דבר — מספיק שהעמודה לא הוגדרה כטקסט — והוא רואה את זה רק כשכל
 * הקובץ נדחה.
 *
 * לכן מספר לאומי **בלי** אפס מוביל מתקבל: הבדיקה `[2-9]\d{7,8}`
 * היא אותה בדיקה שחלה על שאר הצורות, ולכן ההשלמה אינה מרחיבה את
 * מה שנחשב תקין — היא רק מזהה את אותו מספר בכתיב שאקסל השאיר.
 * מספר שאינו ישראלי אינו עובר אותה וממשיך להידחות.
 */
export function normalizeIsraeliPhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d+]/gu, "");
  let national: string;
  if (digits.startsWith("+972")) national = digits.slice(4);
  else if (digits.startsWith("972")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  // בלי אפס מוביל — אקסל הסיר אותו; התקינות נבדקת מיד למטה
  else national = digits;
  if (!/^[2-9]\d{7,8}$/u.test(national)) return undefined;
  return `+972${national}`;
}

type PropertyColumn =
  | keyof PropertyFields
  | "marketingTitle"
  | "marketingDescription"
  | "internalNotes"
  | "status"
  | "ownerName"
  | "ownerPhone"
  /** "רבי עקיבא 10" בעמודה אחת — מפוצל לרחוב + מספר בית */
  | "address";

/**
 * מיפוי כותרת (מנורמלת) → שם שדה.
 *
 * הרשימה ארוכה בכוונה, כמו אצל הקונים: כל משרד מגיע עם הגיליון
 * שלו, ולכל שדה יש כמה שמות מקובלים בעברית ובאנגלית. כותרת שלא
 * זוהתה מדווחת למסך — אבל עמודה שנזרקת היא נתונים שאבדו, וזה מה
 * שהרשימה באה למנוע (דיווח המשתמש: "זה לא עובד מספיק טוב").
 */
const HEADER_MAP: Record<string, PropertyColumn> = {
  // --- מיקום ---
  עיר: "city",
  ישוב: "city",
  יישוב: "city",
  city: "city",
  שכונה: "neighborhood",
  neighborhood: "neighborhood",
  רחוב: "street",
  street: "street",
  כתובת: "address",
  "כתובת מלאה": "address",
  "כתובת הנכס": "address",
  address: "address",
  "מספר בית": "houseNumber",
  "מס בית": "houseNumber",
  בית: "houseNumber",
  // --- מידות ---
  חדרים: "rooms",
  "מספר חדרים": "rooms",
  "מס חדרים": "rooms",
  rooms: "rooms",
  שטח: "areaSqm",
  'מ"ר': "areaSqm",
  מר: "areaSqm", // אחרי הסרת גרשיים מ-מ"ר
  מטר: "areaSqm",
  "שטח במר": "areaSqm",
  "שטח בנוי": "areaSqm",
  גודל: "areaSqm",
  area: "areaSqm",
  size: "areaSqm",
  קומה: "floor",
  floor: "floor",
  "מתוך קומות": "totalFloors",
  קומות: "totalFloors",
  "קומות בבניין": "totalFloors",
  "מספר קומות": "totalFloors",
  // --- מחיר ועסקה ---
  מחיר: "priceAgorot",
  "מחיר מבוקש": "priceAgorot",
  "מחיר שיווק": "priceAgorot",
  "שכר דירה": "priceAgorot",
  price: "priceAgorot",
  "סוג עסקה": "dealType",
  עסקה: "dealType",
  "מכירה/השכרה": "dealType",
  "למכירה/להשכרה": "dealType",
  // --- סוג ומצב ---
  סוג: "propertyType",
  "סוג נכס": "propertyType",
  "סוג הנכס": "propertyType",
  type: "propertyType",
  "property type": "propertyType",
  סטטוס: "status",
  status: "status",
  מצב: "condition",
  "מצב הנכס": "condition",
  // --- מאפיינים ---
  מעלית: "hasElevator",
  חניה: "hasParking",
  חנייה: "hasParking",
  מרפסת: "hasBalcony",
  'ממ"ד': "hasSafeRoom",
  ממד: "hasSafeRoom",
  מחסן: "hasStorage",
  בלעדיות: "exclusive",
  // --- בעל הנכס ---
  בעלים: "ownerName",
  "שם בעלים": "ownerName",
  "בעל הנכס": "ownerName",
  "שם המוכר": "ownerName",
  מוכר: "ownerName",
  משכיר: "ownerName",
  owner: "ownerName",
  "טלפון בעלים": "ownerPhone",
  "טלפון בעל הנכס": "ownerPhone",
  "טלפון מוכר": "ownerPhone",
  "טלפון המוכר": "ownerPhone",
  "owner phone": "ownerPhone",
  // --- טקסטים ---
  כותרת: "marketingTitle",
  "כותרת שיווקית": "marketingTitle",
  title: "marketingTitle",
  תיאור: "marketingDescription",
  "תיאור שיווקי": "marketingDescription",
  "תיאור הנכס": "marketingDescription",
  description: "marketingDescription",
  הערות: "internalNotes",
  הערה: "internalNotes",
  "הערות פנימיות": "internalNotes",
  notes: "internalNotes",
};

/** תוויות השדות שאפשר למפות אליהם ידנית במסך הייבוא. */
export const PROPERTY_TARGET_LABELS: Record<string, string> = {
  city: "עיר",
  neighborhood: "שכונה",
  street: "רחוב",
  address: "כתובת מלאה (רחוב + מספר)",
  houseNumber: "מספר בית",
  rooms: "חדרים",
  areaSqm: 'שטח (מ"ר)',
  floor: "קומה",
  totalFloors: "מתוך קומות",
  priceAgorot: "מחיר",
  dealType: "סוג עסקה",
  propertyType: "סוג נכס",
  status: "סטטוס",
  condition: "מצב הנכס",
  hasElevator: "מעלית",
  hasParking: "חניה",
  hasBalcony: "מרפסת",
  hasSafeRoom: 'ממ"ד',
  hasStorage: "מחסן",
  exclusive: "בלעדיות",
  ownerName: "בעל הנכס",
  ownerPhone: "טלפון בעל הנכס",
  marketingTitle: "כותרת שיווקית",
  marketingDescription: "תיאור שיווקי",
  internalNotes: "הערות פנימיות",
};

/** מכסה את כל ערכי PropertyTypeSchema — ייצוא/ייבוא ללא אובדן (Round-trip). */
export const PROPERTY_TYPE_MAP: Record<string, PropertyType> = {
  דירה: "apartment",
  "דירת גן": "garden_apartment",
  פנטהאוז: "penthouse",
  דופלקס: "duplex",
  "בית פרטי": "private_house",
  "דו-משפחתי": "two_family",
  סטודיו: "studio",
  "יחידת דיור": "unit",
  "טאבו משותף": "shared_tabu",
  "דירה מתאימה לחלוקה": "divisible_apartment",
  "דירת נכה": "accessible_apartment",
  מגרש: "plot",
  מסחרי: "commercial",
  אחר: "other",
};

export type PropertyStatusValue = "draft" | "active" | "on_hold" | "sold" | "rented" | "archived";

/** סטטוס נכס בעברית ↔ ערך — לשימור סטטוס בייבוא-חזרה של קובץ מיוצא. */
export const PROPERTY_STATUS_MAP: Record<string, PropertyStatusValue> = {
  טיוטה: "draft",
  פעיל: "active",
  בהמתנה: "on_hold",
  נמכר: "sold",
  הושכר: "rented",
  בארכיון: "archived",
};

export interface ParsedRow {
  fields: Partial<PropertyFields>;
  marketingTitle?: string;
  marketingDescription?: string;
  internalNotes?: string;
  ownerName?: string;
  ownerPhone?: string;
  status?: PropertyStatusValue;
}

/**
 * הסרת קידומת ניטרול-נוסחה (') שהוספה בייצוא — הופכת את הניטרול להפיך:
 * תא שיוצא "'=..." חוזר בייבוא ל-"=..." המקורי.
 */
export function unsanitizeFormulaCell(value: string): string {
  return /^'[=+\-@]/u.test(value) ? value.slice(1) : value;
}

/**
 * המרת מחיר בש"ח לאגורות עם שמירה על נקודה עשרונית: "6,000.00" → 600000
 * (6,000₪), לא 60,000,000. פסיק = מפריד אלפים; נקודה = עשרוני (עד 2 ספרות).
 * מחזיר undefined לערך שאינו מספר תקין — עדיף לדלג מאשר לייבא סכום שגוי.
 */
export function parseShekelsToAgorot(raw: string): number | undefined {
  const cleaned = raw.replace(/[₪\s"']/gu, "").replace(/,/gu, "");
  if (!/^\d+(\.\d{1,2})?$/u.test(cleaned)) return undefined;
  const shekels = Number(cleaned);
  return shekels > 0 ? Math.round(shekels * 100) : undefined;
}

/** פירוק שורת CSV אחת עם תמיכה בגרשיים ופסיקים בתוך שדה. */
export function parseCsvLine(line: string): string[] {
  const records = parseCsvRecords(line);
  return records[0] ?? [""];
}

/**
 * טוקנייזר CSV מלא: הולך על כל הקובץ ומכבד גרשיים — שורה חדשה בתוך תא
 * מצוטט נשארת חלק מהתא (ולא הופכת לרשומה מזויפת). זה מה שמאפשר
 * Round-trip של כותרות/הערות מרובות-שורות שיוצאו עם quoting תקין.
 */
export function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  let cellStarted = false;

  const pushCell = (): void => {
    row.push(current.trim());
    current = "";
    cellStarted = false;
  };
  const pushRow = (): void => {
    pushCell();
    // שורות ריקות לגמרי מדולגות
    if (row.length > 1 || (row[0] ?? "") !== "") records.push(row);
    row = [];
  };

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      cellStarted = true;
    } else if (char === "," && !inQuotes) {
      pushCell();
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      pushRow();
    } else {
      current += char;
      cellStarted = true;
    }
  }
  if (cellStarted || row.length > 0) pushRow();
  return records;
}

/**
 * מפרק CSV מלא (שורת כותרת + שורות נתונים) לרשומות נכס.
 * מחזיר שורות מפורשות + כותרות שלא זוהו (לשקיפות מול המתווך).
 */
/** "רבי עקיבא 10" / "רבי עקיבא 10, בני ברק" → רחוב + מספר בית. */
function parseAddress(raw: string, fields: Partial<PropertyFields>): void {
  // החלק שאחרי פסיק הוא עיר — רק כשאין כבר עיר מעמודה ייעודית
  const [addressPart, cityPart] = raw.split(",", 2).map((p) => p.trim());
  const match = /^(?<street>.*?)\s+(?<number>\d+[א-ת]?)$/u.exec(addressPart ?? "");
  if (match?.groups) {
    fields.street = match.groups["street"];
    fields.houseNumber = match.groups["number"];
  } else if (addressPart) {
    fields.street = addressPart;
  }
  if (cityPart && fields.city === undefined) fields.city = cityPart;
}

const CONDITION_MAP: Record<string, PropertyFields["condition"]> = {
  "חדש מקבלן": "new",
  חדש: "new",
  משופץ: "renovated",
  משופצת: "renovated",
  "במצב טוב": "good",
  טוב: "good",
  "דורש שיפוץ": "needs_renovation",
  "דורשת שיפוץ": "needs_renovation",
  לשיפוץ: "needs_renovation",
};

const BOOLEAN_TARGETS = new Set<PropertyColumn>([
  "hasElevator",
  "hasParking",
  "hasBalcony",
  "hasSafeRoom",
  "hasStorage",
  "exclusive",
]);

/**
 * מפרק CSV מלא (שורת כותרת + שורות נתונים) לרשומות נכס.
 * מחזיר שורות מפורשות + כותרות שלא זוהו (לשקיפות מול המתווך).
 *
 * `overrides` — מיפוי ידני מהמסך: כותרת (כפי שהיא בקובץ) ⟵ שדה.
 * המתווך רואה עמודה שלא זוהתה, בוחר לאן היא שייכת, והמיפוי גובר
 * על ההיכרות האוטומטית.
 */
export function parsePropertiesCsv(
  csv: string,
  overrides: Record<string, string> = {},
): {
  rows: ParsedRow[];
  unmappedHeaders: string[];
} {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = records[0] ?? [];
  const mapped = headers.map((h) => {
    const override = overrides[h.trim()];
    if (override !== undefined && override !== "") return override as PropertyColumn;
    return HEADER_MAP[normalizeHeader(h)];
  });
  const unmappedHeaders = headers.filter((_h, i) => mapped[i] === undefined);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i] ?? [];
    const fields: Partial<PropertyFields> = {};
    const row: ParsedRow = { fields };

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = unsanitizeFormulaCell((cells[col] ?? "").trim());
      if (!target || raw === "") return;

      if (target === "marketingTitle" || target === "ownerName") {
        row[target] = raw;
      } else if (target === "ownerPhone") {
        /*
         * נרמול ל-E.164 כמו כל טלפון מיובא: `findOrCreateByPhone`
         * מגבב את הערך כפי שהוא, וטלפון עם מקפים היה יוצר איש קשר
         * כפול לבעלים קיים (ביקורת Codex). ערך שאינו ניתן לנרמול
         * מועבר גולמי — השרת מחליט מה לעשות איתו.
         */
        row.ownerPhone = normalizeIsraeliPhone(raw) ?? raw;
      } else if (target === "marketingDescription" || target === "internalNotes") {
        // צירוף ולא דריסה — שתי עמודות הערות בקובץ לא מאבדות אחת את השנייה
        row[target] = row[target] ? `${row[target]} | ${raw}` : raw;
      } else if (target === "status") {
        row.status = PROPERTY_STATUS_MAP[raw];
      } else if (target === "address") {
        parseAddress(raw, fields);
      } else if (target === "propertyType") {
        const type = PROPERTY_TYPE_MAP[raw] ?? PROPERTY_TYPE_MAP[raw.replace(/^דירת?\s+/u, "")];
        if (type) fields.propertyType = type;
      } else if (target === "dealType") {
        const deal = DEAL_TYPE_MAP[normalizeHeader(raw)];
        if (deal) fields.dealType = deal;
      } else if (target === "condition") {
        const condition = CONDITION_MAP[raw.trim()];
        if (condition) fields.condition = condition;
      } else if (BOOLEAN_TARGETS.has(target)) {
        const value = parseYesNo(raw);
        if (value !== undefined) (fields as Record<string, unknown>)[target] = value;
      } else if (target === "rooms") {
        const n = Number(raw.replace(",", "."));
        if (!Number.isNaN(n)) fields.rooms = n;
      } else if (target === "areaSqm" || target === "floor" || target === "totalFloors") {
        // "קומת קרקע" — קומה 0; אחרת מספר
        if (target === "floor" && /קרקע/u.test(raw)) {
          fields.floor = 0;
          return;
        }
        const digits = raw.replace(/[^\d-]/gu, "");
        const n = Number(digits);
        if (digits !== "" && !Number.isNaN(n)) fields[target] = n;
      } else if (target === "priceAgorot") {
        const agorot = parseShekelsToAgorot(raw);
        if (agorot !== undefined) fields.priceAgorot = agorot;
      } else {
        // שדות טקסט: city, neighborhood, street, houseNumber
        (fields as Record<string, unknown>)[target] = raw;
      }
    });

    // ברירת מחדל: סוג עסקה מכירה אם יש מחיר בסדר גודל מתאים
    if (fields.priceAgorot !== undefined && fields.dealType === undefined) {
      fields.dealType = fields.priceAgorot >= 30_000_000 ? "sale" : "rent";
    }
    rows.push(row);
  }

  return { rows, unmappedHeaders };
}
