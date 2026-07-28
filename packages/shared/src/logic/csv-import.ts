import type { PropertyFields } from "../schemas/property.js";
import type { PropertyType } from "../schemas/property.js";

/**
 * מיפוי CSV לשדות נכס (docs/08 §6 — Onboarding). מנתח CSV פשוט
 * (מפריד פסיקים, תומך בגרשיים) וממפה כותרות עבריות נפוצות לשדות.
 * טהור וניתן לבדיקה — הפרונט קורא לו לפני שליחה לשרת.
 */

/** מיפוי כותרת (מנורמלת) → שם שדה */
const HEADER_MAP: Record<string, keyof PropertyFields | "marketingTitle"> = {
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
};

const PROPERTY_TYPE_MAP: Record<string, PropertyType> = {
  דירה: "apartment",
  "דירת גן": "garden_apartment",
  פנטהאוז: "penthouse",
  דופלקס: "duplex",
  "בית פרטי": "private_house",
  מגרש: "plot",
  מסחרי: "commercial",
};

export interface ParsedRow {
  fields: Partial<PropertyFields>;
  marketingTitle?: string;
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
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * מפרק CSV מלא (שורת כותרת + שורות נתונים) לרשומות נכס.
 * מחזיר שורות מפורשות + כותרות שלא זוהו (לשקיפות מול המתווך).
 */
export function parsePropertiesCsv(csv: string): {
  rows: ParsedRow[];
  unmappedHeaders: string[];
} {
  const lines = csv
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = parseCsvLine(lines[0] ?? "");
  const mapped = headers.map((h) => HEADER_MAP[h.trim()]);
  const unmappedHeaders = headers.filter((h, i) => mapped[i] === undefined);

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i] ?? "");
    const fields: Partial<PropertyFields> = {};
    let marketingTitle: string | undefined;

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = (cells[col] ?? "").trim();
      if (!target || raw === "") return;

      if (target === "marketingTitle") {
        marketingTitle = raw;
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
    rows.push({ fields, marketingTitle });
  }

  return { rows, unmappedHeaders };
}
