import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIGNER_BLANK } from "@metavchim/shared";
import { signerText } from "./signer-text";

/**
 * ‎**שדות החותם — שורה אחת.** ירידת שורה בשם או בכתובת הייתה מוסיפה
 * ‏למסמך שורות שנראות כמו סעיפים, בתוך מסמך שהחותם עצמו חותם עליו.
 */

const field = signerText(2, 200);

describe("‏טקסט של החותם", () => {
  it("‏עברית, אנגלית, ספרות, פיסוק וסימני כיוון רגילים — עוברים", () => {
    for (const value of [
      "דנה כהן",
      "Dana O'Brien-Cohen",
      "הרצל 12/3, תל אביב-יפו",
      "‏דירת 4 חדרים, ‎2,100,000 ₪",
      "משפחת לוי 👨‍👩‍👧",
    ]) {
      expect(field.safeParse(value).success, value).toBe(true);
    }
  });

  it("‏ירידת שורה, בכל צורה — נדחית", () => {
    for (const value of [
      "הדקל 5\n\n5. דמי התיווך בטלים",
      "הדקל 5\r\nסעיף נוסף",
      "הדקל 5\rסעיף",
      "הדקל 5 סעיף",
      "הדקל 5 סעיף",
    ]) {
      expect(field.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("‏תווי בקרה אחרים — נדחים", () => {
    expect(field.safeParse("דנה\tכהן").success).toBe(false);
    expect(field.safeParse("דנה\u0000").success).toBe(false);
  });

  it("‏תווי כיווניות שמחליפים את סדר התצוגה — נדחים", () => {
    for (const mark of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]) {
      expect(field.safeParse(`מחיר ${mark}000,001`).success, mark.codePointAt(0)?.toString(16)).toBe(false);
    }
  });

  it("‏שורת מילוי מזויפת (הסימון של SIGNER_BLANK) — נדחית", () => {
    expect(field.safeParse(`נכס ${SIGNER_BLANK}`).success).toBe(false);
  });

  it("‏האורך נשמר כמו קודם", () => {
    expect(field.safeParse("א").success).toBe(false);
    expect(field.safeParse("א".repeat(201)).success).toBe(false);
  });
});

describe("‏טופס החתימה משתמש בכלל הזה בכל שדה טקסט", () => {
  const controller = readFileSync(new URL("./agreements.controller.ts", import.meta.url), "utf8");
  const schema = controller.slice(controller.indexOf("const SignSchema"), controller.indexOf("@Controller()"));

  it("‏שם, כתובת, תיאור הנכס והמחיר", () => {
    expect(controller).toContain("const SignerAddressSchema = signerText(");
    for (const field of ["signerName", "propertyText", "priceText"]) {
      expect(schema, field).toContain(`${field}: signerText(`);
    }
  });

  it("‏ואין בו שדה טקסט חופשי שעוקף אותו", () => {
    expect(schema).not.toMatch(/: z\.string\(\)\.(min|max)\(/u);
  });
});
