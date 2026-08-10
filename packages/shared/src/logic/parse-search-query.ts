import { CITIES, parseNumberWord } from "./extract-property.js";

/**
 * פרסור שאילתת חיפוש חופשית בעברית.
 *
 * מתווך לא חושב בשדות טופס. הוא מקליד "קונים 4 חדרים בני ברק" — וזו
 * בדיוק השאילתה שעד כה החזירה כלום: החיפוש חיפש את המחרוזת השלמה
 * בשמות ובכתובות, לא מצא, והציג "אין תוצאות" למרות שבמאגר יושבים
 * שבעה קונים שמתאימים בדיוק.
 *
 * הפרסור מפריד את השאילתה לשני חלקים: אילוצים מובְנים (סוג ישות,
 * חדרים, עיר, תקציב) והשארית — טקסט חופשי שממשיך למסלול החיפוש
 * הרגיל, כי "כהן" בתוך "קונים כהן" עדיין צריך למצוא את מר כהן.
 *
 * הכול דטרמיניסטי ובלי LLM: חיפוש הוא הפעולה הכי תכופה במערכת, וקריאת
 * מודל בכל הקלדה הייתה גם איטית וגם יקרה. מה שלא זוהה פשוט נשאר
 * בשארית — כישלון הפרסור לעולם אינו מריק את התוצאות.
 */

/** סוג הישות שהשאילתה מבקשת. undefined = חפש בכולן, כמו קודם. */
export type SearchEntity = "buyers" | "properties" | "leads";

export interface ParsedSearchQuery {
  entity?: SearchEntity;
  /** "שוכרים" מצמצם לעסקאות שכירות; "קונים" למכירה. */
  dealType?: "sale" | "rent";
  /** טווח חדרים מבוקש. ערך יחיד ("4 חדרים") נותן min=max=4. */
  rooms?: { min?: number; max?: number };
  city?: string;
  budget?: { minAgorot?: number; maxAgorot?: number };
  /** מה שנשאר אחרי הסרת האסימונים המובְנים — שם לקוח, רחוב, כל דבר. */
  rest: string;
  /** האם זוהה אילוץ מובְנה כלשהו. false = השאילתה טקסט חופשי רגיל. */
  structured: boolean;
}

/** מילות סוג ישות. הסדר חשוב: "שוכרים" נבדק לפני "קונים". */
const ENTITY_WORDS: { words: readonly string[]; entity: SearchEntity; dealType?: "sale" | "rent" }[] =
  [
    { words: ["שוכרים", "שוכר", "שכירות", "להשכרה"], entity: "buyers", dealType: "rent" },
    { words: ["קונים", "קונה", "רוכשים", "רוכש"], entity: "buyers", dealType: "sale" },
    { words: ["לידים", "ליד", "פניות", "פנייה"], entity: "leads" },
    {
      words: ["נכסים", "נכס", "דירות", "דירה", "בתים", "בית", "פנטהאוז", "מגרש", "למכירה"],
      entity: "properties",
    },
  ];

/** אגורות לשקל — כל הסכומים במערכת נשמרים באגורות. */
const AGOROT = 100;

/**
 * המרת ביטוי סכום לאגורות: "2 מיליון", "1.5 מ'", "850 אלף", "5000".
 * מחזיר undefined כשאין מספר — הקורא מדלג ולא ממציא סכום.
 */
function toAgorot(amount: number, unit: string | undefined): number {
  if (unit === undefined || unit === "") return Math.round(amount * AGOROT);
  if (/^(מיליון|מליון|מ'|מ׳)$/u.test(unit)) return Math.round(amount * 1_000_000 * AGOROT);
  if (/^(אלף|א'|א׳|k)$/iu.test(unit)) return Math.round(amount * 1_000 * AGOROT);
  return Math.round(amount * AGOROT);
}

const AMOUNT = String.raw`(\d+(?:[.,]\d+)?)\s*(מיליון|מליון|מ'|מ׳|אלף|א'|א׳|k)?`;

/**
 * הסף שמפריד סכום ממספר חדרים.
 *
 * בלי זה "קונים מ-4 חדרים" נקרא כרצפת תקציב של ארבע אגורות: הביטוי
 * "מ-4" נבלע כסכום, "חדרים" נשאר יתום, ומספר החדרים — הדבר היחיד
 * שהמתווך באמת ביקש — אבד. סכום בלי יחידה מפורשת מתקבל רק כשהוא
 * גדול מספיק מכדי להיות מספר חדרים.
 */
const MIN_BARE_AMOUNT = 1000;

/** האם ההתאמה היא סכום כסף סביר, או סתם מספר שנקרה בדרך. */
function isMoney(value: number, unit: string | undefined): boolean {
  return (unit !== undefined && unit !== "") || value >= MIN_BARE_AMOUNT;
}

function amountOf(match: RegExpExecArray, numIndex: number): number {
  return Number(String(match[numIndex]).replace(",", "."));
}

/**
 * זיהוי טווח מחיר. נבדק לפני החדרים כדי ש"עד 2 מיליון" לא ייקרא
 * כמספר חדרים, ומוחזר גם הטקסט שנצרך כדי שיוסר מהשארית.
 */
function parseBudget(text: string): { budget: ParsedSearchQuery["budget"]; consumed: string[] } {
  const consumed: string[] = [];

  // "בין 1 ל-2 מיליון" — היחידה בסוף חלה על שני הצדדים
  const between = new RegExp(String.raw`בין\s+${AMOUNT}\s+ל-?\s*${AMOUNT}`, "u").exec(text);
  if (between) {
    // היחידה נכתבת בדרך כלל פעם אחת בסוף ("בין 1 ל-2 מיליון") וחלה
    // על שני הצדדים
    const unit = between[4] ?? between[2];
    consumed.push(between[0]);
    return {
      budget: {
        minAgorot: toAgorot(amountOf(between, 1), between[2] ?? unit),
        maxAgorot: toAgorot(amountOf(between, 3), unit),
      },
      consumed,
    };
  }

  const budget: NonNullable<ParsedSearchQuery["budget"]> = {};

  const upTo = new RegExp(String.raw`(?:עד|מתחת ל-?|פחות מ-?)\s*${AMOUNT}`, "u").exec(text);
  if (upTo && isMoney(amountOf(upTo, 1), upTo[2])) {
    budget.maxAgorot = toAgorot(amountOf(upTo, 1), upTo[2]);
    consumed.push(upTo[0]);
  }

  const from = new RegExp(String.raw`(?:מעל|החל מ-?|מ-)\s*${AMOUNT}`, "u").exec(text);
  if (from && isMoney(amountOf(from, 1), from[2])) {
    budget.minAgorot = toAgorot(amountOf(from, 1), from[2]);
    consumed.push(from[0]);
  }

  /*
   * סכום עירום ("קונים 2 מיליון") נקרא כתקרת תקציב ולא כרצפה: מתווך
   * שאומר "קונה של שני מיליון" מתכוון לתקציב שלו, לא למינימום.
   *
   * המספר חייב לשאת יחידה מפורשת או להיות גדול מסף החדרים — אחרת
   * "4 חדרים" היה נקרא כתקציב של ארבע אגורות. הבדיקה גם מדלגת על
   * מספר שצמוד למילה "חדרים", כדי ש"5000 שקל" ייקרא כסכום אבל
   * "3 חדרים" לא.
   */
  if (budget.maxAgorot === undefined && budget.minAgorot === undefined) {
    const bare = new RegExp(String.raw`${AMOUNT}(?!\s*חדרים)`, "u").exec(text);
    if (bare && isMoney(amountOf(bare, 1), bare[2])) {
      budget.maxAgorot = toAgorot(amountOf(bare, 1), bare[2]);
      consumed.push(bare[0]);
    }
  }

  const found = budget.minAgorot !== undefined || budget.maxAgorot !== undefined;
  return { budget: found ? budget : undefined, consumed };
}

/** זיהוי טווח חדרים: "4 חדרים", "3-4 חדרים", "מ-3 חדרים", "עד 4 חדרים". */
function parseRooms(text: string): { rooms: ParsedSearchQuery["rooms"]; consumed: string[] } {
  const range = /(\d+(?:[.,]5)?)\s*[-–]\s*(\d+(?:[.,]5)?)\s*חדרים/u.exec(text);
  if (range) {
    return {
      rooms: {
        min: Number(String(range[1]).replace(",", ".")),
        max: Number(String(range[2]).replace(",", ".")),
      },
      consumed: [range[0]],
    };
  }

  const bounded = /(מ-?|לפחות|מעל|עד|מקסימום)\s*(\d+(?:[.,]5)?)\s*חדרים/u.exec(text);
  if (bounded) {
    const value = Number(String(bounded[2]).replace(",", "."));
    const isUpper = /^(עד|מקסימום)$/u.test(String(bounded[1]).trim());
    return {
      rooms: isUpper ? { max: value } : { min: value },
      consumed: [bounded[0]],
    };
  }

  // ערך יחיד — כולל "ארבעה חדרים" ו-"3 וחצי חדרים"
  const single = /(\d+(?:[.,]5)?|[א-ת]+)(\s+וחצי)?\s*חדרים/u.exec(text);
  if (single) {
    let value = parseNumberWord(String(single[1]));
    if (value !== undefined && single[2] !== undefined) value += 0.5;
    if (value !== undefined && value >= 1 && value <= 20) {
      return { rooms: { min: value, max: value }, consumed: [single[0]] };
    }
  }

  return { rooms: undefined, consumed: [] };
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const text = raw.replace(/\s+/gu, " ").trim();
  if (text === "") return { rest: "", structured: false };

  const consumed: string[] = [];

  // --- סוג הישות ---
  let entity: SearchEntity | undefined;
  let dealType: "sale" | "rent" | undefined;
  for (const group of ENTITY_WORDS) {
    const hit = group.words.find((word) =>
      new RegExp(String.raw`(^|\s)${word}(\s|$)`, "u").test(text),
    );
    if (hit === undefined) continue;
    entity = group.entity;
    dealType = group.dealType;
    consumed.push(hit);
    break;
  }

  // --- עיר ---
  // הארוכה קודם: "מודיעין עילית" לפני שם שמוכל בתוכו
  let city: string | undefined;
  for (const candidate of [...CITIES].sort((a, b) => b.length - a.length)) {
    if (text.includes(candidate)) {
      city = candidate;
      consumed.push(candidate);
      break;
    }
  }

  // --- תקציב לפני חדרים: "עד 2 מיליון" אינו מספר חדרים ---
  const { budget, consumed: budgetText } = parseBudget(text);
  consumed.push(...budgetText);

  const withoutBudget = budgetText.reduce((acc, part) => acc.replace(part, " "), text);
  const { rooms, consumed: roomsText } = parseRooms(withoutBudget);
  consumed.push(...roomsText);

  /*
   * השארית: מה שלא נצרך. היא ממשיכה לחיפוש הטקסטואלי הרגיל, ולכן
   * "קונים כהן בני ברק" עדיין מוצא את מר כהן — הפרסור מצמצם, לא מחליף.
   */
  let rest = text;
  for (const part of consumed) rest = rest.replace(part, " ");
  rest = rest
    .replace(/\b(ב|ל|מ)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  const structured =
    entity !== undefined || city !== undefined || rooms !== undefined || budget !== undefined;

  return {
    ...(entity !== undefined ? { entity } : {}),
    ...(dealType !== undefined ? { dealType } : {}),
    ...(rooms !== undefined ? { rooms } : {}),
    ...(city !== undefined ? { city } : {}),
    ...(budget !== undefined ? { budget } : {}),
    rest,
    structured,
  };
}
