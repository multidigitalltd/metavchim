/**
 * סכומים בעברית מדוברת — **מילים, לא רק ספרות.**
 *
 * ## הבעיה
 *
 * מנועי החילוץ קראו "2.3 מיליון" ו"900 אלף", אבל תמלול של דיבור
 * אמיתי מגיע במילים: "שני מיליון", "שבע מאות אלף", "מיליון שש
 * מאות". התוצאה: "מה יש לי ברמת גן עד שני מיליון" זוהה נכון
 * כשאלה — וחזר בלי תקרת מחיר, כלומר עם נכסים מעל שני מיליון
 * (ביקורת Codex). סכום שנבלע בשקט מסוכן יותר מסכום שנדחה.
 *
 * ## מה מכוסה
 *
 * הצורות שנאמרות בפועל בשוק הנדל"ן:
 *
 * - "שני מיליון", "שלושה מיליון", "מיליון"
 * - "מיליון וחצי", "שני מיליון וחצי", "מיליון ורבע", "חצי מיליון"
 * - "מיליון שש מאות", "שני מיליון שש מאות אלף", "מיליון ומאתיים"
 * - "שבע מאות אלף", "מאתיים חמישים אלף", "תשע מאות וחמישים אלף"
 * - "עשרים אלף", "שלושים וחמישה אלף" (שכירות)
 *
 * לא מכוסה בכוונה: מספרים מתחת לאלף במילים ("חמש מאות שקל") —
 * בשוק הזה הם אינם מחיר, וכלל רחב מדי היה תופס חדרים וקומות.
 */

/** יחידות 1–10, זכר ונקבה — התמלול אינו עקבי במין הדקדוקי. */
const UNITS: Record<string, number> = {
  אחד: 1,
  אחת: 1,
  שניים: 2,
  שתיים: 2,
  שני: 2,
  שתי: 2,
  שלוש: 3,
  שלושה: 3,
  ארבע: 4,
  ארבעה: 4,
  חמש: 5,
  חמישה: 5,
  שש: 6,
  שישה: 6,
  שבע: 7,
  שבעה: 7,
  שמונה: 8,
  תשע: 9,
  תשעה: 9,
  עשר: 10,
  עשרה: 10,
};

const TENS: Record<string, number> = {
  עשרים: 20,
  שלושים: 30,
  ארבעים: 40,
  חמישים: 50,
  שישים: 60,
  שבעים: 70,
  שמונים: 80,
  תשעים: 90,
};

const UNIT_WORDS = Object.keys(UNITS).join("|");
const TENS_WORDS = Object.keys(TENS).join("|");

/**
 * "שש מאות" / "מאה" / "מאתיים" — מאות, כמספר.
 * מחזיר `undefined` כשהקטע אינו ביטוי מאות.
 */
function hundredsValue(text: string): number | undefined {
  if (text === "מאה") return 100;
  if (text === "מאתיים") return 200;
  const match = new RegExp(`^(?:${UNIT_WORDS})\\s+מאות$`, "u").exec(text);
  if (match) {
    const unit = UNITS[text.split(/\s+/u)[0]!];
    return unit === undefined ? undefined : unit * 100;
  }
  return undefined;
}

/** "חמישים" / "שלושים וחמישה" / "חמישה" — 1–99, כמספר. */
function smallValue(text: string): number | undefined {
  const clean = text.trim();
  if (UNITS[clean] !== undefined) return UNITS[clean];
  if (TENS[clean] !== undefined) return TENS[clean];
  const compound = new RegExp(`^(?<tens>${TENS_WORDS})\\s+ו(?<unit>${UNIT_WORDS})$`, "u").exec(
    clean,
  );
  if (compound?.groups) {
    return TENS[compound.groups["tens"]!]! + UNITS[compound.groups["unit"]!]!;
  }
  return undefined;
}

/*
 * הביטוי המלא, כטקסט אחד — כדי שה-evidence שמוצג למתווך יהיה
 * בדיוק מה שנאמר, ולא שחזור שלנו.
 *
 * שלוש משפחות, מהספציפי לכללי:
 * 1) מיליונים: "[שני] מיליון [וחצי|ורבע| [ו]X מאות [אלף]| [ו]מאתיים [אלף]]"
 * 2) "חצי מיליון" / "רבע מיליון"
 * 3) מאות אלפים / עשרות אלפים: "[X מאות|מאה|מאתיים] [וY] אלף", "Y אלף"
 */
const MILLIONS = new RegExp(
  `(?:(?<mUnit>${UNIT_WORDS})\\s+)?מיליון` +
    `(?:\\s+(?<mFrac>וחצי|ורבע)` +
    `|\\s+ו?(?<mHund>(?:${UNIT_WORDS})\\s+מאות|מאה|מאתיים)(?:\\s+אלף)?` +
    `|\\s+ו?(?<mThou>(?:${TENS_WORDS})(?:\\s+ו(?:${UNIT_WORDS}))?)\\s+אלף` +
    `)?`,
  "u",
);

const HALF_MILLION = /(?<frac>חצי|רבע)\s+מיליון/u;

const THOUSANDS = new RegExp(
  `(?:(?<tHund>(?:${UNIT_WORDS})\\s+מאות|מאה|מאתיים)` +
    `(?:\\s+ו?(?<tSmall>(?:${TENS_WORDS})(?:\\s+ו(?:${UNIT_WORDS}))?|${UNIT_WORDS}))?` +
    `|(?<tOnly>(?:${TENS_WORDS})(?:\\s+ו(?:${UNIT_WORDS}))?))\\s+אלף`,
  "u",
);

/**
 * הסכום הראשון במילים שמופיע בטקסט, בשקלים.
 *
 * שקלים ולא אגורות: זו שכבת שפה, והמרה למטבע הפנימי היא החלטה של
 * הקורא — בדיוק כמו שהספרות מטופלות אצלו.
 */
export function parseSpokenAmountShekels(
  text: string,
): { shekels: number; evidence: string } | undefined {
  const normalized = text.replace(/\s+/gu, " ");

  // "חצי מיליון" לפני "מיליון" — אחרת "מיליון" שבתוכו נתפס לבד
  const half = HALF_MILLION.exec(normalized);
  const millions = MILLIONS.exec(normalized);
  if (half && (!millions || half.index < millions.index)) {
    return {
      shekels: half.groups!["frac"] === "חצי" ? 500_000 : 250_000,
      evidence: half[0],
    };
  }

  if (millions) {
    const unit = millions.groups?.["mUnit"];
    let shekels = (unit === undefined ? 1 : UNITS[unit]!) * 1_000_000;
    const frac = millions.groups?.["mFrac"];
    if (frac === "וחצי") shekels += 500_000;
    if (frac === "ורבע") shekels += 250_000;
    const hund = millions.groups?.["mHund"];
    if (hund !== undefined) {
      const value = hundredsValue(hund);
      if (value !== undefined) shekels += value * 1_000;
    }
    const thou = millions.groups?.["mThou"];
    if (thou !== undefined) {
      const value = smallValue(thou);
      if (value !== undefined) shekels += value * 1_000;
    }
    return { shekels, evidence: millions[0] };
  }

  const thousands = THOUSANDS.exec(normalized);
  if (thousands) {
    const hund = thousands.groups?.["tHund"];
    const small = thousands.groups?.["tSmall"] ?? thousands.groups?.["tOnly"];
    let count = 0;
    if (hund !== undefined) count += hundredsValue(hund) ?? 0;
    if (small !== undefined) count += smallValue(small) ?? 0;
    /*
     * "אלף" לבדו (בלי כמות לפניו) אינו סכום נדל"ן — "אלף פעמים
     * אמרתי לו" היה הופך לתקציב. כמות אפס = אין זיהוי.
     */
    if (count === 0) return undefined;
    return { shekels: count * 1_000, evidence: thousands[0] };
  }

  return undefined;
}
