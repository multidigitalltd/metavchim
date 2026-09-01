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
