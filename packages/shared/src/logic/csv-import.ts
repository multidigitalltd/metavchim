import type { PropertyFields } from "../schemas/property.js";
import type { PropertyType } from "../schemas/property.js";
import {
  RECRUITMENT_SOURCE_LABELS,
  RECRUITMENT_STATUS_LABELS,
} from "./recruitment.js";

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
  /*
   * ‎**„כן, ועוד משהו” הוא עדיין כן.**
   *
   * ‏ייצוא אמיתי כותב בעמודת המעלית ‎„כן,שתיים”‎ או „כן,מ. שבת” —
   * ‏כלומר כן, ואיזו. ההשוואה המדויקת החזירה „לא ידוע”, והשדה
   * ‏נשאר ריק דווקא בנכסים שיש בהם שתי מעליות.
   *
   * ‎**פיצול על המפריד, ולא `\b`** (ביקורת Codex, P1). גבול-מילה
   * ‏ב-JavaScript נמדד מול ‎`[A-Za-z0-9_]`‎: אות עברית אינה תו-מילה,
   * ‏ולכן אין גבול בין „ן” לפסיק — התנאי היה `false` תמיד, גם על
   * ‎„כן” לבדו. כלומר הטיפול במקרה שבשבילו הוא נוסף לא רץ מעולם.
   *
   * ‏האסימון הראשון נבדק מול אותן שתי הרשימות שמעל, ולא מול
   * ‏רשימה שלישית: „כן” הוא „כן” בשתי הצורות.
   */
  const first = value.split(/[,;|/]/u)[0]?.trim() ?? "";
  if (first !== value && first !== "") return parseYesNo(first);
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
  /*
   * ‎**הקיצורים של מערכות הנדל"ן הוותיקות** — אותם קיצורים בדיוק
   * ‏שנוספו למפת הגיוס. שני המסלולים חייבים לקרוא את אותו קובץ
   * ‏אותו דבר: משרד שמעלה את הייצוא שלו למסך הנכסים ולמסך הגיוס
   * ‏ומקבל שתי תוצאות שונות אינו יכול לדעת איזו מהן נכונה.
   */
  נכס: "propertyType",
  חדר: "rooms",
  מס: "houseNumber",
  קו: "floor",
  מע: "hasElevator",
  שם: "ownerName",
  "שם הבעלים": "ownerName",
  טלפון1: "ownerPhone",
  "טלפון 1": "ownerPhone",
  טלפון: "ownerPhone",
  נייד: "ownerPhone",
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
  /*
   * ‎**„פנטהאוס” בסמ"ך.** שני הכתיבים נפוצים באותה מידה, והמפה
   * ‏הכירה רק אחד — כלומר בקובץ אמיתי כל הפנטהאוזים נכנסו בלי
   * ‏סוג, ומי שקרא את התוצאה ראה „דירה” חסרה ולא טעות כתיב.
   */
  פנטהאוס: "penthouse",
  דופלקס: "duplex",
  "בית פרטי": "private_house",
  "דו-משפחתי": "two_family",
  סטודיו: "studio",
  "יחידת דיור": "unit",
  "טאבו משותף": "shared_tabu",
  "דירה מתאימה לחלוקה": "divisible_apartment",
  "דירת נכה": "accessible_apartment",
  מגרש: "plot",
  /*
   * ‎**„מסחרי” נשאר ממופה לערך הכללי** — קובץ שיוצא לפני הפיצול
   * חייב להיטען חזרה בלי לאבד את הסוג. הענפים נוספים לצידו.
   */
  מסחרי: "commercial",
  "חנות": "commercial_shop",
  "משרד": "commercial_office",
  "מחסן": "commercial_warehouse",
  "תעשייה": "commercial_industrial",
  "מרתף": "commercial_basement",
  "בניין": "commercial_building",
  "מרלוג": "commercial_logistics",
  "חניה": "commercial_parking",
  "תחנת דלק": "commercial_gas_station",
  אחר: "other",
  /*
   * ‎**הכתיב של מערכות הנדל"ן הוותיקות** — ייצוא אמיתי של משרד
   * ‏(‎1,326‎ שורות) שהגיע מ-webtiv. אלה לא כתיבים חלופיים של מה
   * ‏שכבר יש כאן: ‎„בית”, „וילה”, „קוטג׳”‎ ו„דו משפחתי” הם סוגים
   * ‏שהמפה פשוט לא הכירה, ולכן ‎121‎ שורות מהקובץ הזה נכנסו בלי
   * ‏סוג נכס כלל.
   */
  בית: "private_house",
  וילה: "private_house",
  קוטג: "private_house", // ‏„קוטג׳” — הגרש מוסר בנרמול
  "דו משפחתי": "two_family",
  "יח דיור": "unit",
  "יח. דיור": "unit",
  /* ‏„דירת גג” בקיצור — פנטהאוז לכל דבר בשפה של המשרד */
  "דגג": "penthouse",
  "ד.גג": "penthouse",
  "מיני פנט": "penthouse",
  /*
   * ‏„מחולקת” היא דירה שכבר חולקה, ו„מתאימה לחלוקה” היא זו
   * ‏שאפשר לחלק. אותו סוג במאגר — ההבדל הוא בזמן, לא בנכס.
   */
  מחולקת: "divisible_apartment",
  /*
   * ‎**סוגים אמיתיים שאין להם ערך משלהם — „אחר”, ולא ריק.**
   *
   * ‏„אחר” אומר „זה נכס מסוג שאיננו מנהלים”, וריק אומר „לא ידוע
   * ‏מה זה”. השני שולח את המתווך לפתוח את השורה כדי לגלות שהיא
   * ‏בסדר גמור. ‎„להשקעה” ו„פרוייקט” אינם כאן בכוונה: הם תיאור
   * ‏של הזדמנות ולא של נכס, ואין להם תשובה נכונה בעמודה הזאת.
   */
  "ד.מרתף": "other",
  דמרתף: "other",
  טריפלקס: "other",
  "זכות לדירה": "other",
  "קבוצת רכישה": "other",
};

/**
 * ‎**סוגי הנכס שמונח עברי מתאים להם — לחיפוש החופשי ברשימות.**
 *
 * ‏הסוג נשמר באנגלית והמסך מבטיח חיפוש בעברית, ולכן „דירה” חייב
 * ‏להפוך ל-`apartment` לפני שהשאילתה יוצאת.
 *
 * ‎**מול כל הכתיבים, ולא מול התווית הקנונית בלבד.** רשימת הנכסים
 * ‏השוותה מול `PROPERTY_TYPE_LABELS_HE`, שהיא היפוך של המפה הזאת
 * ‏ומחזיקה **כתיב אחד** לכל סוג — ולכן „פנטהאוס” בסמ"ך לא מצא
 * ‏דבר, בעוד „פנטהאוז” בזי"ן מצא. מי שהקליד את הכתיב השני ראה
 * ‏רשימה ריקה ולא הבין למה.
 *
 * ‏הפונקציה יושבת כאן ולא בשירות כי המפה כאן: היא הייתה כתובה
 * ‏פעמיים — פעם ברשימת הנכסים ופעם ברשימת הגיוס — וכתיב שנוסף
 * ‏למפה לא היה מגיע לאף אחת מהן.
 */
/**
 * ‎**סוג נכס מתא בקובץ — כולל תא שיש בו כמה סוגים.**
 *
 * ‏מערכות ותיקות שומרות בעמודה אחת גם את הסוג וגם תוספות:
 * ‎„דירה,יח. דיור”, „פנטהאוס,יח. דיור”, „בית,יח. דיור,דו משפחתי”.
 * ‏חיפוש של המחרוזת השלמה במפה לא מצא דבר, והשורה נכנסה בלי סוג —
 * ‏כלומר דווקא הנכסים המעניינים (דירה עם יחידת דיור) איבדו את
 * ‏הנתון.
 *
 * ‎**האסימון הראשון שמזוהה הוא הסוג**, והשאר הן תוספות: „דירה”
 * ‏קודם ל„יח. דיור” כי כך הן כתובות, וזה גם הסדר הנכון — הנכס
 * ‏הוא דירה, ויחידת הדיור היא מה שיש בה.
 *
 * ‏פונקציה אחת לשני המפרקים: הגיוס חיפש במפה אחרי נרמול והנכסים
 * ‏בלעדיו, כלומר אותו קובץ נקרא אחרת בשני המסלולים.
 */
export function propertyTypesForTerm(term: string): PropertyType[] {
  /*
   * ‎**שני הצדדים עוברים את אותו נרמול** (ביקורת Codex, P2).
   *
   * ‏מפתחות המפה נכתבים כפי שהם מופיעים בקבצים (‎„קוטג”‎ בלי גרש,
   * ‏כי הגרש מוסר בנרמול בזמן הייבוא), והמונח מגיע מהמקלדת של
   * ‏המתווך — עם גרש. השוואה בין השניים כמות שהם החזירה „לא נמצא”
   * ‏על הכתיב הנכון בדיוק: מי שכתב „קוטג׳” לא מצא את השורה שנכנסה
   * ‏מ„קוטג׳” בקובץ.
   *
   * ‏הנרמול על המונח בלבד ולא גם על המפתחות: המפתחות **כבר**
   * ‏כתובים בצורה המנורמלת, כי זו הצורה שהייבוא מחפש בה. נרמול
   * ‏שני היה ענף שאין דרך להפיל אותו, וכזה אינו נשמר.
   */
  const needle = normalizeHeader(term);
  if (needle === "") return [];
  const found = new Set<PropertyType>();
  for (const [hebrew, value] of Object.entries(PROPERTY_TYPE_MAP)) {
    if (hebrew.toLowerCase().includes(needle)) found.add(value);
  }
  return [...found];
}

export function propertyTypeFromCsv(raw: string): PropertyType | undefined {
  const whole = PROPERTY_TYPE_MAP[normalizeHeader(raw)];
  if (whole !== undefined) return whole;
  for (const part of raw.split(/[,/|]/u)) {
    const token = normalizeHeader(part);
    if (token === "") continue;
    const match = PROPERTY_TYPE_MAP[token] ?? PROPERTY_TYPE_MAP[token.replace(/^דירת\s+/u, "")];
    if (match !== undefined) return match;
  }
  return undefined;
}

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
        const type = propertyTypeFromCsv(raw);
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

/* ──────────────────────  נכסים לגיוס  ────────────────────── */

/**
 * ‎**אוצר מילים משלו, ולא תת-קבוצה של הנכסים.**
 *
 * ‏קובץ גיוס אינו קובץ נכסים מקוצר: יש בו עמודות שאין בנכס
 * ‏(מקור, קישור למודעה, שלב בגיוס) ואין בו עמודות שיש בנכס
 * ‏(כותרת שיווקית, בלעדיות, מעלית). מיפוי שהיה נשען על טבלת
 * ‏הנכסים היה מקבל עמודה כמו „כותרת שיווקית”, מדווח עליה
 * ‏כ„זוהתה”, ואז זורק אותה בשקט בשרת — כי סכימת הגיוס היא
 * ‎`.strict()`. עמודה שאינה נקלטת חייבת להיראות כך במסך.
 */
const RECRUITMENT_HEADER_MAP: Record<string, string> = {
  עיר: "city",
  city: "city",
  שכונה: "neighborhood",
  רחוב: "street",
  street: "street",
  "מספר בית": "houseNumber",
  מספר: "houseNumber",
  חדרים: "rooms",
  rooms: "rooms",
  שטח: "areaSqm",
  'שטח (מר)': "areaSqm",
  מר: "areaSqm",
  קומה: "floor",
  "מתוך קומות": "totalFloors",
  מחיר: "priceAgorot",
  price: "priceAgorot",
  "סוג עסקה": "dealType",
  סוג: "propertyType",
  "סוג נכס": "propertyType",
  "בעל הנכס": "ownerName",
  בעלים: "ownerName",
  "שם בעל הנכס": "ownerName",
  "טלפון בעלים": "ownerPhone",
  "טלפון בעל הנכס": "ownerPhone",
  טלפון: "ownerPhone",
  phone: "ownerPhone",
  מקור: "source",
  "מקור הנכס": "source",
  source: "source",
  קישור: "sourceUrl",
  "קישור למודעה": "sourceUrl",
  "לינק למודעה": "sourceUrl",
  url: "sourceUrl",
  link: "sourceUrl",
  שלב: "status",
  סטטוס: "status",
  status: "status",
  הערות: "notes",
  הערה: "notes",
  notes: "notes",
  /*
   * ‎**הכתיב המקוצר של מערכות הנדל"ן הוותיקות.**
   *
   * ‏ייצוא אמיתי של משרד (webtiv) מגיע עם כותרות בנות שתי אותיות:
   * ‎„מס” לבית, „קו” לקומה, „חדר” לחדרים, „נכס” לסוג. מתוך שמונה־
   * ‏עשרה עמודות בקובץ כזה זוהו שלוש בלבד, וכל השאר — כולל השם
   * ‏והטלפון של הבעלים, כלומר כל הערך של הקובץ — נזרקו.
   *
   * ‏הקיצורים חד-משמעיים בהקשר של גיליון נכסים: „קו” בגיליון
   * ‏שיש בו „מס” ו„חדר” אינו קו טלפון.
   */
  נכס: "propertyType",
  "סוג הנכס": "propertyType",
  חדר: "rooms",
  "מס חדרים": "rooms",
  מס: "houseNumber",
  "מס בית": "houseNumber",
  בית: "houseNumber",
  קו: "floor",
  קומת: "floor",
  שם: "ownerName",
  "שם הבעלים": "ownerName",
  מוכר: "ownerName",
  "שם המוכר": "ownerName",
  owner: "ownerName",
  טלפון1: "ownerPhone",
  "טלפון 1": "ownerPhone",
  נייד: "ownerPhone",
  "טלפון נייד": "ownerPhone",
  phone1: "ownerPhone",
  "owner phone": "ownerPhone",
  /*
   * ‎**„שיוך” הוא שלב, לא מקור.** בייצוא של webtiv הוא נושא
   * ‏„מאגר / משרד / בטיפול / מתיווך / הסכמה / בלעדי” — כלומר איפה
   * ‏הנכס עומד מול המשרד. ראו `RECRUITMENT_STATUS_ALIASES`.
   */
  שיוך: "status",
  גודל: "areaSqm",
  size: "areaSqm",
  area: "areaSqm",
};

/**
 * ‎**שלבי גיוס בשפה של מערכות אחרות.**
 *
 * ‏המשרד לא ימיר את הקובץ שלו לאוצר המילים שלנו לפני שיעלה אותו,
 * ‏ולכן ערך שאיננו מכירים נופל לברירת המחדל („חדש”). זה נכון
 * ‏ברוב המקרים — „מאגר”, „משרד” ו„מתיווך” אכן אומרים „טרם
 * ‏נגענו” — אבל שני ערכים אומרים משהו אחר במפורש, ואיבודם הופך
 * ‏רשימה של גיוסים פעילים לרשימה של „חדש” אחיד.
 *
 * ‎„בלעדי” הוא הסוף: קיבלנו את הייצוג. „בטיפול” הוא האמצע.
 * ‏השאר נשארים „חדש”, וזה גם מה שהם.
 */
const RECRUITMENT_STATUS_ALIASES: Record<string, string> = {
  בלעדי: "recruited",
  בלעדיות: "recruited",
  גויס: "recruited",
  בטיפול: "called",
  "בטיפולנו": "called",
};

/**
 * ‎**התווית העברית ⟵ הקוד — נגזר מהתוויות, ולא עותק שלהן.**
 *
 * ‏משרד מייצא רשימה, עורך אותה באקסל, ומייבא בחזרה. הערך בקובץ
 * ‏הוא מה שהמסך הראה („קיבל שיחה”), ולכן ההיפוך חייב להיות מאותה
 * ‏טבלה בדיוק — רשימה כתובה ביד הייתה סוטה בשלב הראשון שמישהו
 * ‏משנה ניסוח.
 *
 * ‏גם הקוד עצמו מתקבל (`called`), כי קובץ שנוצר בייצוא טכני או
 * ‏במערכת אחרת אינו חייב להיות בעברית.
 */
function labelsToCodes(labels: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [code, label] of Object.entries(labels)) {
    map[normalizeHeader(label)] = code;
    map[normalizeHeader(code)] = code;
  }
  return map;
}

const RECRUITMENT_SOURCE_MAP = labelsToCodes(RECRUITMENT_SOURCE_LABELS);
const RECRUITMENT_STATUS_MAP = {
  ...labelsToCodes(RECRUITMENT_STATUS_LABELS),
  ...RECRUITMENT_STATUS_ALIASES,
};

/** ‏תוויות היעד למיפוי ידני במסך הייבוא — לגיוס. */
export const RECRUITMENT_TARGET_LABELS: Record<string, string> = {
  city: "עיר",
  neighborhood: "שכונה",
  street: "רחוב",
  houseNumber: "מספר בית",
  rooms: "חדרים",
  areaSqm: 'שטח (מ"ר)',
  floor: "קומה",
  totalFloors: "מתוך קומות",
  priceAgorot: "מחיר",
  dealType: "סוג עסקה",
  propertyType: "סוג נכס",
  ownerName: "בעל הנכס",
  ownerPhone: "טלפון בעל הנכס",
  source: "מקור הנכס",
  sourceUrl: "קישור למודעה",
  status: "שלב בגיוס",
  notes: "הערות",
};

/** ‏שורת גיוס מפורקת — שטוחה, בדיוק כמו שהסכימה בשרת מצפה. */
export interface ParsedRecruitmentRow {
  city?: string;
  neighborhood?: string;
  street?: string;
  houseNumber?: string;
  propertyType?: string;
  dealType?: string;
  rooms?: number;
  areaSqm?: number;
  floor?: number;
  totalFloors?: number;
  priceAgorot?: number;
  ownerName?: string;
  ownerPhone?: string;
  source?: string;
  sourceUrl?: string;
  status?: string;
  notes?: string;
}

const RECRUITMENT_NUMERIC = new Set([
  "rooms",
  "areaSqm",
  "floor",
  "totalFloors",
  "priceAgorot",
]);

/**
 * ‏מפרק קובץ גיוס. מחזיר שורות + כותרות שלא זוהו, כמו אחיו.
 *
 * ‎**המחיר נשמר כאגורות**, כמו בכל המערכת: מספר בשקלים שנכנס
 * ‏כמות שהוא היה הופך 1,750,000 ל-17,500 בכרטיס.
 */
export function parseRecruitmentCsv(
  csv: string,
  overrides: Record<string, string> = {},
): { rows: ParsedRecruitmentRow[]; unmappedHeaders: string[] } {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/u, ""));
  if (records.length < 2) return { rows: [], unmappedHeaders: [] };

  const headers = records[0] ?? [];
  const mapped = headers.map((header) => {
    const override = overrides[header.trim()];
    if (override !== undefined && override !== "") return override;
    return RECRUITMENT_HEADER_MAP[normalizeHeader(header)];
  });
  /*
   * ‎**עמודת קישוט אינה „כותרת שלא זוהתה”.**
   *
   * ‏ייצוא של מערכת ותיקה נושא עמודות בלי כותרת בכלל, ועמודה
   * ‏שכותרתה „*”. אי אפשר למפות אותן ידנית (המפתח הוא הכותרת
   * ‏עצמה, ושתי כותרות ריקות מתנגשות), ולכן הצגתן ברשימת
   * ‏„לא זוהו” היא רעש שמסתיר את העמודות שבאמת דורשות החלטה.
   */
  const unmappedHeaders = headers.filter(
    (header, i) => mapped[i] === undefined && normalizeHeader(header) !== "",
  );

  const rows: ParsedRecruitmentRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const cells = records[i] ?? [];
    const row: ParsedRecruitmentRow = {};
    headers.forEach((_header, col) => {
      const target = mapped[col];
      const raw = unsanitizeFormulaCell((cells[col] ?? "").trim());
      if (target === undefined || raw === "") return;

      /*
       * ‎**„3,5” הוא שלוש וחצי, לא שלושים וחמש.**
       *
       * ‏פסיק עשרוני הוא כתיב נפוץ בגיליונות, וניקוי גורף של
       * ‏פסיקים (שנכון למחיר — „2,650,000”) הפך אותו ל-35. הסכימה
       * ‏חוסמת חדרים מעל 20, ולכן **השורה כולה** נדחתה על עמודה
       * ‏שנקראה נכון במפרק הנכסים (ביקורת Codex). שני כללים ולא
       * ‏אחד, כי מדובר בשני תפקידים של אותו תו.
       */
      if (target === "rooms") {
        const value = Number(raw.replace(",", "."));
        if (Number.isFinite(value)) row.rooms = value;
        return;
      }
      if (target === "floor" && /קרקע/u.test(raw)) {
        // ‏„קומת קרקע” — קומה 0, כמו במפרק הנכסים
        row.floor = 0;
        return;
      }
      if (RECRUITMENT_NUMERIC.has(target)) {
        const value = Number(raw.replace(/[,\s₪]/gu, ""));
        if (!Number.isFinite(value)) return;
        (row as Record<string, unknown>)[target] =
          target === "priceAgorot" ? Math.round(value * 100) : value;
        return;
      }
      if (target === "propertyType") {
        const type = propertyTypeFromCsv(raw);
        if (type !== undefined) row.propertyType = type;
        return;
      }
      if (target === "dealType") {
        const deal = DEAL_TYPE_MAP[normalizeHeader(raw)];
        if (deal !== undefined) row.dealType = deal;
        return;
      }
      if (target === "source") {
        const source = RECRUITMENT_SOURCE_MAP[normalizeHeader(raw)];
        if (source !== undefined) row.source = source;
        return;
      }
      if (target === "status") {
        const status = RECRUITMENT_STATUS_MAP[normalizeHeader(raw)];
        if (status !== undefined) row.status = status;
        return;
      }
      /*
       * ‎**הטלפון מנורמל כאן, כמו במפרק הנכסים.**
       *
       * ‏קובץ אמיתי כותב ‎„055-2130705”‎, והערך עבר כמות שהוא: הוא
       * ‏נשמר עם מקפים, ולכן אותו בעלים שנכנס גם דרך מסך וגם דרך
       * ‏ייבוא קיבל שתי צורות — וההמרה לנכס, שמחפשת איש קשר לפי
       * ‏חתימת הטלפון, יצרה כרטיס כפול. אותו נימוק בדיוק שכבר
       * ‏מנומק במפרק הנכסים; שם הוא נאכף וכאן לא.
       */
      if (target === "ownerPhone") {
        row.ownerPhone = normalizeIsraeliPhone(raw) ?? raw;
        return;
      }
      /*
       * ‏צירוף ולא דריסה — שתי עמודות הערות בקובץ אינן מאבדות אחת
       * ‏את השנייה. אותה התנהגות של מפרק הנכסים.
       */
      if (target === "notes") {
        row.notes = row.notes === undefined ? raw : `${row.notes} | ${raw}`;
        return;
      }
      (row as Record<string, unknown>)[target] = raw;
    });
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return { rows, unmappedHeaders };
}
