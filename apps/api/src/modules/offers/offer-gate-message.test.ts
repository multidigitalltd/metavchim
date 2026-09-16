import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgreementFieldsMissingError } from "../agreements/agreements.service";

/**
 * ‎**ההודעה מנוסחת סביב מה שהמשתמש לחץ.**
 *
 * ‏שער ההצעות מפיק הזמנה בכתב בעצמו כשאין חתומה, ולכן משרד חדש
 * ‏שלחץ „שלח הצעה” קיבל „אי אפשר **לשלוח הסכם לחתימה** בלי פרטי
 * ‏החובה” — הודעה על פעולה שהוא לא ביקש, בלי לרמוז מה הקשר להצעה.
 * ‏נמצא בבדיקת QA מול מערכת חיה (משרד חדש, הגדרות ריקות).
 *
 * ‏הכלל — אילו שדות חובה — נשאר ב-`AgreementsService`. רק הניסוח
 * ‏עבר לקורא, כי רק הוא יודע על מה נלחץ.
 */

const OFFERS = readFileSync(join(import.meta.dirname, "offers.service.ts"), "utf8");

const GATE = (() => {
  const from = OFFERS.indexOf("private async signatureGate(");
  const to = OFFERS.indexOf("private async offerSignatureSatisfied(");
  expect(from, "signatureGate לא נמצאה").toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return OFFERS.slice(from, to);
})();

describe("השגיאה שמשרד חדש מקבל על „שלח הצעה”", () => {
  it("השער מנסח מחדש את החוסר במונחי ההצעה", () => {
    expect(GATE).toContain("AgreementFieldsMissingError");
    expect(GATE).toContain("כדי לשלוח הצעה");
  });

  /*
   * ‏רשימת השדות באה מהשגיאה ולא מרשימה מקומית — אחרת היה כאן
   * ‏עותק שני של „מה חובה”, שנפרד מהראשון בעדכון הבא.
   */
  it("רשימת השדות מגיעה מהשגיאה, ולא מועתקת", () => {
    expect(GATE).toContain("error.fields");
    expect(GATE).not.toContain("REQUIRED_PLACEHOLDERS");
  });

  it("שגיאה אחרת אינה נבלעת", () => {
    expect(GATE).toContain("if (!(error instanceof AgreementFieldsMissingError)) throw error;");
  });
});

describe("השגיאה נושאת את השדות החסרים", () => {
  it("השדות נגישים לקורא, ומופיעים גם בנוסח המקורי", () => {
    const err = new AgreementFieldsMissingError(["דמי תיווך", "מועד תשלום"]);
    expect(err.fields).toEqual(["דמי תיווך", "מועד תשלום"]);
    expect(err.message).toContain("דמי תיווך, מועד תשלום");
    /* ‏מי שבאמת לחץ „שלח לחתימה” ממשיך לקבל את הנוסח המקורי */
    expect(err.message).toContain("אי אפשר לשלוח הסכם לחתימה");
    expect(err.getStatus()).toBe(400);
  });
});
