import { describe, expect, it } from "vitest";
import { PhoneInputSchema } from "./common.js";

describe("PhoneInputSchema — הטלפון כפי שאדם מקליד", () => {
  /*
   * הבאג שנסגר: `0504143565` נדחה ב„קלט לא תקין” בעריכת בעל הנכס,
   * כי שלושה מסכים החזיקו נרמול פרטי ושני מסכי העריכה לא.
   */
  it("הצורה המקומית מתקבלת", () => {
    expect(PhoneInputSchema.parse("0504143565")).toBe("+972504143565");
  });

  it("מקפים ורווחים אינם משנים דבר", () => {
    expect(PhoneInputSchema.parse(" 050-414-3565 ")).toBe("+972504143565");
  });

  it("‎972 בלי פלוס — מה שדבק מאקסל", () => {
    expect(PhoneInputSchema.parse("972504143565")).toBe("+972504143565");
  });

  it("כבר מנורמל — נשאר כמו שהוא", () => {
    expect(PhoneInputSchema.parse("+972504143565")).toBe("+972504143565");
  });

  it("‎**קלט פגום עדיין נדחה** — הנרמול אינו מכסה על שגיאה", () => {
    expect(() => PhoneInputSchema.parse("12")).toThrow();
    expect(() => PhoneInputSchema.parse("לא מספר")).toThrow();
  });
});

/*
 * ‎**מספר מחו״ל — קונים ומוכרים תושבי חוץ** (בקשת המשתמש).
 * ‏הוא מגיע עם קידומת מדינה, ב-+ או ב-00, ונשמר ב-E.164 כמו כל מספר.
 */
describe("PhoneInputSchema — מספר מחו״ל", () => {
  it.each([
    ["+1 212 555 0100", "+12125550100"],
    ["+44 7700 900123", "+447700900123"],
    ["+33 6 12 34 56 78", "+33612345678"],
    ["001 212 555 0100", "+12125550100"],
    ["00972-50-414-3565", "+972504143565"],
  ])("%s → %s", (typed, stored) => {
    expect(PhoneInputSchema.parse(typed)).toBe(stored);
  });

  it("בלי קידומת מדינה — לא מנחשים מדינה", () => {
    expect(() => PhoneInputSchema.parse("12125550100")).toThrow();
  });

  it("קידומת ישראלית עדיין נבדקת כישראלית", () => {
    expect(() => PhoneInputSchema.parse("+972 1 234 5678")).toThrow();
    expect(() => PhoneInputSchema.parse("+9720504143565")).toThrow();
  });

  it("ארוך מ-15 ספרות — נדחה", () => {
    expect(() => PhoneInputSchema.parse("+1234567890123456")).toThrow();
  });
});

/*
 * ‎**כל טופס שאדם מקליד בו טלפון — אותו נרמול.** בית פתוח שמר את המספר
 * ‏כפי שהוקלד, ולכן אותו מבקר ב-‎0012125550100‎ וב-‎+1 212…‎ נפתח פעמיים.
 */
describe("בית פתוח — הטלפון מנורמל", () => {
  it.each([
    ["0012125550100", "+12125550100"],
    ["050-123-4567", "+972501234567"],
  ])("%s → %s", async (typed, stored) => {
    const { OpenHouseWalkInSchema } = await import("./open-house.js");
    expect(OpenHouseWalkInSchema.parse({ name: "דנה כהן", phone: typed }).phone).toBe(stored);
  });
});
