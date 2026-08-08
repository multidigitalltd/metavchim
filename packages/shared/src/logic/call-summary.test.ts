import { describe, expect, it } from "vitest";
import { summarizeCall } from "./call-summary.js";

describe("summarizeCall — חילוץ פרטים", () => {
  it("תקציב במיליונים", () => {
    expect(summarizeCall("הוא מחפש עד 2.4 מיליון").highlights.budget).toBe(2_400_000);
  });

  it('"מיליון וחצי" בלי ספרה', () => {
    expect(summarizeCall("התקציב שלו מיליון וחצי").highlights.budget).toBe(1_500_000);
  });

  // "וחצי" מתייחס למיליון, לא לספרה שלפניו — 2.5 ולא 2 ועוד חצי-שתיים
  it('"2 מיליון וחצי"', () => {
    expect(summarizeCall("עד 2 מיליון וחצי").highlights.budget).toBe(2_500_000);
  });

  it("אלפים", () => {
    expect(summarizeCall("תקציב של 800 אלף").highlights.budget).toBe(800_000);
  });

  it("מספר עם פסיקים", () => {
    expect(summarizeCall("המחיר 1,500,000 שקל").highlights.budget).toBe(1_500_000);
  });

  it("חדרים, כולל חצי", () => {
    expect(summarizeCall("מחפש 3.5 חדרים").highlights.rooms).toBe(3.5);
  });

  it("עיר", () => {
    expect(summarizeCall("רוצה בבני ברק").highlights.city).toBe("בני ברק");
  });

  it("מועד חזרה", () => {
    expect(summarizeCall("אמרתי שנחזור אליו מחר").highlights.callback).toBe("מחר");
  });

  it("תמלול ריק אינו מפיל", () => {
    expect(summarizeCall("   ")).toEqual({ summary: "", highlights: {}, suggestedOutcome: null });
  });
});

describe("summarizeCall — תוצאת השיחה", () => {
  it("עניין", () => {
    expect(summarizeCall("נשמע טוב, בוא נתקדם").suggestedOutcome).toBe("interested");
  });

  // הבדיקה שבגללה הסדר בקוד הפוך: "לא מתאים" מכיל "מתאים", וללא
  // בדיקת השלילה תחילה שיחה שנגמרה בסירוב הייתה מסומנת כהתעניינות
  it('"לא מתאים לי" אינו נחשב עניין', () => {
    expect(summarizeCall("זה לא מתאים לי").suggestedOutcome).toBe("not_fit");
  });

  it('"מצאנו כבר" — לא מתאים', () => {
    expect(summarizeCall("תודה, מצאנו כבר משהו אחר").suggestedOutcome).toBe("not_fit");
  });

  it("בקשה לחזור", () => {
    expect(summarizeCall("אני צריך להתייעץ עם אשתי, תתקשר בשבוע הבא").suggestedOutcome).toBe(
      "callback",
    );
  });

  // ניחוש על שיחה עמומה גרוע מהיעדר ניחוש — המתווך יסתמך עליו
  it("בלי איתות ברור — לא מנחשים", () => {
    expect(summarizeCall("דיברנו על מזג האוויר").suggestedOutcome).toBeNull();
  });
});

describe("summarizeCall — שורת הסיכום", () => {
  it("מרכיבה את כל מה שזוהה", () => {
    const result = summarizeCall(
      "מעוניין בדירת 4 חדרים בפתח תקווה עד 2 מיליון, נחזור אליו מחר",
    );
    expect(result.summary).toBe("הביע עניין · 4 חדרים · פתח תקווה · עד 2 מיליון ₪ · לחזור מחר");
  });

  it("מציג אלפים כשהתקציב נמוך ממיליון", () => {
    expect(summarizeCall("מחפש עד 900 אלף").summary).toContain("900 אלף ₪");
  });

  it("שומר שבר במיליונים", () => {
    expect(summarizeCall("עד 2.4 מיליון").summary).toContain("2.4 מיליון ₪");
  });

  // שורה ריקה נראית למתווך כמו תקלה בתמלול
  it("בלי פרטים — ראש התמלול במקום שורה ריקה", () => {
    const result = summarizeCall("דיברנו על מזג האוויר ועל החגים");
    expect(result.summary).toBe("דיברנו על מזג האוויר ועל החגים");
  });

  it("חותך תמלול ארוך במקום לשבור את השורה", () => {
    const long = "מילה ".repeat(80);
    const result = summarizeCall(long);
    expect(result.summary.length).toBeLessThanOrEqual(121);
    expect(result.summary.endsWith("…")).toBe(true);
  });
});
