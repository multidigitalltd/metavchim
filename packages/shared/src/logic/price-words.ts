/**
 * סכום בשקלים → מילים בעברית.
 *
 * מחיר נדל"ן הוא שבע ספרות, וספרה אחת עודפת בהקלדה הופכת דירה של
 * 1,900,000 ל-19,000,000 — הפרש שנראה כמעט זהה במבט חטוף על שדה
 * מספרי, ומתגלה רק אחרי שההצעה כבר יצאה ללקוח. המילים הן ההגנה:
 * "תשעה עשר מיליון" ו"מיליון תשע מאות אלף" אינם דומים כלל.
 *
 * הפונקציה מיועדת לסכומים ולא למספרים כלליים — צורות הסמיכות כאן
 * ("שלושת אלפים", "עשרת אלפים") הן אלה שנשמעות נכון עם שקלים.
 */

/** יחידות בזכר — כך נאמר עם "שקלים" ועם "מיליון". */
const UNITS = [
  "",
  "אחד",
  "שניים",
  "שלושה",
  "ארבעה",
  "חמישה",
  "שישה",
  "שבעה",
  "שמונה",
  "תשעה",
] as const;

const TEENS = [
  "עשרה",
  "אחד עשר",
  "שנים עשר",
  "שלושה עשר",
  "ארבעה עשר",
  "חמישה עשר",
  "שישה עשר",
  "שבעה עשר",
  "שמונה עשר",
  "תשעה עשר",
] as const;

const TENS = [
  "",
  "עשרה",
  "עשרים",
  "שלושים",
  "ארבעים",
  "חמישים",
  "שישים",
  "שבעים",
  "שמונים",
  "תשעים",
] as const;

const HUNDREDS = [
  "",
  "מאה",
  "מאתיים",
  "שלוש מאות",
  "ארבע מאות",
  "חמש מאות",
  "שש מאות",
  "שבע מאות",
  "שמונה מאות",
  "תשע מאות",
] as const;

/** צורת הסמיכות לאלפים: "שלושת אלפים", "עשרת אלפים". */
const THOUSAND_CONSTRUCT: Record<number, string> = {
  3: "שלושת",
  4: "ארבעת",
  5: "חמשת",
  6: "ששת",
  7: "שבעת",
  8: "שמונת",
  9: "תשעת",
  10: "עשרת",
};

/** 1–999 במילים. מחזיר מחרוזת ריקה עבור 0 — הקורא מרכיב את החיבור. */
function under1000(n: number): string {
  if (n === 0) return "";
  const parts: string[] = [];

  const hundreds = Math.floor(n / 100);
  if (hundreds > 0) parts.push(HUNDREDS[hundreds] as string);

  const rest = n % 100;
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10] as string);
  } else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens > 0) parts.push(TENS[tens] as string);
    if (units > 0) parts.push(UNITS[units] as string);
  }

  // "ו" לפני האיבר האחרון: "מאה ועשרים", "מאתיים חמישים ושתיים"
  if (parts.length === 1) return parts[0] as string;
  const last = parts.pop() as string;
  return `${parts.join(" ")} ו${last}`;
}

/** מספר האלפים במילים: 1→"אלף", 2→"אלפיים", 3–10 סמיכות, 11+ רגיל. */
function thousandsWords(count: number): string {
  if (count === 1) return "אלף";
  if (count === 2) return "אלפיים";
  const construct = THOUSAND_CONSTRUCT[count];
  if (construct !== undefined) return `${construct} אלפים`;
  return `${under1000(count)} אלף`;
}

/** מספר המיליונים במילים: 1→"מיליון", 2→"שני מיליון", 3+ רגיל. */
function millionsWords(count: number): string {
  if (count === 1) return "מיליון";
  if (count === 2) return "שני מיליון";
  return `${under1000(count)} מיליון`;
}

/** מעל זה אין טעם במילים — וגם אין מחירי נדל"ן כאלה. */
const MAX_SHEKELS = 999_999_999;

/**
 * הסכום במילים, בלי המילה "שקלים" — הקורא מוסיף אותה אם ירצה.
 *
 * מחזיר מחרוזת ריקה כשאין מה להציג (אפס, שלילי, לא מספר, או מעל
 * התקרה): שדה ריק לא צריך להראות "אפס", וזו הודעה שהייתה רק רעש.
 */
export function priceInWords(shekels: number): string {
  if (!Number.isFinite(shekels)) return "";
  const value = Math.round(shekels);
  if (value <= 0 || value > MAX_SHEKELS) return "";

  const millions = Math.floor(value / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1000);
  const rest = value % 1000;

  const parts: string[] = [];
  if (millions > 0) parts.push(millionsWords(millions));
  if (thousands > 0) parts.push(thousandsWords(thousands));
  if (rest > 0) parts.push(under1000(rest));

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0] as string;
  // "ו" לפני האיבר האחרון: "מיליון ותשע מאות אלף"
  const last = parts.pop() as string;
  return `${parts.join(" ")} ו${last}`;
}

/** אותו דבר עם "₪" — הצורה שמוצגת מתחת לשדה. */
export function priceInWordsWithCurrency(shekels: number): string {
  const words = priceInWords(shekels);
  return words === "" ? "" : `${words} ₪`;
}
