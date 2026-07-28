import type { PropertyFields } from "../schemas/property.js";
import type { PropertyType } from "../schemas/property.js";

/**
 * מיפוי CSV לשדות נכס (docs/08 §6 — Onboarding). מנתח CSV פשוט
 * (מפריד פסיקים, תומך בגרשיים) וממפה כותרות עבריות נפוצות לשדות.
 * טהור וניתן לבדיקה — הפרונט קורא לו לפני שליחה לשרת.
 */

/** מיפוי כותרת (מנורמלת) → שם שדה */
const HEADER_MAP: Record<string, keyof PropertyFields | "marketingTitle" | "status"> = {
  עיר: "city",
  שכונה: "neighborhood",
  רחוב: "street",
  חדרים: "rooms",
  שטח: "areaSqm",
  'מ"ר': "areaSqm",
  מטר: "areaSqm",
  קומה: "floor",
  מחיר: "priceAgorot",
  כותרת: "marketingTitle",
  סוג: "propertyType",
  סטטוס: "status",
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
export function parsePropertiesCsv(csv: string): {
  rows: ParsedRow[];
  unmappedHeaders: string[];
} {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = records[0] ?? [];
  const mapped = headers.map((h) => HEADER_MAP[h.trim()]);
  const unmappedHeaders = headers.filter((h, i) => mapped[i] === undefined);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i] ?? [];
    const fields: Partial<PropertyFields> = {};
    let marketingTitle: string | undefined;
    let status: PropertyStatusValue | undefined;

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = unsanitizeFormulaCell((cells[col] ?? "").trim());
      if (!target || raw === "") return;

      if (target === "marketingTitle") {
        marketingTitle = raw;
      } else if (target === "status") {
        status = PROPERTY_STATUS_MAP[raw];
      } else if (target === "propertyType") {
        const type = PROPERTY_TYPE_MAP[raw];
        if (type) fields.propertyType = type;
      } else if (target === "rooms") {
        const n = Number(raw.replace(",", "."));
        if (!Number.isNaN(n)) fields.rooms = n;
      } else if (target === "areaSqm" || target === "floor") {
        const n = Number(raw.replace(/[^\d-]/gu, ""));
        if (!Number.isNaN(n)) fields[target] = n;
      } else if (target === "priceAgorot") {
        const agorot = parseShekelsToAgorot(raw);
        if (agorot !== undefined) fields.priceAgorot = agorot;
      } else {
        // שדות טקסט: city, neighborhood, street
        (fields as Record<string, unknown>)[target] = raw;
      }
    });

    // ברירת מחדל: סוג עסקה מכירה אם יש מחיר בסדר גודל מתאים
    if (fields.priceAgorot !== undefined && fields.dealType === undefined) {
      fields.dealType = fields.priceAgorot >= 30_000_000 ? "sale" : "rent";
    }
    rows.push({ fields, marketingTitle, status });
  }

  return { rows, unmappedHeaders };
}
