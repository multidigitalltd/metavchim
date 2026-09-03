import { describe, expect, it } from "vitest";
import {
  cleanQuoteAuthor,
  cleanQuoteText,
  dailyQuoteIndex,
  orderQuotes,
  QUOTE_AUTHOR_MAX_LENGTH,
  QUOTE_MAX_LENGTH,
  type MentorQuote,
} from "./mentor-quotes.js";

/**
 * ‎**מה שנבדק כאן הוא הכללים, לא הרשימה.**
 *
 * ‏אין יותר רשימת משפטים בקוד — הם נכתבים בידי הפלטפורמה ובידי כל
 * משרד. לכן הבדיקות שואלות שאלות אחרות: מה נשמר, באיזה סדר מוצג,
 * ואיפה הסליידר נפתח.
 */

function quote(id: string, scope: MentorQuote["scope"]): MentorQuote {
  return { id, text: `משפט ${id}`, author: "", scope };
}

describe("ניקוי המשפט", () => {
  /** ‏שקופית ריקה בסליידר נראית כמו באג, ולכן ריק אינו משפט. */
  it("שורה ריקה אינה משפט", () => {
    expect(cleanQuoteText("")).toBeNull();
    expect(cleanQuoteText("   ")).toBeNull();
    expect(cleanQuoteText("\n\t \n")).toBeNull();
  });

  it("רווחים וירידות שורה מתקפלים לרווח אחד", () => {
    expect(cleanQuoteText("  שתי   מילים  ")).toBe("שתי מילים");
    expect(cleanQuoteText("שורה\nשנייה")).toBe("שורה שנייה");
  });

  it("הטקסט נחתך לגבול העמודה במסד", () => {
    expect(cleanQuoteText("א".repeat(1000))?.length).toBe(QUOTE_MAX_LENGTH);
  });
});

describe("ניקוי „מי אמר”", () => {
  /**
   * ‎**ריק הוא תשובה, ולא חוסר.** מנהל משרד שחיבר משפט לצוות שלו
   * אינו חייב לייחס אותו לאיש, ו„— לא ידוע” מתחת למשפט כזה הוא
   * המצאה קטנה שאין בה צורך.
   */
  it("ריק נשאר ריק ואינו הופך ל„לא ידוע”", () => {
    expect(cleanQuoteAuthor("")).toBe("");
    expect(cleanQuoteAuthor("   ")).toBe("");
  });

  it("נחתך לגבול העמודה", () => {
    expect(cleanQuoteAuthor("ב".repeat(300)).length).toBe(QUOTE_AUTHOR_MAX_LENGTH);
  });
});

describe("סדר התצוגה", () => {
  /**
   * ‏מי שכתב את המשפט קרוב יותר למי שקורא אותו: משפט שמנהל המשרד
   * ניסח לצוות שלו אינו אמור להיבלע אחרי עשרה משפטים כלליים.
   */
  it("המשפטים של המשרד לפני אלה של הפלטפורמה", () => {
    const mixed = [
      quote("p1", "platform"),
      quote("o1", "office"),
      quote("p2", "platform"),
      quote("o2", "office"),
    ];
    expect(orderQuotes(mixed).map((q) => q.id)).toEqual(["o1", "o2", "p1", "p2"]);
  });

  it("בתוך כל היקף נשמר הסדר שהגיע", () => {
    const platformOnly = [quote("c", "platform"), quote("a", "platform")];
    expect(orderQuotes(platformOnly).map((q) => q.id)).toEqual(["c", "a"]);
  });

  it("אינו מאבד ואינו משכפל משפטים", () => {
    const mixed = [quote("p1", "platform"), quote("o1", "office")];
    expect(orderQuotes(mixed)).toHaveLength(mixed.length);
  });
});

describe("נקודת הפתיחה של הסליידר", () => {
  const day = (iso: string): Date => new Date(`${iso}T09:00:00.000Z`);

  /**
   * ‎**יציבות בתוך היום היא התנאי לכך שהמספר ייחשב בשני הצדדים.**
   * ‏‎`Math.random` היה נותן לשרת מספר אחד ולדפדפן אחר, והמסך היה
   * מהבהב בטעינה. שתי קריאות באותו יום חייבות להסכים.
   */
  it("אותו יום — אותו משפט, גם בשעות שונות", () => {
    const a = dailyQuoteIndex(7, new Date("2026-09-03T05:00:00.000Z"));
    const b = dailyQuoteIndex(7, new Date("2026-09-03T20:00:00.000Z"));
    expect(a).toBe(b);
  });

  it("יום אחר — משפט אחר", () => {
    const week = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"].map((d) =>
      dailyQuoteIndex(4, day(d)),
    );
    /* ‏ארבעה ימים רצופים על ארבעה משפטים — כל אחד מקבל תורו */
    expect(new Set(week).size).toBe(4);
  });

  it("תמיד בתוך גבולות הרשימה", () => {
    for (const count of [1, 2, 3, 5, 13, 60]) {
      const index = dailyQuoteIndex(count, day("2026-09-03"));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
  });

  /** ‏רשימה ריקה אינה קורסת: אין משפט להציג, ואין חריגה. */
  it("רשימה ריקה מחזירה אפס ולא NaN", () => {
    expect(dailyQuoteIndex(0, day("2026-09-03"))).toBe(0);
  });
});
