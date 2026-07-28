import { PROPERTY_TYPE_MAP } from "./csv-import.js";
import { DEAL_TYPE_MAP, FINANCING_MAP, MATURITY_MAP } from "./csv-import-buyers.js";

/**
 * ייצוא CSV (docs/08 — הנתונים שייכים למשרד, לא לנו): בונה קובץ עם BOM
 * (עברית תקינה באקסל) וכותרות עבריות התואמות למפות הייבוא — קובץ מיוצא
 * ניתן לייבוא חזרה כמו-שהוא (Round-trip). טהור ובדוק.
 */

/** תו BOM — בלעדיו אקסל מציג עברית כג'יבריש בקידוד UTF-8. */
export const CSV_BOM = "﻿";

/** בריחת תא CSV: גרשיים כפולים ועטיפה כשיש פסיק/גרש/שורה חדשה. */
export function escapeCsvCell(value: string): string {
  if (/[",\n\r]/u.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** בונה CSV מלא משורת כותרות ושורות ערכים (undefined → תא ריק). */
export function toCsv(headers: string[], rows: (string | number | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map((cell) => escapeCsvCell(cell === undefined ? "" : String(cell))).join(","),
  );
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** היפוך מפת ייבוא (עברית→ערך) לתווית ייצוא (ערך→עברית) — אמת אחת לשניהם. */
function invert<V extends string>(map: Record<string, V>): Record<V, string> {
  const out = {} as Record<V, string>;
  // הכניסה הראשונה מנצחת — היא הצורה הקנונית (למשל "מכירה" ולא "קנייה")
  for (const [hebrew, value] of Object.entries(map)) {
    if (!(value in out)) out[value] = hebrew;
  }
  return out;
}

export const PROPERTY_TYPE_LABELS_HE = invert(PROPERTY_TYPE_MAP);
export const DEAL_TYPE_LABELS_HE = invert(DEAL_TYPE_MAP);
export const FINANCING_LABELS_HE = invert(
  FINANCING_MAP as Record<string, NonNullable<(typeof FINANCING_MAP)[string]>>,
);
export const MATURITY_LABELS_HE = invert(MATURITY_MAP);

/** אגורות → מחרוזת שקלים לייצוא ("2650000" או "6000.5"). */
export function agorotToShekelString(agorot: number | undefined): string {
  if (agorot === undefined) return "";
  const shekels = agorot / 100;
  return Number.isInteger(shekels) ? String(shekels) : shekels.toFixed(2);
}
