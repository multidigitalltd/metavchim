import { describe, expect, it } from "vitest";
import { telephonyGaps, telephonyProvider } from "./telephony.js";

/**
 * ‎**כתובת ה-Webhook אינה תלויה בפרטי 015 — וזה כל העניין.**
 *
 * ‏המפתח שבכתובת מזהה את המשרד, והמרכזייה דוחפת אליה. פרטי 015
 * ‏פותחים דברים אחרים — חיוג יוצא, הקלטות, סופטפון — ולכן מנהל
 * ‏שממתין להם מ-015 חייב להיות מסוגל להוציא את הכתובת עכשיו
 * ‏ולהתחיל לקלוט שיחות. הצימוד היה השגיאה.
 */

const P015 = telephonyProvider("015")!;
const GENERIC = telephonyProvider("generic")!;

describe("‏מה חסר לכל יכולת", () => {
  it("‏מרכזייה כללית — אין מה למלא, ואין פערים", () => {
    expect(telephonyGaps(GENERIC, {}, [])).toEqual([]);
  });

  it("‏015 בלי שום פרט — שלוש היכולות חסרות, וקליטת השיחות אינה אחת מהן", () => {
    const gaps = telephonyGaps(P015, {}, []);
    expect(gaps.map((gap) => gap.capability)).toEqual(["dialling", "recordings", "softphone"]);
  });

  it("‏פרטי החיוג מולאו — החיוג יורד מהרשימה, השאר נשאר", () => {
    const gaps = telephonyGaps(
      P015,
      { customer: "123", authUsername: "u" },
      ["authPassword"],
    );
    expect(gaps.map((gap) => gap.capability)).toEqual(["recordings", "softphone"]);
  });

  /* ‏סוד נמדד לפי שם ולא לפי ערך — הערך אינו עוזב את השרת */
  it("‏סיסמה שמורה נספרת כמלאה, גם בלי הערך", () => {
    const without = telephonyGaps(P015, { customer: "1", authUsername: "u" }, []);
    expect(without[0]?.missing).toEqual(["סיסמה ב-015"]);
    const with_ = telephonyGaps(P015, { customer: "1", authUsername: "u" }, ["authPassword"]);
    expect(with_.map((gap) => gap.capability)).not.toContain("dialling");
  });

  /* ‏רווחים אינם ערך: שדה שנשמר כרווח הוא שדה ריק */
  it("‏שדה שכולו רווחים נחשב חסר", () => {
    const gaps = telephonyGaps(P015, { customer: "   " }, []);
    expect(gaps[0]?.missing).toContain("מספר לקוח ב-015 (customer)");
  });

  /*
   * ‏שדות שאינם חוסמים דבר — „מזהה מתקשר”, „קו ברירת מחדל” — אינם
   * ‏מופיעים כפער. אחרת הרשימה הייתה אומרת „חסר” על מה שאיש לא
   * ‏חייב, וזה בדיוק מה שמרתיע ממילוי.
   */
  it("‏שדות לא-חוסמים אינם מופיעים כפער", () => {
    const gaps = telephonyGaps(P015, {}, []);
    const all = gaps.flatMap((gap) => gap.missing);
    expect(all).not.toContain("מזהה מתקשר שיוצג ללקוח (לא חובה)");
    expect(all).not.toContain("קו ברירת מחדל (כשלסוכן אין שלוחה ואין טלפון בפרופיל)");
  });

  it("‏הכל מולא — אין פערים", () => {
    const gaps = telephonyGaps(
      P015,
      { customer: "1", authUsername: "u", recordGroup: "12048", sipWssUrl: "wss://x", sipDomain: "sip.015.net" },
      ["authPassword"],
    );
    expect(gaps).toEqual([]);
  });

  /* ‏הסדר קבוע: מסך שמסדר פערים אחרת בכל טעינה נראה כאילו משהו זז */
  it("‏הסדר אינו תלוי בסדר השדות שמולאו", () => {
    const a = telephonyGaps(P015, { sipDomain: "s" }, []);
    const b = telephonyGaps(P015, { customer: "1" }, []);
    expect(a.map((g) => g.capability)).toEqual(["dialling", "recordings", "softphone"]);
    expect(b.map((g) => g.capability)).toEqual(["dialling", "recordings", "softphone"]);
  });
});
