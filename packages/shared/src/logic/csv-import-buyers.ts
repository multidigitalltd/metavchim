import type { BuyerMaturity } from "../schemas/buyer.js";
import { parseCsvLine, parseShekelsToAgorot } from "./csv-import.js";

/**
 * מיפוי CSV לרשומות קונים (docs/08 §6 — Onboarding): משרד חדש מעלה גם את
 * רשימת הלקוחות הקיימת, לא רק את מלאי הנכסים. טהור וניתן לבדיקה —
 * הפרונט קורא לו לפני שליחה לשרת; הוולידציה המחייבת נשארת בצד השרת.
 */

export interface ParsedBuyerRow {
  name?: string;
  phone?: string;
  cities: string[];
  /** ערך לא מזוהה מועבר כמו-שהוא (string) — השרת ידחה את השורה עם שגיאה ברורה. */
  dealType?: "sale" | "rent" | (string & {});
  budgetMinAgorot?: number;
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  financing?: "cash" | "pre_approved" | "in_process" | "not_started";
  maturity?: BuyerMaturity;
  agentNotes?: string;
}

type BuyerColumn = keyof ParsedBuyerRow;

/** מיפוי כותרת עברית (מנורמלת) → שדה קונה */
const HEADER_MAP: Record<string, BuyerColumn> = {
  שם: "name",
  "שם מלא": "name",
  לקוח: "name",
  טלפון: "phone",
  נייד: "phone",
  עיר: "cities",
  ערים: "cities",
  "סוג עסקה": "dealType",
  עסקה: "dealType",
  תקציב: "budgetMaxAgorot",
  "תקציב מקסימלי": "budgetMaxAgorot",
  "תקציב מינימלי": "budgetMinAgorot",
  חדרים: "roomsMin",
  "חדרים מינימום": "roomsMin",
  "חדרים מקסימום": "roomsMax",
  מימון: "financing",
  בשלות: "maturity",
  הערות: "agentNotes",
};

export const DEAL_TYPE_MAP: Record<string, "sale" | "rent"> = {
  מכירה: "sale",
  קנייה: "sale",
  קניה: "sale",
  רכישה: "sale",
  השכרה: "rent",
  שכירות: "rent",
};

export const FINANCING_MAP: Record<string, ParsedBuyerRow["financing"]> = {
  מזומן: "cash",
  "אישור עקרוני": "pre_approved",
  בתהליך: "in_process",
  "לא התחיל": "not_started",
};

export const MATURITY_MAP: Record<string, BuyerMaturity> = {
  "חם מאוד": "very_hot",
  חם: "hot",
  מתעניין: "interested",
  "לא בשל": "not_ripe",
};

/**
 * נורמליזציה של טלפון ישראלי ל-E.164 (‎+972…). מקבל 050-1234567,
 * 03 1234567, 972501234567 וכד'. מחזיר undefined אם לא ניתן לנרמל —
 * ההחלטה הסופית (דחיית השורה) נעשית בוולידציה בצד השרת.
 */
export function normalizeIsraeliPhone(raw: string): string | undefined {
  const digits = raw.replace(/[^\d+]/gu, "");
  let national: string;
  if (digits.startsWith("+972")) national = digits.slice(4);
  else if (digits.startsWith("972")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else return undefined;
  if (!/^[2-9]\d{7,8}$/u.test(national)) return undefined;
  return `+972${national}`;
}

/** "תל אביב; רמת גן / גבעתיים" → ["תל אביב","רמת גן","גבעתיים"] */
function splitCities(raw: string): string[] {
  return raw
    .split(/[;/|]/u)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * מפרק CSV מלא של קונים. מחזיר שורות + כותרות שלא זוהו (שקיפות למתווך).
 * טלפונים מנורמלים ל-E.164; תקציבים מומרים לאגורות.
 */
export function parseBuyersCsv(csv: string): {
  rows: ParsedBuyerRow[];
  unmappedHeaders: string[];
} {
  const lines = csv
    .split(/\r?\n/u)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = parseCsvLine(lines[0] ?? "");
  const mapped = headers.map((h) => HEADER_MAP[h.trim()]);
  const unmappedHeaders = headers.filter((_h, i) => mapped[i] === undefined);

  const rows: ParsedBuyerRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i] ?? "");
    const row: ParsedBuyerRow = { cities: [] };

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = (cells[col] ?? "").trim();
      if (!target || raw === "") return;

      if (target === "name" || target === "agentNotes") {
        row[target] = raw;
      } else if (target === "phone") {
        row.phone = normalizeIsraeliPhone(raw) ?? raw;
      } else if (target === "cities") {
        row.cities = splitCities(raw);
      } else if (target === "dealType") {
        // ערך לא מזוהה לא הופך בשקט ל"מכירה" — מועבר גולמי והשרת דוחה את השורה
        row.dealType = DEAL_TYPE_MAP[raw] ?? raw;
      } else if (target === "financing") {
        row.financing = FINANCING_MAP[raw];
      } else if (target === "maturity") {
        row.maturity = MATURITY_MAP[raw];
      } else if (target === "budgetMinAgorot" || target === "budgetMaxAgorot") {
        const agorot = parseShekelsToAgorot(raw);
        if (agorot !== undefined) row[target] = agorot;
      } else {
        // roomsMin / roomsMax
        const n = Number(raw.replace(",", "."));
        if (!Number.isNaN(n)) row[target] = n;
      }
    });

    // ברירת מחדל "מכירה" רק כשהתא ריק לגמרי — ערך לא מזוהה כבר הועבר גולמי לעיל
    if (row.dealType === undefined) row.dealType = "sale";
    rows.push(row);
  }

  return { rows, unmappedHeaders };
}
