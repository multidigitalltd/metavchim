import { describe, expect, it } from "vitest";
import { taskMatchesPhrase } from "./resolve.service";

/**
 * ‎**איזו משימה נאמרה — לפי הכותרת וגם לפי הלקוח.**
 *
 * ‏דיווח משתמש: „תסגור את המשימה קונה שקט” הציג שמונה משימות זהות
 * ‏(„קונה שקט — ליצור קשר”), ואמירת שם הקונה כדי לבחור לא מצאה דבר —
 * ‏החיפוש היה בכותרת בלבד, והשם יושב בכרטיס שהמשימה קשורה אליו.
 */

const QUIET = { title: "קונה שקט — ליצור קשר", entityLabel: "דוד בריסק" };
const OTHER = { title: "קונה שקט — ליצור קשר", entityLabel: "רותי רייכנברג" };

describe("taskMatchesPhrase", () => {
  it("הכותרת לבדה — כל המשימות שנושאות אותה", () => {
    expect(taskMatchesPhrase("קונה שקט", QUIET)).toBe(true);
    expect(taskMatchesPhrase("קונה שקט", OTHER)).toBe(true);
  });

  it("כותרת ושם — רק המשימה של אותו לקוח, בכל סדר", () => {
    expect(taskMatchesPhrase("קונה שקט דוד בריסק", QUIET)).toBe(true);
    expect(taskMatchesPhrase("קונה שקט דוד בריסק", OTHER)).toBe(false);
    expect(taskMatchesPhrase("בריסק קונה שקט", QUIET)).toBe(true);
  });

  it("השם לבדו, עם „המשימה של” — מוצא", () => {
    expect(taskMatchesPhrase("המשימה של דוד בריסק", QUIET)).toBe(true);
    expect(taskMatchesPhrase("המשימה של דוד בריסק", OTHER)).toBe(false);
  });

  it("פיסוק שנדבק למילה אינו מפיל אותה", () => {
    expect(taskMatchesPhrase("קונה שקט,", QUIET)).toBe(true);
  });

  it("משימה בלי כרטיס — לפי הכותרת, כמו קודם", () => {
    expect(taskMatchesPhrase("החוזה", { title: "לשלוח את החוזה" })).toBe(true);
    expect(taskMatchesPhrase("דוד", { title: "לשלוח את החוזה" })).toBe(false);
  });

  it("ביטוי ריק — אינו מתאים לאף משימה", () => {
    expect(taskMatchesPhrase("", QUIET)).toBe(false);
  });

  it("משימה שכל כותרתה מילת קישור — נמצאת בשמה, ולא כל משימה אחרת", () => {
    expect(taskMatchesPhrase("תזכורת", { title: "תזכורת" })).toBe(true);
    expect(taskMatchesPhrase("את המשימה", QUIET)).toBe(false);
  });

  it("מילת קישור באמצע הכותרת היא חלק ממנה — אינה מרחיבה את ההתאמה", () => {
    expect(taskMatchesPhrase("פגישה עם דוד", { title: "פגישה עם דוד" })).toBe(true);
    expect(taskMatchesPhrase("פגישה עם דוד", { title: "פגישה דוד" })).toBe(false);
  });
});
