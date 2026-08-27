import { describe, expect, it } from "vitest";
import { groundedNumbers } from "./insight-guard.js";

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
