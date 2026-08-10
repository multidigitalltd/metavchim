import type { BuyerMaturity } from "../schemas/buyer.js";
import { parseCsvRecords, parseShekelsToAgorot, unsanitizeFormulaCell } from "./csv-import.js";

/**
 * מיפוי CSV לרשומות קונים (docs/08 §6 — Onboarding): משרד חדש מעלה גם את
 * רשימת הלקוחות הקיימת, לא רק את מלאי הנכסים. טהור וניתן לבדיקה —
 * הפרונט קורא לו לפני שליחה לשרת; הוולידציה המחייבת נשארת בצד השרת.
 */

export interface ParsedBuyerRow {
  name?: string;
  phone?: string;
  cities: string[];
  /** "מקור הגעה" — שדה אמיתי בכרטיס הקונה שלא היה ניתן לייבוא כלל. */
  source?: string;
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

/**
 * נרמול כותרת לפני ההשוואה.
 *
 * גיליון אמיתי לא מגיע נקי: מרכאות שנשארו מייצוא, כוכבית שמסמנת
 * "חובה", ניקוד, רווח כפול, ורווח קשיח שנראה זהה לרווח רגיל. כל אחד
 * מהם לבדו הופך כותרת מוכרת ללא-מוכרת, והמשתמש רואה עמודה שנזרקה
 * בלי לדעת למה.
 */
function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/u, "")
    .replace(/["'*׳״]/gu, "")
    .replace(/[\u0591-\u05C7]/gu, "") // ניקוד וטעמים
    .replace(/[\u00A0\s]+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * מיפוי כותרת → שדה קונה.
 *
 * הרשימה ארוכה בכוונה. כל משרד מגיע עם הגיליון שלו, ולכל שדה יש
 * ארבע-חמש דרכים מקובלות לקרוא לו בעברית. כותרת שלא זוהתה אינה
 * מפילה את הייבוא — היא מדווחת למסך — אבל היא כן אומרת שהמידע
 * שבעמודה הזו הלך לאיבוד, וזה מה שהרשימה באה למנוע.
 */
const HEADER_MAP: Record<string, BuyerColumn> = {
  // --- שם ---
  שם: "name",
  "שם מלא": "name",
  "שם הלקוח": "name",
  "שם לקוח": "name",
  "שם פרטי": "name",
  לקוח: "name",
  קונה: "name",
  "שם הקונה": "name",
  name: "name",
  "full name": "name",
  // --- טלפון ---
  טלפון: "phone",
  נייד: "phone",
  "טלפון נייד": "phone",
  "מספר טלפון": "phone",
  "מס טלפון": "phone",
  "טלפון ראשי": "phone",
  סלולרי: "phone",
  phone: "phone",
  mobile: "phone",
  // --- ערים ---
  עיר: "cities",
  ערים: "cities",
  אזור: "cities",
  איזור: "cities",
  ישוב: "cities",
  יישוב: "cities",
  "עיר מבוקשת": "cities",
  "אזור מבוקש": "cities",
  city: "cities",
  // --- סוג עסקה ---
  "סוג עסקה": "dealType",
  עסקה: "dealType",
  "סוג העסקה": "dealType",
  "סוג הנכס המבוקש": "dealType",
  "מכירה/השכרה": "dealType",
  // --- תקציב ---
  תקציב: "budgetMaxAgorot",
  "תקציב מקסימלי": "budgetMaxAgorot",
  "תקציב מקסימום": "budgetMaxAgorot",
  "תקציב עד": "budgetMaxAgorot",
  "מחיר מקסימלי": "budgetMaxAgorot",
  budget: "budgetMaxAgorot",
  "תקציב מינימלי": "budgetMinAgorot",
  "תקציב מינימום": "budgetMinAgorot",
  "תקציב מ": "budgetMinAgorot",
  // --- חדרים ---
  חדרים: "roomsMin",
  "מספר חדרים": "roomsMin",
  "חדרים מינימום": "roomsMin",
  "חדרים מ": "roomsMin",
  "חדרים מקסימום": "roomsMax",
  "חדרים עד": "roomsMax",
  // --- מימון ---
  מימון: "financing",
  "סטטוס מימון": "financing",
  משכנתא: "financing",
  // --- בשלות ---
  בשלות: "maturity",
  סטטוס: "maturity",
  "סטטוס לקוח": "maturity",
  שלב: "maturity",
  status: "maturity",
  // --- מקור ---
  מקור: "source",
  "מקור הגעה": "source",
  "מקור ליד": "source",
  "איך הגיע": "source",
  "מאיפה הגיע": "source",
  source: "source",
  /*
   * --- כותרות של ייצוא ממערכות CRM אחרות ---
   *
   * קובץ הלקוחות הראשון שמשרד אמיתי ניסה לייבא לא הגיע מאקסל שמישהו
   * הקליד — הוא הגיע מייצוא של המערכת הקודמת שלו, עם שמות שדות
   * טכניים באנגלית. משרד שעובר אלינו מגיע בדיוק עם קובץ כזה, ולכן
   * השמות האלה חשובים לא פחות מהעבריים.
   */
  phonenumber: "phone",
  callerphonenumber: "phone",
  contactfullname: "name",
  callerfirstname: "name",
  customerbudget: "budgetMaxAgorot",
  interestedincitiesdistinct: "cities",
  additionalnotes: "agentNotes",
  contactorigin: "source",
  customerseriousness: "maturity",
  roomsmin: "roomsMin",
  roomsmax: "roomsMax",
  crmstatus: "maturity",

  // --- הערות ---
  הערות: "agentNotes",
  הערה: "agentNotes",
  "הערות פנימיות": "agentNotes",
  notes: "agentNotes",
};

export const DEAL_TYPE_MAP: Record<string, "sale" | "rent"> = {
  מכירה: "sale",
  קנייה: "sale",
  קניה: "sale",
  רכישה: "sale",
  לקנות: "sale",
  קונה: "sale",
  מכר: "sale",
  sale: "sale",
  buy: "sale",
  השכרה: "rent",
  שכירות: "rent",
  לשכור: "rent",
  שוכר: "rent",
  rent: "rent",
};

export const FINANCING_MAP: Record<string, ParsedBuyerRow["financing"]> = {
  מזומן: "cash",
  "אישור עקרוני": "pre_approved",
  בתהליך: "in_process",
  "לא התחיל": "not_started",
};

export const MATURITY_MAP: Record<string, BuyerMaturity> = {
  "חם מאוד": "very_hot",
  דחוף: "very_hot",
  חם: "hot",
  פעיל: "hot",
  רציני: "hot",
  מתעניין: "interested",
  בתהליך: "interested",
  חדש: "interested",
  "לא בשל": "not_ripe",
  קר: "not_ripe",
  ממתין: "not_ripe",
  מוקפא: "not_ripe",
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
  // פסיק נכלל: "בני ברק, רמת גן" נפוץ בייצוא. שם עיר אינו מכיל פסיק.
  return raw
    .split(/[;/|,]/u)
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
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = records[0] ?? [];
  const mapped = headers.map((h) => HEADER_MAP[normalizeHeader(h)]);
  const unmappedHeaders = headers.filter((_h, i) => mapped[i] === undefined);

  const rows: ParsedBuyerRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i] ?? [];
    const row: ParsedBuyerRow = { cities: [] };

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = unsanitizeFormulaCell((cells[col] ?? "").trim());
      if (!target || raw === "") return;

      if (target === "name") {
        row.name = raw;
      } else if (target === "agentNotes") {
        // צירוף ולא דריסה: עמודת הסטטוס אולי כבר כתבה לכאן
        row.agentNotes = row.agentNotes ? `${raw} | ${row.agentNotes}` : raw;
      } else if (target === "phone") {
        row.phone = normalizeIsraeliPhone(raw) ?? raw;
      } else if (target === "cities") {
        row.cities = splitCities(raw);
      } else if (target === "dealType") {
        // ערך לא מזוהה לא הופך בשקט ל"מכירה" — מועבר גולמי והשרת דוחה את השורה
        row.dealType = DEAL_TYPE_MAP[raw.trim()] ?? raw;
      } else if (target === "source") {
        row.source = raw;
      } else if (target === "financing") {
        row.financing = FINANCING_MAP[raw.trim()];
      } else if (target === "maturity") {
        /*
         * בשלות שאינה מזוהה **אינה מפילה את השורה** — היא נופלת
         * לברירת המחדל, והמילה המקורית נשמרת בהערות. "סטטוס"
         * בגיליונות אמיתיים מכיל כל דבר ("בטיפול", "חוזר אליו"),
         * ושורה של לקוח אמיתי שנזרקת בגלל מילה בעמודת סטטוס היא
         * עסקת חליפין גרועה. כלום לא הולך לאיבוד.
         */
        const known = MATURITY_MAP[raw.trim()];
        if (known) row.maturity = known;
        else row.agentNotes = row.agentNotes ? `${row.agentNotes} | סטטוס: ${raw}` : `סטטוס: ${raw}`;
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
