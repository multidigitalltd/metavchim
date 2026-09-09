import { describe, expect, it } from "vitest";
import {
  decodeCp1255,
  decodeImportBytes,
  detectDelimiter,
  isValidUtf8,
} from "./import-encoding.js";

/** ‏מקודד מחרוזת עברית ל-Windows-1255 — ההפך מהפענוח שנבדק. */
function toCp1255(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) out.push(code);
    else if (code >= 0x05d0 && code <= 0x05ea) out.push(0xe0 + (code - 0x05d0));
    else if (code === 0x20aa) out.push(0xa4); // ₪
    else if (code === 0x201e) out.push(0x84); // „
    else if (code === 0x201d) out.push(0x94); // ”
    else throw new Error(`אין מיפוי ל-${ch}`);
  }
  return new Uint8Array(out);
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("זיהוי UTF-8", () => {
  it("מקבל UTF-8 תקין — עברית, אמוג'י, ASCII", () => {
    for (const text of ["hello", "שלום עולם", "דירה 4 חדרים 🏠", ""]) {
      expect(isValidUtf8(utf8(text)), text).toBe(true);
    }
  });

  /*
   * ‎**זו הבדיקה שעליה הכל תלוי.** בדיקה סלחנית הייתה מקבלת עברית
   * ‏ב-1255, מחזירה „UTF-8” וג'יבריש — בדיוק התקלה שהתיקון הזה
   * ‏קיים בשבילה, רק שקטה יותר.
   */
  it("ודוחה עברית של Windows-1255", () => {
    for (const text of ["שלום", "הרצל 12, תל אביב", "מוכר על המחיר"]) {
      expect(isValidUtf8(toCp1255(text)), text).toBe(false);
    }
  });

  it("ודוחה קידוד-יתר, חצי-זוג ומה שמעל U+10FFFF", () => {
    // C0 80 — קידוד-יתר של NUL
    expect(isValidUtf8(new Uint8Array([0xc0, 0x80]))).toBe(false);
    // E0 80 80 — קידוד-יתר תלת-בייטי
    expect(isValidUtf8(new Uint8Array([0xe0, 0x80, 0x80]))).toBe(false);
    // ED A0 80 — U+D800, חצי-זוג
    expect(isValidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(false);
    // F4 90 80 80 — מעל U+10FFFF
    expect(isValidUtf8(new Uint8Array([0xf4, 0x90, 0x80, 0x80]))).toBe(false);
    // רצף שנקטע באמצע
    expect(isValidUtf8(new Uint8Array([0xd7, 0xa9, 0xd7]))).toBe(false);
  });
});

describe("פענוח Windows-1255", () => {
  it("מחזיר את כל 22 האותיות והסופיות", () => {
    const alphabet = "אבגדהוזחטיכלמנסעפצקרשתךםןףץ";
    expect(decodeCp1255(toCp1255(alphabet))).toBe(alphabet);
  });

  /*
   * ‏שני התווים שבהם 1255 נבדל מ-Latin-1. מי שמעתיק טבלה כללית
   * ‏מקבל ¤ במקום ₪ — וזה מחיר שמוצג שגוי, לא תקלת תצוגה.
   */
  it("ו-₪ ו-× נמצאים במקום הנכון", () => {
    expect(decodeCp1255(new Uint8Array([0xa4]))).toBe("₪");
    expect(decodeCp1255(new Uint8Array([0xaa]))).toBe("×");
    expect(decodeCp1255(new Uint8Array([0xba]))).toBe("÷");
  });

  it("ובית שאינו מוגדר הופך לתו החלפה, ולא נעלם", () => {
    expect(decodeCp1255(new Uint8Array([0x81]))).toBe("�");
    expect(decodeCp1255(new Uint8Array([0xff]))).toBe("�");
  });
});

describe("בחירת הקידוד", () => {
  it("UTF-8 כשהוא תקין", () => {
    expect(decodeImportBytes(utf8("עיר,רחוב"))).toEqual({
      text: "עיר,רחוב",
      encoding: "utf-8",
    });
  });

  it("ומדלג על BOM של UTF-8", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("עיר")]);
    expect(decodeImportBytes(withBom)).toEqual({ text: "עיר", encoding: "utf-8" });
  });

  it("ונופל ל-1255 רק כשהוא נפסל", () => {
    expect(decodeImportBytes(toCp1255("שם,טלפון"))).toEqual({
      text: "שם,טלפון",
      encoding: "windows-1255",
    });
  });

  it("ומכבד BOM של UTF-16 — הייצוא „Unicode Text” של אקסל", () => {
    const le = new Uint8Array([0xff, 0xfe, 0xe2, 0x05, 0xd9, 0x05, 0xe8, 0x05]);
    expect(decodeImportBytes(le)).toEqual({ text: "עיר", encoding: "utf-16le" });
    const be = new Uint8Array([0xfe, 0xff, 0x05, 0xe2, 0x05, 0xd9, 0x05, 0xe8]);
    expect(decodeImportBytes(be)).toEqual({ text: "עיר", encoding: "utf-16be" });
  });

  /*
   * ‏1255 מקבל כל רצף בייטים, ולכן ניסיון שלו לפני UTF-8 היה
   * ‏מצליח תמיד ומחזיר ג'יבריש לקובץ כשר. הסדר הוא ההגנה.
   */
  it("וקובץ UTF-8 לעולם אינו נקרא כ-1255", () => {
    const { encoding } = decodeImportBytes(utf8("דירת 4 חדרים ברחוב הרצל 12, ₪2,750,000"));
    expect(encoding).toBe("utf-8");
  });
});

describe("זיהוי המפריד", () => {
  it("פסיק הוא ברירת המחדל", () => {
    expect(detectDelimiter("עיר,רחוב,מחיר\nתל אביב,הרצל,100")).toBe(",");
    expect(detectDelimiter("עמודה אחת")).toBe(",");
    expect(detectDelimiter("")).toBe(",");
  });

  it("וטאב כשהוא שכיח ממנו — הייצוא של webtiv", () => {
    expect(detectDelimiter("שיוך\t*\tשם\tטלפון1\tמחיר\nא\tב\tג\tד\tה")).toBe("\t");
  });

  it("ונקודה-פסיק — אקסל בלוקאל אירופי", () => {
    expect(detectDelimiter("עיר;רחוב;מחיר")).toBe(";");
  });

  /*
   * ‎**„2,980,000” הוא תא אחד.** ספירה שאינה מכבדת מרכאות הייתה
   * ‏מוצאת בקובץ הטאבים האמיתי יותר פסיקים מטאבים — ובוחרת פסיק,
   * ‏כלומר משאירה את התקלה המקורית בדיוק כפי שהייתה.
   */
  it("ופסיקים בתוך מרכאות אינם נספרים", () => {
    expect(detectDelimiter('שם\tמחיר\nיוסי\t"2,980,000"')).toBe("\t");
    expect(detectDelimiter('"א,ב,ג,ד"\t"ה,ו,ז"\tח')).toBe("\t");
  });

  it("ורק שורת הכותרת נספרת", () => {
    // ‏שורה שנייה מלאה בטאבים אינה משנה כותרת שהיא פסיקים
    expect(detectDelimiter("עיר,רחוב\nא\tב\tג\tד\tה\tו\tז")).toBe(",");
  });

  it("ומפריד אחר נבחר רק כשהוא שכיח ממש — שוויון נשאר פסיק", () => {
    expect(detectDelimiter("א,ב\tג")).toBe(",");
  });
});
