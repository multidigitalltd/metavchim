/**
 * שומר העובדות של הניסוח הטבעי — מספר שלא נשלף אינו נאמר.
 *
 * המודל מקבל את התוצאות שהקוד שלף ומתבקש לנסח אותן טבעי. „אל
 * תמציא נתונים” בפרומפט הוא בקשה, לא אכיפה: מודל שמנסח „נמצאו
 * חמישה נכסים סביב 2,400,000” כשבנתונים אין מחיר כזה — המציא
 * מחיר, והמתווך יצטט אותו ללקוח. ההנחיה נשארת, אבל הגבול נאכף כאן,
 * בקוד: תשובה עם ספרות שאינן במקורות נפסלת כולה, והערוץ נופל לניסוח
 * הדטרמיניסטי שעומד בפני עצמו ממילא.
 *
 * הבדיקה מכוונת **לספרות** — מחירים, ספירות, חדרים, טלפונים — כי שם
 * המצאה נראית כמו עובדה. מילים („שלושה”, „יקר”) אינן נבדקות: הן
 * פרשנות, לא נתון, והרשימה המלאה מוצגת מתחת בכל מקרה.
 *
 * מספר בטקסט נחשב מעוגן באחת משתי דרכים:
 *
 * 1. **בצורתו המאוחדת** — מפרידי אלפים ונקודות נמחקים משני הצדדים,
 *    ולכן „1,200,000” מול „1200000” עוברים זה על זה. בלי האיחוד,
 *    המחיר היה מתפרק לרצפים קצרים („1”, „200”, „000”) שנמצאים כמעט
 *    בכל מקור — והשומר היה עיוור בדיוק למחיר המומצא.
 * 2. **בחלקיו על המקור הגולמי** — „27.8” שנוסח מתוך „2026-08-27”
 *    אינו קיים מאוחד, אבל „27” ו-„8” כן. עיצוב מחדש של תאריך הוא
 *    ניסוח, לא המצאה, והוא עובר בדרך הזו.
 */

/** מפרידי אלפים ונקודות עשרוניות — נמחקים לצורת ההשוואה המאוחדת. */
const joinDigits = (text: string): string => text.replace(/(?<=\d)[,.](?=\d)/gu, "");

export function groundedNumbers(text: string, sources: readonly string[]): boolean {
  const raw = sources.join("\n");
  const joined = joinDigits(raw);
  const tokens = text.match(/\d+(?:[,.]\d+)*/gu) ?? [];
  return tokens.every((token) => {
    if (joined.includes(joinDigits(token))) return true;
    return (token.match(/\d+/gu) ?? []).every((run) => raw.includes(run));
  });
}

/**
 * ‎**ספירה שנאמרה — לא יותר ממה שחזר.**
 *
 * ‏„כמה קונים יש לי?” נענה במשפט הראשון בספירה, ומודל שכותב אותה
 * ‏במילים („שבעה קונים”) עוקף את בדיקת הספרות. ובספרות הבדיקה חלשה
 * ‏במספרים קטנים: „7” נמצא כמעט בכל JSON, ולו רק במזהה (ביקורת Codex).
 *
 * ‏לכן ספירה — מספר (בספרות או במילים) שצמוד לשם עצם של **השורות
 * ‏ברשימה** — נבדקת מול הסך שהמפיק הצהיר עליו: לא יותר ממנו. תת-ספירה
 * ‏(„שניים מהם חמים”) קטנה ממנו ועוברת; ספירה מומצאת גדולה ממנו ונפסלת
 * ‏עם המשפט כולו.
 *
 * ‏שם העצם הוא של **הרשימה**, לא כל שם עצם: „חמישה מיילים שלא נקראו”
 * ‏בשתי שיחות מייל, או „שלושה נכסים מתאימים” לביקוש — הם מדדים בתוך
 * ‏שורה, לא ספירה של השורות, ואינם נבדקים מול הסך (ביקורת Codex).
 */
export interface AgentResultCount {
  /** ‏המפתח של הרשימה בנתונים — `buyers`, `emails`, `callbacks`… */
  readonly section: string;
  readonly total: number;
}

/** ‏לכל רשימה — שמות העצם שספירה שלהם היא ספירה של השורות שלה. */
const SECTION_NOUNS: Record<string, { plural: string; singular: string }> = {
  buyers: { plural: "קונים|קונות|לקוחות", singular: "קונה|לקוח|לקוחה" },
  leads: { plural: "לידים|פניות", singular: "ליד|פנייה" },
  properties: { plural: "נכסים|דירות|בתים", singular: "נכס|דירה|בית" },
  // ‏התאמות לקונה הן נכסים, ולנכס — קונים
  matches: {
    plural: "התאמות|קונים|קונות|לקוחות|נכסים|דירות|בתים",
    singular: "התאמה|קונה|לקוח|נכס|דירה|בית",
  },
  exclusivity: { plural: "בלעדיות|נכסים|דירות", singular: "בלעדיות|נכס|דירה" },
  agreements: { plural: "הסכמים|מסמכים|ממתינים", singular: "הסכם|מסמך" },
  offers: { plural: "הצעות", singular: "הצעה" },
  demands: { plural: "ביקושים", singular: "ביקוש" },
  // ‏הסך הוא של שיחות המייל; מיילים בתוכן הם מדד בתוך שורה
  emails: { plural: "שיחות|שרשורים|התכתבויות", singular: "שיחה|שרשור|התכתבות" },
  callbacks: { plural: "ממתינים|אנשים|לקוחות", singular: "ממתין|אדם|לקוח" },
  tasks: { plural: "משימות|תזכורות", singular: "משימה|תזכורת" },
  appointments: { plural: "פגישות|סיורים|ביקורים", singular: "פגישה|סיור|ביקור" },
  notifications: { plural: "התראות|עדכונים", singular: "התראה|עדכון" },
};

/** ‏„שבע תוצאות” — ספירה של השורות בכל רשימה (ביקורת Codex). */
const ROW_NOUNS = { plural: "תוצאות|רשומות|שורות|פריטים", singular: "תוצאה|רשומה|שורה|פריט" };

/** ‏יחידות — כל הצורות: זכר, נקבה, נסמך, וצורת „שנים/שתים” של י״א–י״ט. */
const UNITS: Record<string, number> = {
  אחד: 1, אחת: 1,
  שני: 2, שתי: 2, שניים: 2, שתיים: 2, שנים: 2, שתים: 2,
  שלושה: 3, שלוש: 3, שלושת: 3,
  ארבעה: 4, ארבע: 4, ארבעת: 4,
  חמישה: 5, חמש: 5, חמשת: 5,
  שישה: 6, שש: 6, ששת: 6,
  שבעה: 7, שבע: 7, שבעת: 7,
  שמונה: 8, שמונת: 8,
  תשעה: 9, תשע: 9, תשעת: 9,
};
const TEN: Record<string, number> = { עשר: 10, עשרה: 10, עשרת: 10 };
const TENS: Record<string, number> = {
  עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90,
};

const alt = (words: Record<string, number>): string => Object.keys(words).join("|");
const BEFORE = "(?<![\\p{L}\\d])";
const AFTER = "(?![\\p{L}\\d])";

/*
 * ‏מספר במילים — לפי הדקדוק, לא צורה-צורה: אלפים, אחריהם מאות, ואחריהן
 * ‏השארית, כל חלק אפשר עם „ו”. „שלושת אלפים ומאתיים וחמישים”, „מאה
 * ‏וחמישים”, „עשרים ושלושה”. מילים צמודות שאינן מספר אחד („ביום שני
 * ‏שלושה קונים”) אינן מתחברות — כל אחת נבדקת לבד.
 */
const REST = `(?:${alt(TENS)})(?:\\s+ו(?:${alt(UNITS)}))?|(?:${alt(UNITS)})\\s+(?:${alt(TEN)})|${alt(UNITS)}|${alt(TEN)}`;
const HUNDREDS = `(?:(?:${alt(UNITS)})\\s+)?מאות|מאתיים|מאה`;
const THOUSANDS = `(?:(?:${REST})\\s+)?(?:אלפים|אלף)|אלפיים`;
const NUMBER = `(?:${THOUSANDS})(?:\\s+ו?(?:${HUNDREDS}))?(?:\\s+ו?(?:${REST}))?|(?:${HUNDREDS})(?:\\s+ו?(?:${REST}))?|${REST}`;

/** ‏הערך של מספר במילים שהדקדוק כבר אישר. */
function wordsValue(phrase: string): number {
  let total = 0;
  let group = 0;
  for (const raw of phrase.split(/\s+/u)) {
    const word = raw.startsWith("ו") ? raw.slice(1) : raw;
    if (word === "אלף" || word === "אלפים") {
      total += (group === 0 ? (word === "אלף" ? 1 : 2) : group) * 1000;
      group = 0;
    } else if (word === "אלפיים") total += 2000;
    else if (word === "מאות") group = (group === 0 ? 2 : group) * 100;
    else if (word === "מאה") group += 100;
    else if (word === "מאתיים") group += 200;
    else group += UNITS[word] ?? TEN[word] ?? TENS[word] ?? 0;
  }
  return total + group;
}

const claims = new Map<string, { plural: RegExp; singular: RegExp }>();
function claimsOf(section: string): { plural: RegExp; singular: RegExp } | undefined {
  const nouns = SECTION_NOUNS[section];
  if (nouns === undefined) return undefined;
  let built = claims.get(section);
  if (built === undefined) {
    const plural = `${nouns.plural}|${ROW_NOUNS.plural}`;
    const singular = `${nouns.singular}|${ROW_NOUNS.singular}`;
    built = {
      plural: new RegExp(`${BEFORE}ו?(?:(${NUMBER})|(\\d[\\d,]*))\\s+(?:${plural})${AFTER}`, "gu"),
      singular: new RegExp(`${BEFORE}(?:${singular})\\s+(?:אחד|אחת)${AFTER}`, "u"),
    };
    claims.set(section, built);
  }
  return built;
}

export function countsWithin(text: string, count: AgentResultCount): boolean {
  const claim = claimsOf(count.section);
  if (claim === undefined) return true;
  for (const [, words, digits] of text.matchAll(claim.plural)) {
    const value = words !== undefined ? wordsValue(words) : Number(digits!.replaceAll(",", ""));
    if (value > count.total) return false;
  }
  // ‏„קונה אחד” — יחיד; נפסל רק כשלא חזר אף אחד
  return count.total >= 1 || text.search(claim.singular) === -1;
}
