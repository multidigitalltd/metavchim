import { describe, expect, it } from "vitest";
import { countsWithin, groundedNumbers } from "./insight-guard.js";

const SOURCE = JSON.stringify([
  { name: "משה כהן", city: "גבעתיים", rooms: 4, price: 2450000 },
  { name: "דנה לוי", city: "רמת גן", rooms: 3.5, price: 1900000, nextViewing: "2026-08-27" },
]);

describe("groundedNumbers — מספר שלא נשלף אינו נאמר", () => {
  it("טקסט בלי ספרות תמיד מעוגן — מילים הן פרשנות, לא נתון", () => {
    expect(groundedNumbers("נמצאו שלושה קונים, ואחד מהם חם במיוחד.", [SOURCE])).toBe(true);
  });

  it("מספר שקיים בנתונים עובר, גם בעיצוב אחר", () => {
    expect(groundedNumbers("שניהם מחפשים עד 2,450,000 ש\"ח.", [SOURCE])).toBe(true);
    expect(groundedNumbers("דנה מחפשת 3.5 חדרים.", [SOURCE])).toBe(true);
  });

  it("מחיר מומצא נפסל — גם כשהוא כתוב עם מפרידי אלפים", () => {
    /*
     * בלי איחוד הספרות בצד הטקסט, „1,200,000” מתפרק ל-„1”, „200”,
     * ‎„000” — רצפים שנמצאים כמעט בכל JSON עם מחירים. זה בדיוק
     * העיוורון שהשומר קיים כדי למנוע.
     */
    expect(groundedNumbers("הממוצע סביב 1,200,000 ש\"ח.", [SOURCE])).toBe(false);
    expect(groundedNumbers("נמצאו 17 קונים.", [SOURCE])).toBe(false);
  });

  it("תאריך שעוצב מחדש עובר — חלקיו קיימים במקור הגולמי", () => {
    expect(groundedNumbers("הסיור הקרוב ב-27.8.", [SOURCE])).toBe(true);
  });

  it("מספר מהשאלה של המתווך מעוגן דרך התמליל", () => {
    // „עד 12,500?” — המספר לא חייב להופיע בתוצאות כדי להיאמר בתשובה
    const text = "אין קונים בתקציב של 12,500 לחודש.";
    expect(groundedNumbers(text, [SOURCE, "מי מחפש שכירות עד 12500 שקל?"])).toBe(true);
    expect(groundedNumbers(text, [SOURCE])).toBe(false);
  });

  it("ספרה בודדת מעוגנת כמעט תמיד — השומר מקל בכוונה", () => {
    /*
     * ‎„5” נמצא בתוך „2450000”. זה מתועד ולא באג: השומר תופס מחירים,
     * ספירות וטלפונים — לא ספרות בודדות, שממילא אינן „עובדה” שמתווך
     * יצטט. מי שמצפה כאן ל-false משנה את אופי השומר, לא מתקן אותו.
     */
    expect(groundedNumbers("אולי שווה לחפש גם 5 חדרים.", [SOURCE])).toBe(true);
  });
});

describe("countsWithin — ספירה שנאמרה אינה גדולה ממה שחזר", () => {
  it("ספירה במילים שגדולה מהרשימה — נפסלת", () => {
    expect(countsWithin("יש לך שבעה קונים ברמת גן", 2)).toBe(false);
  });

  it("ספירה בספרות שגדולה מהרשימה — נפסלת", () => {
    expect(countsWithin("נמצאו 7 קונים", 2)).toBe(false);
  });

  it("הספירה הנכונה ותת-ספירה — עוברות", () => {
    expect(countsWithin("יש לך שני קונים, ו-1 קונים חמים מהם", 2)).toBe(true);
    expect(countsWithin("שלושה לידים חדשים, ושני לידים מהם חמים", 3)).toBe(true);
  });

  it("מספר שאינו ספירה של רשומות — אינו נבדק כאן", () => {
    expect(countsWithin("הפגישה ביום שני בשעה 10", 1)).toBe(true);
    expect(countsWithin("דירה של 5 חדרים", 1)).toBe(true);
  });
});

describe("countsWithin — יחיד, ומה שאינו ספירה", () => {
  it("„קונה אחד” כשלא חזר אף קונה — נפסל; כשחזר — עובר", () => {
    expect(countsWithin("יש לך קונה אחד ברמת גן", 0)).toBe(false);
    expect(countsWithin("יש לך קונה אחד ברמת גן", 1)).toBe(true);
  });

  it("„דירות 4 חדרים” אינה ספירה של רשומות", () => {
    expect(countsWithin("שתיהן דירות 4 חדרים", 2)).toBe(true);
  });
});

describe("countsWithin — מספרים במילים מעל עשר", () => {
  it("עשרות, י״א–י״ט, ו„עשרים ושלושה” — נבדקים מול הסך", () => {
    expect(countsWithin("יש לך עשרים קונים", 12)).toBe(false);
    expect(countsWithin("יש לך שנים עשר קונים", 12)).toBe(true);
    expect(countsWithin("יש לך שלושה עשר קונים", 12)).toBe(false);
    expect(countsWithin("עשרים ושלושה לידים חדשים", 23)).toBe(true);
    expect(countsWithin("עשרים ושלושה לידים חדשים", 22)).toBe(false);
    expect(countsWithin("מאה הצעות", 50)).toBe(false);
    expect(countsWithin("שלוש מאות הצעות", 150)).toBe(false);
  });

  // ‏היחידה שלפני „מאות”/„אלפים” כופלת אותן (ביקורת Codex)
  it("„תשע מאות”, „שלושת אלפים” — היחידה כופלת", () => {
    expect(countsWithin("תשע מאות הצעות", 500)).toBe(false);
    expect(countsWithin("תשע מאות הצעות", 900)).toBe(true);
    expect(countsWithin("שלושת אלפים קונים", 2500)).toBe(false);
    expect(countsWithin("עשרת אלפים קונים", 9999)).toBe(false);
    expect(countsWithin("אלפיים קונים", 1999)).toBe(false);
    expect(countsWithin("מאות הצעות", 250)).toBe(true);
    expect(countsWithin("מאות הצעות", 150)).toBe(false);
  });
});
