import { CITIES, parseNumberWord } from "./extract-property.js";
import { parseSpokenAmountShekels } from "./spoken-amount.js";

/**
 * חילוץ פרטי אדם (ליד/קונה) מתמלול עברי — מנוע חוקים דטרמיניסטי,
 * במקביל ל-extract-property. אותו עיקרון: מהיר, חינמי וניתן לבדיקה,
 * ומשמש גם כרשת ביקורת מתחת לספק LLM עתידי (docs/05 §3).
 *
 * המתווך חוזר מפגישה ומדבר: "דיברתי עם משה כהן, 050-1234567, מחפש
 * 4 חדרים בבני ברק עד 2.3 מיליון, חייב מעלית וממ"ד, יש לו אישור
 * עקרוני, רוצה להיכנס תוך חצי שנה" — והכל נכנס לשדות.
 */

export type ExtractedIntent = "buy" | "sell" | "rent_in" | "rent_out" | "info" | "unknown";
export type ExtractedMaturity = "very_hot" | "hot" | "interested" | "not_ripe";
export type ExtractedFinancing = "cash" | "pre_approved" | "in_process" | "not_started" | "unknown";
export type RequirementLevel = "must" | "nice";

export interface ExtractedPerson {
  name?: string;
  phone?: string;
  intent: ExtractedIntent;
  maturity?: ExtractedMaturity;
  financing?: ExtractedFinancing;
  cities: string[];
  dealType?: "sale" | "rent";
  budgetMinAgorot?: number;
  budgetMaxAgorot?: number;
  roomsMin?: number;
  roomsMax?: number;
  areaSqmMin?: number;
  features: Partial<Record<"hasElevator" | "hasParking" | "hasBalcony" | "hasSafeRoom" | "hasStorage", RequirementLevel>>;
  /** מה שנותר מהתמלול כטקסט חופשי — נשמר כסיכום הליד */
  summary: string;
}

export interface PersonExtractionResult {
  person: ExtractedPerson;
  /** ביטויים שזוהו — לשקיפות מול המתווך ("ממה הבנו כל שדה") */
  evidence: Partial<Record<keyof ExtractedPerson, string>>;
}

/** סכום בעברית מדוברת → אגורות. "2.3 מיליון", "מיליון וחצי", "900 אלף" */
function parseAmountAgorot(text: string): { agorot: number; evidence: string } | undefined {
  const million = /(?<n>\d+(?:[.,]\d+)?)\s*מיליון/u.exec(text);
  if (million?.groups?.["n"] !== undefined) {
    return {
      agorot: Math.round(Number(million.groups["n"].replace(",", ".")) * 100_000_000),
      evidence: million[0],
    };
  }
  const millionHalf = /מיליון וחצי/u.exec(text);
  if (millionHalf) return { agorot: 150_000_000, evidence: millionHalf[0] };

  const thousand = /(?<n>\d{2,4})\s*אלף/u.exec(text);
  if (thousand?.groups?.["n"] !== undefined) {
    return { agorot: Number(thousand.groups["n"]) * 100_000, evidence: thousand[0] };
  }
  const shekel = /(?<n>\d[\d,]{2,})\s*(?:שקל|ש["״]ח|₪)/u.exec(text);
  if (shekel?.groups?.["n"] !== undefined) {
    return { agorot: Number(shekel.groups["n"].replace(/,/gu, "")) * 100, evidence: shekel[0] };
  }
  // תמלול דיבור מגיע גם במילים: "שני מיליון", "שבע מאות אלף"
  const spoken = parseSpokenAmountShekels(text);
  if (spoken) return { agorot: spoken.shekels * 100, evidence: spoken.evidence };
  return undefined;
}

/** טלפון ישראלי בתמלול (עם מקפים/רווחים) → E.164 */
function parsePhone(text: string): { phone: string; evidence: string } | undefined {
  const match = /(?<raw>(?:\+?972[-\s]?|0)(?:5\d|[2-4]|[8-9])[-\s]?\d{3}[-\s]?\d{4})/u.exec(text);
  if (!match?.groups?.["raw"]) return undefined;
  const digits = match.groups["raw"].replace(/[^\d+]/gu, "");
  let phone: string;
  if (digits.startsWith("+972")) phone = digits;
  else if (digits.startsWith("972")) phone = `+${digits}`;
  else if (digits.startsWith("0")) phone = `+972${digits.slice(1)}`;
  else return undefined;
  return /^\+972[2-9]\d{7,8}$/u.test(phone) ? { phone, evidence: match[0] } : undefined;
}

const NAME_PATTERNS = [
  /(?:דיברתי עם|נפגשתי עם|התקשר|התקשרה|פנה|פנתה|קוראים לו|קוראים לה|שמו|שמה|לקוח בשם|לקוחה בשם|בשם)\s+(?<name>[א-ת]+(?:\s+[א-ת]+)?)/u,
  // שם בתחילת המשפט: "שרה לוי רוצה למכור…"
  /^(?<name>[א-ת]+(?:\s+[א-ת]+)?)\s+(?:רוצה|רוצֶה|מחפש|מחפשת|מעוניין|מעוניינת|צריך|צריכה|שאל|שאלה)/u,
];

const ROLE_WORDS = /^(לקוח|לקוחה|בחור|בחורה|מישהו|מישהי|זוג|משפחה|אדם|איש|אישה)$/u;

/** ניקוי הלכידה: מילת תפקיד אינה שם, ופסוקית ("שמחפש") אינה שם משפחה. */
function cleanName(raw: string): string | undefined {
  const tokens = raw.trim().split(/\s+/u);
  const first = tokens[0];
  if (first === undefined || first.length < 2 || ROLE_WORDS.test(first)) return undefined;
  const second = tokens[1];
  // "שמחפש", "שרוצה" — פסוקית זיקה, לא חלק מהשם
  if (second === undefined || second.startsWith("ש")) return first;
  return `${first} ${second}`;
}

export function extractPersonFromTranscript(transcript: string): PersonExtractionResult {
  const text = transcript.replace(/\s+/gu, " ").trim();
  const person: ExtractedPerson = { intent: "unknown", cities: [], features: {}, summary: text };
  const evidence: PersonExtractionResult["evidence"] = {};

  // --- שם ---
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(text);
    const raw = match?.groups?.["name"];
    const name = raw === undefined ? undefined : cleanName(raw);
    if (name !== undefined) {
      person.name = name;
      evidence.name = match?.[0];
      break;
    }
  }

  // --- טלפון ---
  const phone = parsePhone(text);
  if (phone) {
    person.phone = phone.phone;
    evidence.phone = phone.evidence;
  }

  // --- כוונה ---
  if (/רוצה למכור|מוכר את|יש לו דירה למכירה|בעל נכס/u.test(text)) {
    person.intent = "sell";
    evidence.intent = "מוכר";
  } else if (/רוצה להשכיר|משכיר|להשכרה שלו/u.test(text)) {
    person.intent = "rent_out";
    evidence.intent = "משכיר";
  } else if (
    /מחפש להשכיר|מחפש לשכור|רוצה לשכור|שוכר|שכירות/u.test(text) ||
    // "מחפש דירה להשכרה" — ביקוש לשכירות, לא היצע (ביקורת Codex)
    /(?:מחפש|מחפשת|מעוניין|מעוניינת|צריך|צריכה)[^,.]{0,20}להשכרה/u.test(text)
  ) {
    person.intent = "rent_in";
    person.dealType = "rent";
    evidence.intent = "שוכר";
  } else if (/מחפש|מעוניין לקנות|רוצה לקנות|קונה|מחפשת/u.test(text)) {
    person.intent = "buy";
    person.dealType = "sale";
    evidence.intent = "קונה";
  } else if (/מתעניין|שאל|בירור/u.test(text)) {
    person.intent = "info";
  }

  // --- ערים ---
  for (const city of CITIES) {
    if (text.includes(city)) person.cities.push(city);
  }
  if (person.cities.length > 0) evidence.cities = person.cities.join(", ");

  // --- תקציב: "עד 2.3 מיליון", "בין 1.5 ל-2 מיליון", "תקציב 900 אלף" ---
  const range = /(?:בין|מ-?)\s*(?<min>\d+(?:[.,]\d+)?)\s*(?:מיליון)?\s*(?:עד|ל-?)\s*(?<max>\d+(?:[.,]\d+)?)\s*מיליון/u.exec(text);
  if (range?.groups?.["min"] !== undefined && range.groups["max"] !== undefined) {
    person.budgetMinAgorot = Math.round(Number(range.groups["min"].replace(",", ".")) * 100_000_000);
    person.budgetMaxAgorot = Math.round(Number(range.groups["max"].replace(",", ".")) * 100_000_000);
    evidence.budgetMaxAgorot = range[0];
  } else {
    // "עד X" / "תקציב X" — מחפשים את הסכום בהקשר הקרוב, ואם אין, בכל הטקסט
    const scoped = /(?:עד|תקציב של|תקציב|מקסימום|מקס)\s*(?<rest>[^,.]{0,30})/u.exec(text);
    const amount = parseAmountAgorot(scoped?.groups?.["rest"] ?? "") ?? parseAmountAgorot(text);
    if (amount) {
      person.budgetMaxAgorot = amount.agorot;
      evidence.budgetMaxAgorot = amount.evidence;
    }
  }

  // --- חדרים: "3-4 חדרים", "לפחות 4 חדרים", "4 חדרים" ---
  const roomsRange = /(?<min>\d+(?:[.,]5)?)\s*(?:-|עד|ל-)\s*(?<max>\d+(?:[.,]5)?)\s*חדרים/u.exec(text);
  const roomsAtLeast = /(?:לפחות|מינימום)\s*(?<num>\d+(?:[.,]5)?)\s*חדרים/u.exec(text);
  const roomsPlain = /(?<num>\d+(?:[.,]5)?|[א-ת]+)(?:\s+וחצי)?\s+חדרים/u.exec(text);
  if (roomsRange?.groups?.["min"] !== undefined && roomsRange.groups["max"] !== undefined) {
    person.roomsMin = Number(roomsRange.groups["min"].replace(",", "."));
    person.roomsMax = Number(roomsRange.groups["max"].replace(",", "."));
    evidence.roomsMin = roomsRange[0];
  } else if (roomsAtLeast?.groups?.["num"] !== undefined) {
    person.roomsMin = Number(roomsAtLeast.groups["num"].replace(",", "."));
    evidence.roomsMin = roomsAtLeast[0];
  } else if (roomsPlain?.groups?.["num"] !== undefined) {
    let rooms = parseNumberWord(roomsPlain.groups["num"]);
    if (rooms !== undefined && roomsPlain[0].includes("וחצי")) rooms += 0.5;
    if (rooms !== undefined && rooms >= 1 && rooms <= 20) {
      person.roomsMin = rooms;
      person.roomsMax = rooms;
      evidence.roomsMin = roomsPlain[0];
    }
  }

  // --- שטח מינימלי ---
  const area = /(?:לפחות|מינימום|מ-)\s*(?<area>\d{2,4})\s*(?:מטר|מ["״]ר)/u.exec(text);
  if (area?.groups?.["area"] !== undefined) {
    person.areaSqmMin = Number(area.groups["area"]);
    evidence.areaSqmMin = area[0];
  }

  // --- בשלות ---
  if (/דחוף|בדחיפות|מחפש עכשיו|צריך מיד|מיידי/u.test(text)) {
    person.maturity = "very_hot";
    evidence.maturity = "דחוף";
  } else if (/בחודשים הקרובים|בקרוב|תוך חצי שנה|רציני/u.test(text)) {
    person.maturity = "hot";
    evidence.maturity = "בקרוב";
  } else if (/רק בודק|לא ממהר|בעוד שנה|מתעניין בלבד/u.test(text)) {
    person.maturity = "not_ripe";
    evidence.maturity = "לא ממהר";
  }

  // --- מימון ---
  if (/במזומן|כסף מזומן|הון עצמי מלא/u.test(text)) {
    person.financing = "cash";
    evidence.financing = "מזומן";
  } else if (/אישור עקרוני/u.test(text)) {
    person.financing = "pre_approved";
    evidence.financing = "אישור עקרוני";
  } else if (/משכנתא בתהליך|בתהליך משכנתא|מסדר משכנתא/u.test(text)) {
    person.financing = "in_process";
    evidence.financing = "משכנתא בתהליך";
  } else if (/עוד לא התחיל|בלי משכנתא עדיין/u.test(text)) {
    person.financing = "not_started";
  }

  // --- מאפיינים: "חייב X" ⇒ חובה, "רוצה/עדיף X" ⇒ עדיפות ---
  const featureMap: [string, keyof ExtractedPerson["features"]][] = [
    ["מעלית", "hasElevator"],
    ["חניה", "hasParking"],
    ["מרפסת", "hasBalcony"],
    ['ממ"ד', "hasSafeRoom"],
    ["ממ״ד", "hasSafeRoom"],
    ["מחסן", "hasStorage"],
  ];
  for (const [word, field] of featureMap) {
    // שלילה מפורשת ⇒ לא דרישה כלל. "בלי מעלית"/"לא צריך חניה" לא
    // הופכים לדרישה שתשפיע על ציון ההתאמה (ביקורת Codex)
    const negated = new RegExp(`(?:בלי|ללא|אין|לא\\s+צריך|לא\\s+חייב|לא\\s+חשוב|לא\\s+מעניין)\\s+(?:[^,.]{0,12}\\s)?${word}`, "u").test(text);
    if (negated) continue;

    if (new RegExp(`(?:חייב|חייבת|הכרחי|חובה)\\s+(?:[^,.]{0,12}\\s)?${word}`, "u").test(text)) {
      person.features[field] = "must";
    } else if (new RegExp(`(?:רוצה|מעדיף|מעדיפה|עדיף|רצוי|כדאי)\\s+(?:[^,.]{0,12}\\s)?${word}`, "u").test(text)) {
      person.features[field] = "nice";
    } else if (new RegExp(`(?:עם|כולל|ו)${word}|${word}`, "u").test(text)) {
      person.features[field] ??= "nice";
    }
  }
  if (Object.keys(person.features).length > 0) {
    evidence.features = Object.keys(person.features).join(", ");
  }

  return { person, evidence };
}
