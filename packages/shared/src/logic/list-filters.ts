import { formatIsraeliNumber } from "./israel-time.js";
/**
 * סינון רשימות — טווחים וחיפוש טקסט חופשי.
 *
 * מה שנראה כמו עיבוד קלט טכני הוא בפועל שורה של החלטות מוצר: מה
 * קורה כשהמשתמש הפך בין מינימום למקסימום, ומה בדיוק "חיפוש חופשי"
 * אמור למצוא. שתיהן קלות לטעות בשקט, ולכן הן כאן ומכוסות בבדיקות.
 */

export interface NumberRange {
  min?: number;
  max?: number;
}

/**
 * טווח מנורמל.
 *
 * **מינימום גדול ממקסימום מוחלף ולא נפסל.** מתווך שהקליד 3,000,000
 * בשדה "מ-" ו-1,000,000 בשדה "עד" התכוון לטווח הזה; החזרת אפס תוצאות
 * נראית כמו מערכת שבורה, לא כמו הודעת שגיאה. ערכים שליליים ולא־
 * מספריים נזרקים, כי אין להם פירוש סביר.
 */
export function normalizeRange(min?: number, max?: number): NumberRange {
  const clean = (value: number | undefined): number | undefined =>
    value === undefined || !Number.isFinite(value) || value < 0 ? undefined : value;
  const low = clean(min);
  const high = clean(max);
  if (low !== undefined && high !== undefined && low > high) return { min: high, max: low };
  return { ...(low !== undefined ? { min: low } : {}), ...(high !== undefined ? { max: high } : {}) };
}

/** המרת טווח מחירים משקלים לאגורות — היחידה שבה המחיר נשמר. */
export function priceRangeAgorot(minShekels?: number, maxShekels?: number): NumberRange {
  const range = normalizeRange(minShekels, maxShekels);
  return {
    ...(range.min !== undefined ? { min: Math.round(range.min * 100) } : {}),
    ...(range.max !== undefined ? { max: Math.round(range.max * 100) } : {}),
  };
}

/**
 * האם שני טווחים נחתכים.
 *
 * הסינון של הקונים שונה מהותית מזה של הנכסים: לנכס יש מחיר אחד,
 * ולקונה יש *טווח* תקציב. מתווך שמסנן "1–2 מיליון" מחפש קונים
 * שהטווח שלהם נחתך עם הטווח הזה — קונה עם תקציב 1.5–2.5 מיליון
 * רלוונטי לו לגמרי.
 *
 * הבדיקה ההפוכה (הכלה) הייתה מסתירה בדיוק את הקונים שבגבול, שהם
 * לרוב המעניינים. טווח פתוח מצד אחד נחשב אינסופי לאותו כיוון.
 */
export function rangesOverlap(a: NumberRange, b: NumberRange): boolean {
  const aMin = a.min ?? Number.NEGATIVE_INFINITY;
  const aMax = a.max ?? Number.POSITIVE_INFINITY;
  const bMin = b.min ?? Number.NEGATIVE_INFINITY;
  const bMax = b.max ?? Number.POSITIVE_INFINITY;
  return aMin <= bMax && aMax >= bMin;
}

/** תקרת מונחים — שאילתה עם עשרות מונחים היא עומס, לא חיפוש. */
const MAX_TERMS = 6;

/**
 * פירוק שורת החיפוש למונחים.
 *
 * מונח בן תו אחד נזרק: הוא מתאים כמעט לכל דבר ורק מאט את השאילתה.
 * כפילויות מוסרות כדי לא לשכפל את אותו תנאי.
 */
export function freeTextTerms(query: string | undefined): string[] {
  if (!query) return [];
  const terms = query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/**
 * האם הפריט תואם לחיפוש החופשי.
 *
 * **כל המונחים חייבים להתאים, וכל אחד מהם יכול להתאים בכל שדה.**
 *
 * זו ההחלטה שקובעת אם החיפוש שימושי: "פנטהאוז רמת גן" צריך למצוא
 * נכס שסוגו פנטהאוז ועירו רמת גן — כלומר שני מונחים שמתאימים בשני
 * שדות *שונים*. דרישה ששני המונחים יופיעו באותו שדה לא הייתה מוצאת
 * אותו, ו-OR בין המונחים היה מחזיר גם את כל הפנטהאוזים בארץ.
 *
 * מיועד לשימוש בצד הלקוח ולתיעוד הכוונה; בשרת אותו כלל מתורגם
 * לתנאי AND של ILIKE-ים.
 */
export function matchesFreeText(fields: readonly (string | null | undefined)[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === "string" && field !== "")
    .map((field) => field.toLowerCase());
  return terms.every((term) => {
    const needle = term.toLowerCase();
    return haystack.some((field) => field.includes(needle));
  });
}

/** תיאור הסינון הפעיל — מוצג למשתמש כדי שלא יתהה למה הרשימה קצרה. */
export function describeFilters(parts: {
  terms?: readonly string[];
  price?: NumberRange;
  rooms?: NumberRange;
}): string {
  const chunks: string[] = [];
  if (parts.terms && parts.terms.length > 0) chunks.push(`"${parts.terms.join(" ")}"`);
  if (parts.price?.min !== undefined || parts.price?.max !== undefined) {
    chunks.push(describeRange(parts.price, (v) => `${formatIsraeliNumber(v)} ₪`));
  }
  if (parts.rooms?.min !== undefined || parts.rooms?.max !== undefined) {
    chunks.push(describeRange(parts.rooms, (v) => `${v} חד׳`));
  }
  return chunks.join(" · ");
}

function describeRange(range: NumberRange, format: (value: number) => string): string {
  if (range.min !== undefined && range.max !== undefined) {
    return `${format(range.min)}–${format(range.max)}`;
  }
  if (range.min !== undefined) return `מ-${format(range.min)}`;
  return `עד ${format(range.max ?? 0)}`;
}
