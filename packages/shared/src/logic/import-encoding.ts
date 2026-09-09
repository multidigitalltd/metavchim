/**
 * ‎**איך קוראים קובץ ייבוא שלא נוצר אצלנו.**
 *
 * ‏משרד לא מייצא UTF-8 מופרד בפסיקים כי ביקשנו. הוא לוחץ „ייצוא”
 * ‏במערכת שיש לו, ומקבל מה שהיא נותנת. הייצוא של webtiv, למשל,
 * ‏הוא **Windows-1255 מופרד בטאבים** עם סיומת `.csv` — ושתי
 * ‏ההנחות שהיו לנו (‎`readAsText(file, "utf-8")` ופיצול על פסיק)
 * ‏שגויות בו בו-זמנית.
 *
 * ‏מה שהמתווך ראה: כל האותיות `?`, כל 17 העמודות נדחסות לאחת,
 * ‏ו„ייבא 0 נכסים”. הקובץ היה תקין; הקריאה שלו לא. הדרך שעבדה —
 * ‏להעלות לגוגל שיטס ולהוריד — עבדה **רק** כי שיטס מזהה קידוד
 * ‏ומפריד בעצמו וכותב UTF-8 עם פסיקים. כלומר הסיבוב הזה היה
 * ‏המימוש של הקובץ הזה, שנעשה ביד.
 *
 * ‏כאן הוא נעשה בקוד. הכל טהור וניתן לבדיקה: ‎`TextDecoder` אינו
 * ‏חלק מ-ES, ולכן הפענוח ידני — בדיוק כמו ב-`xlsx-import.ts`.
 */

/**
 * ‎**החצי העליון של Windows-1255.**
 *
 * ‏האותיות `0xE0`–`0xFA` רציפות מול `U+05D0`–`U+05EA`, ולכן הן
 * ‏מחושבות ולא נטבלאות. מה שכאן הוא כל השאר: ניקוד, פיסוק
 * ‏חלונאי, ושני התווים שבהם 1255 נבדל מ-Latin-1 ואי אפשר לנחש —
 * ‎`0xA4` הוא **₪** (ולא ¤), ו-`0xAA` הוא **×** (ולא ª).
 *
 * ‎`null` הוא בית שאינו מוגדר בקידוד; הוא הופך לתו החלפה.
 */
const CP1255_HIGH: readonly (number | null)[] = [
  /* 0x80 */ 0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  /* 0x88 */ 0x02c6, 0x2030, null, 0x2039, null, null, null, null,
  /* 0x90 */ null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  /* 0x98 */ 0x02dc, 0x2122, null, 0x203a, null, null, null, null,
  /* 0xA0 */ 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x20aa, 0x00a5, 0x00a6, 0x00a7,
  /* 0xA8 */ 0x00a8, 0x00a9, 0x00d7, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  /* 0xB0 */ 0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7,
  /* 0xB8 */ 0x00b8, 0x00b9, 0x00f7, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf,
  /* 0xC0 */ 0x05b0, 0x05b1, 0x05b2, 0x05b3, 0x05b4, 0x05b5, 0x05b6, 0x05b7,
  /* 0xC8 */ 0x05b8, 0x05b9, null, 0x05bb, 0x05bc, 0x05bd, 0x05be, 0x05bf,
  /* 0xD0 */ 0x05c0, 0x05c1, 0x05c2, 0x05c3, 0x05f0, 0x05f1, 0x05f2, 0x05f3,
  /* 0xD8 */ 0x05f4, null, null, null, null, null, null, null,
];

/** ‏האות הראשונה והאחרונה בטווח הרציף של 1255. */
const CP1255_ALEF = 0xe0;
const CP1255_TAV = 0xfa;

/** ‏תו ההחלפה — מה שבית לא-מוגדר הופך אליו. */
const REPLACEMENT = "�";

/**
 * ‎**האם הבייטים הם UTF-8 תקין — בבדיקה קפדנית.**
 *
 * ‏הקפדנות היא כל העניין: בדיקה סלחנית הייתה מקבלת גם עברית
 * ‏ב-1255 ומחזירה ג'יבריש „בהצלחה”. אות עברית ב-1255 היא
 * ‎`0xE0`–`0xFA`, שב-UTF-8 היא פתיח שדורש אחריו בייטי המשך
 * ‎`0x80`–`0xBF` — ואות עברית נוספת לעולם אינה כזו. לכן שתי
 * ‏אותיות סמוכות מפילות את הבדיקה, וזה בדיוק מה שצריך.
 *
 * ‏נדחים גם קידודי-יתר, חצאי-זוג (surrogates) ומה שמעל
 * ‎`U+10FFFF` — כולם „עוברים” בבדיקה תמימה ואינם UTF-8.
 */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i += 1;
      continue;
    }
    /** ‏כמה בייטי המשך, ומה הטווח המותר לראשון שבהם */
    let extra: number;
    let lowMin = 0x80;
    let lowMax = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b === 0xe0) {
      extra = 2;
      lowMin = 0xa0; // ‏מתחת לזה — קידוד-יתר של תו דו-בייטי
    } else if (b >= 0xe1 && b <= 0xec) extra = 2;
    else if (b === 0xed) {
      extra = 2;
      lowMax = 0x9f; // ‏מעל זה — חצי-זוג, שאינו תו
    } else if (b >= 0xee && b <= 0xef) extra = 2;
    else if (b === 0xf0) {
      extra = 3;
      lowMin = 0x90; // ‏קידוד-יתר
    } else if (b >= 0xf1 && b <= 0xf3) extra = 3;
    else if (b === 0xf4) {
      extra = 3;
      lowMax = 0x8f; // ‏מעל U+10FFFF
    } else return false; // 0x80–0xC1, 0xF5–0xFF — לעולם לא פתיח

    if (i + extra >= bytes.length) return false;
    const first = bytes[i + 1]!;
    if (first < lowMin || first > lowMax) return false;
    for (let k = 2; k <= extra; k += 1) {
      const cont = bytes[i + k]!;
      if (cont < 0x80 || cont > 0xbf) return false;
    }
    i += extra + 1;
  }
  return true;
}

/** ‎**פענוח Windows-1255** — האותיות בחשבון, השאר בטבלה. */
export function decodeCp1255(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= CP1255_ALEF && b <= CP1255_TAV) {
      out += String.fromCharCode(0x05d0 + (b - CP1255_ALEF));
    } else if (b === 0xfd) {
      out += "‎"; // LRM
    } else if (b === 0xfe) {
      out += "‏"; // RLM
    } else {
      const code = CP1255_HIGH[b - 0x80] ?? null;
      out += code === null ? REPLACEMENT : String.fromCharCode(code);
    }
  }
  return out;
}

/** ‏פענוח UTF-8 ידני — אותה סיבה שב-`xlsx-import.ts`. */
function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let code: number;
    if (b < 0x80) {
      code = b;
      i += 1;
    } else if (b < 0xe0) {
      code = ((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      code = ((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      code =
        ((b & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(code);
  }
  return out;
}

/** ‏פענוח UTF-16 לפי סדר הבייטים שה-BOM הכריז עליו. */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i]!;
    const b = bytes[i + 1]!;
    out += String.fromCharCode(littleEndian ? a | (b << 8) : (a << 8) | b);
  }
  return out;
}

/** ‏הקידוד שנבחר בפועל — כדי שהמסך יוכל לומר מה קרה. */
export type ImportEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1255";

export interface DecodedImport {
  text: string;
  encoding: ImportEncoding;
}

/**
 * ‎**קריאת קובץ ייבוא — הקידוד נקבע מהתוכן, לא מההנחה.**
 *
 * ‏הסדר אינו שרירותי: BOM הוא הצהרה מפורשת ולכן קודם לכל. אחריו
 * ‏UTF-8, כי הוא מה שרוב הייצואים המודרניים נותנים ובדיקתו
 * ‏חד-משמעית. ורק כשהוא נפסל — 1255, שהוא ברירת המחדל של
 * ‏אקסל עברי ישן ושל הייצוא של webtiv.
 *
 * ‎**1255 הוא הנפילה האחרונה ולא ניחוש ראשון**: כל רצף בייטים
 * ‏הוא 1255 „תקין”, ולכן ניסיון שלו לפני UTF-8 היה מצליח תמיד
 * ‏ומחזיר ג'יבריש לקובץ UTF-8 כשר.
 */
export function decodeImportBytes(bytes: Uint8Array): DecodedImport {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16(bytes.subarray(2), true), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16(bytes.subarray(2), false), encoding: "utf-16be" };
  }
  const body =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  return isValidUtf8(body)
    ? { text: decodeUtf8(body), encoding: "utf-8" }
    : { text: decodeCp1255(body), encoding: "windows-1255" };
}

/** ‏המפרידים שמערכות באמת מייצאות. */
export const IMPORT_DELIMITERS = [",", "\t", ";"] as const;
export type ImportDelimiter = (typeof IMPORT_DELIMITERS)[number];

/**
 * ‎**איזה תו מפריד בין העמודות.**
 *
 * ‏נספר בשורה הראשונה בלבד — היא הכותרת, ובה אין ערכים חופשיים
 * ‏שיטו את הספירה — ו**מחוץ למרכאות**, כי „2,980,000” הוא תא
 * ‏אחד ושלושת הפסיקים שבו אינם מפרידים. בלי זה, קובץ טאבים עם
 * ‏מחירים מצוטטים היה נקרא כקובץ פסיקים.
 *
 * ‏הפסיק הוא ברירת המחדל, ומפריד אחר נבחר רק אם הוא **מופיע
 * ‏ושכיח ממנו ממש**. כלומר קובץ פסיקים תקין לעולם אינו משנה
 * ‏התנהגות בעקבות השינוי הזה.
 */
export function detectDelimiter(csv: string): ImportDelimiter {
  const counts = new Map<ImportDelimiter, number>(IMPORT_DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i]!;
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) break; // ‏סוף שורת הכותרת
    if (inQuotes) continue;
    const known = IMPORT_DELIMITERS.find((d) => d === char);
    if (known !== undefined) counts.set(known, counts.get(known)! + 1);
  }
  const commas = counts.get(",")!;
  let best: ImportDelimiter = ",";
  let bestCount = commas;
  for (const d of IMPORT_DELIMITERS) {
    if (d === ",") continue;
    const n = counts.get(d)!;
    if (n > 0 && n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}
