import {
  normalizeHeader,
  normalizeIsraeliPhone,
  parseCsvRecords,
  unsanitizeFormulaCell,
} from "./csv-import.js";

/**
 * מיפוי CSV לרשומות **לידים** — הסוג השלישי שאפשר לייבא.
 *
 * עד עכשיו היו רק נכסים וקונים, ומשרד שהגיע עם קובץ פניות — ייצוא
 * מדף פייסבוק, מדוח קמפיין או מה-CRM הקודם — לא היה לו לאן להעלות
 * אותו (דיווח המשתמש: "קליטת אקסל עם לידים... לא עובד מספיק טוב").
 *
 * ליד מיובא עובר את **אותו מסלול של פנייה חיה**: `LeadsService.create`
 * מאחד לפי טלפון לליד פתוח קיים, נועל נגד כפילויות ורושם ביומן —
 * כלומר קובץ עם אותו לקוח פעמיים לא יוצר שני כרטיסים.
 */

export interface ParsedLeadRow {
  name?: string;
  phone?: string;
  email?: string;
  /** buy | sell | rent_in | rent_out | info — ערך לא מזוהה נופל ל-info */
  intent?: string;
  summary?: string;
  source?: string;
}

type LeadColumn = keyof ParsedLeadRow;

const HEADER_MAP: Record<string, LeadColumn> = {
  // --- שם ---
  שם: "name",
  "שם מלא": "name",
  "שם הלקוח": "name",
  "שם לקוח": "name",
  "שם פרטי": "name",
  "שם הפונה": "name",
  לקוח: "name",
  פונה: "name",
  name: "name",
  "full name": "name",
  contactfullname: "name",
  callerfirstname: "name",
  // --- טלפון ---
  טלפון: "phone",
  נייד: "phone",
  "טלפון נייד": "phone",
  "מספר טלפון": "phone",
  "מס טלפון": "phone",
  סלולרי: "phone",
  phone: "phone",
  mobile: "phone",
  phonenumber: "phone",
  callerphonenumber: "phone",
  // --- אימייל ---
  אימייל: "email",
  מייל: "email",
  דואל: "email",
  "כתובת מייל": "email",
  email: "email",
  "e-mail": "email",
  // --- כוונה ---
  עניין: "intent",
  כוונה: "intent",
  מטרה: "intent",
  "מה מחפש": "intent",
  "סוג פנייה": "intent",
  "סוג עסקה": "intent",
  intent: "intent",
  // --- תוכן הפנייה ---
  הודעה: "summary",
  פנייה: "summary",
  תוכן: "summary",
  סיכום: "summary",
  תיאור: "summary",
  הערות: "summary",
  הערה: "summary",
  message: "summary",
  notes: "summary",
  summary: "summary",
  additionalnotes: "summary",
  // --- מקור ---
  מקור: "source",
  "מקור הגעה": "source",
  "מקור ליד": "source",
  קמפיין: "source",
  ערוץ: "source",
  "איך הגיע": "source",
  source: "source",
  campaign: "source",
  contactorigin: "source",
};

/** עמודות שם שהן נפילה-לאחור בלבד — שם פרטי, לא שם מלא. */
const FALLBACK_NAME_HEADERS = new Set(["callerfirstname"]);

/** תוויות השדות שאפשר למפות אליהם ידנית במסך הייבוא. */
export const LEAD_TARGET_LABELS: Record<string, string> = {
  name: "שם",
  phone: "טלפון",
  email: 'דוא"ל',
  intent: "מה הוא רוצה",
  summary: "תוכן הפנייה",
  source: "מקור הגעה",
};

export const LEAD_INTENT_MAP: Record<string, string> = {
  קנייה: "buy",
  קניה: "buy",
  לקנות: "buy",
  קונה: "buy",
  רכישה: "buy",
  buy: "buy",
  מכירה: "sell",
  למכור: "sell",
  מוכר: "sell",
  sell: "sell",
  שכירות: "rent_in",
  לשכור: "rent_in",
  שוכר: "rent_in",
  השכרה: "rent_out",
  להשכיר: "rent_out",
  משכיר: "rent_out",
  rent: "rent_in",
  מידע: "info",
  בירור: "info",
  התעניינות: "info",
  info: "info",
};

/**
 * מפרק CSV מלא של לידים. מחזיר שורות + כותרות שלא זוהו.
 * `overrides` — מיפוי ידני מהמסך, גובר על ההיכרות האוטומטית.
 */
export function parseLeadsCsv(
  csv: string,
  overrides: Record<string, string> = {},
): {
  rows: ParsedLeadRow[];
  unmappedHeaders: string[];
} {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = records[0] ?? [];
  const normalized = headers.map((h) => normalizeHeader(h));
  const mapped = headers.map((h, i) => {
    const override = overrides[h.trim()];
    if (override !== undefined && override !== "") return override as LeadColumn;
    return HEADER_MAP[normalized[i]!];
  });
  const unmappedHeaders = headers.filter((_h, i) => mapped[i] === undefined);

  const rows: ParsedLeadRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i] ?? [];
    const row: ParsedLeadRow = {};
    /** שם שהגיע מעמודה ראשית — נפילה-לאחור לא דורסת אותו */
    let namePrimary = false;

    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = unsanitizeFormulaCell((cells[col] ?? "").trim());
      if (!target || raw === "") return;

      if (target === "name") {
        /*
         * אותו כלל עדיפות כמו אצל הקונים: `contactFullName` הוא השם
         * המלא ו-`callerFirstName` רק פרטי, וההכרעה לפי זהות העמודה
         * ולא לפי סדרה בקובץ — סדר הוא מזל, לא כלל (ביקורת Codex).
         */
        const fallback = FALLBACK_NAME_HEADERS.has(normalized[col] ?? "");
        if (fallback && namePrimary) return;
        if (!fallback) namePrimary = true;
        if (!fallback || row.name === undefined) row.name = raw;
      } else if (target === "phone") {
        row.phone = normalizeIsraeliPhone(raw) ?? raw;
      } else if (target === "email") {
        row.email = raw.toLowerCase();
      } else if (target === "intent") {
        /*
         * כוונה לא מזוהה אינה מפילה את השורה — היא נופלת ל"מידע"
         * והמילה המקורית מצטרפת לסיכום. פנייה אמיתית עדיפה על
         * שורה שנזרקה בגלל ניסוח בעמודת העניין.
         */
        const known = LEAD_INTENT_MAP[normalizeHeader(raw)];
        if (known) row.intent = known;
        else row.summary = row.summary ? `${row.summary} | עניין: ${raw}` : `עניין: ${raw}`;
      } else if (target === "summary") {
        row.summary = row.summary ? `${row.summary} | ${raw}` : raw;
      } else {
        // source
        row[target] = raw;
      }
    });

    /*
     * אין שם אבל יש טלפון ⇒ הטלפון נהיה גם השם — כמו אצל הקונים:
     * כרטיס שאפשר להתקשר אליו עדיף על שורה שנזרקת.
     */
    if ((row.name === undefined || row.name.trim().length < 2) && row.phone !== undefined) {
      row.name = row.phone;
    }
    rows.push(row);
  }

  return { rows, unmappedHeaders };
}
