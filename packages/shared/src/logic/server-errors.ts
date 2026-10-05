import type { EmailDetail } from "./email-template.js";

/**
 * ‎**שגיאות השרת — סיכום יומי למנהלי הפלטפורמה.**
 *
 * ‏שגיאה בשרת נרשמת היום ביומן, ושם היא נשארת: סבב תזכורות שנכשל כל
 * ‏לילה, ספק שמחזיר 500 — איש אינו יודע עד שמשרד מתלונן. כאן נקבעים
 * ‏שני הדברים שה-API וה-Workers צריכים להסכים עליהם: איך שגיאה נספרת,
 * ‏ואיך הסיכום נראה.
 */

/** ‏אורך החתימה — מספיק כדי לזהות את התקלה, קצר מכדי לשאת מסמך. */
export const SERVER_ERROR_SIGNATURE_MAX = 300;

/**
 * ‏צורת השגיאה בלי מה שמשתנה בין מופע למופע.
 *
 * ‏„הנכס 01J… לא נמצא” ו„הנכס 01K… לא נמצא” הם אותה תקלה, ובלי
 * ‏הנרמול כל אחת הייתה שורה בסיכום — מאה שורות של אותו דבר. הנרמול
 * ‏הוא גם **הגנה על פרטיות**: מזהים, מספרים (טלפון, תעודת זהות, סכום)
 * ‏וכתובות מייל אינם נשמרים ואינם נשלחים.
 */
export function serverErrorSignature(message: string): string {
  return message
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, "<id>")
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/gu, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/giu, "<hex>")
    .replace(/\d+/gu, "#")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SERVER_ERROR_SIGNATURE_MAX);
}

export interface ServerErrorRow {
  /** ‏מאיפה — הקשר היומן ב-API, או `workers:<תור>:<משימה>`. */
  source: string;
  signature: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
}

/** ‏כמה סוגים מפורטים במייל. השאר נספרים בשורה אחת. */
export const SERVER_ERROR_DIGEST_TOP = 20;

/**
 * ‏המייל היומי. `day` הוא תאריך ישראלי (YYYY-MM-DD), ו-`time` מציג שעה
 * ‏בשעון ישראל — הקורא מעביר אותו, כי כאן אין שעון.
 */
export function serverErrorDigest(
  day: string,
  rows: readonly ServerErrorRow[],
  time: (at: Date) => string,
): { subject: string; heading: string; paragraphs: string[]; details: EmailDetail[] } {
  const sorted = [...rows].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  const total = sorted.reduce((sum, row) => sum + row.count, 0);
  const [y, m, d] = day.split("-");
  const label = `${Number(d)}.${Number(m)}.${y}`;
  const shown = sorted.slice(0, SERVER_ERROR_DIGEST_TOP);
  const rest = sorted.slice(SERVER_ERROR_DIGEST_TOP);
  const details: EmailDetail[] = shown.map((row) => {
    const [first, last] = [time(row.firstAt), time(row.lastAt)];
    return {
      label: `${row.count}× · ${row.source}`,
      value: `${row.signature} (${first === last ? first : `${first}–${last}`})`,
    };
  });
  if (rest.length > 0) {
    details.push({
      label: `${rest.reduce((sum, row) => sum + row.count, 0)}×`,
      value: `עוד ${rest.length} סוגים`,
    });
  }
  return {
    subject: `שגיאות שרת ב-${label}: ${total}`,
    heading: `שגיאות השרת ב-${label}`,
    paragraphs: [
      `נרשמו ${total} שגיאות מ-${sorted.length} סוגים. הנפוצות למעלה; מספרים, מזהים וכתובות מייל הוסרו מהניסוח.`,
      "הפרטים המלאים — בתאריך ובשעה שליד כל שורה — נמצאים ביומני השרת.",
    ],
    details,
  };
}
