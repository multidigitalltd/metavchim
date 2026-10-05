import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AgreementFieldsMissingError } from "../agreements/agreements.service";

/**
 * ‎**ההודעה מנוסחת סביב מה שהמשתמש לחץ.**
 *
 * ‏שני מסכים מפיקים הזמנה בכתב בעצמם כשאין חתומה — „שלח הצעה”
 * ‏ו„דף השוואה” — ולכן משרד חדש שלחץ עליהם קיבל „אי אפשר **לשלוח
 * ‏הסכם לחתימה** בלי פרטי החובה”: הודעה על פעולה שהוא לא ביקש,
 * ‏בלי לרמוז מה הקשר. שניהם נמצאו בבדיקת QA מול מערכת חיה (משרד
 * ‏חדש, הגדרות ריקות).
 *
 * ‏הכלל — אילו שדות חובה — נשאר ב-`AgreementsService`, והניסוח
 * ‏המשותף נשאר ב-`forAction`. הקורא מוסיף רק את מה שנלחץ.
 */

function gateOf(file: string, from: string, to: string): string {
  const source = readFileSync(join(import.meta.dirname, file), "utf8");
  const start = source.indexOf(from);
  const end = source.indexOf(to);
  expect(start, `${from} לא נמצא ב-${file}`).toBeGreaterThan(-1);
  expect(end, `${to} לא נמצא ב-${file}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const GATES = [
  {
    what: "„שלח הצעה”",
    action: "כדי לשלוח הצעה",
    source: gateOf("offers.service.ts", "private async signatureGate(", "private async offerSignatureSatisfied("),
  },
  {
    what: "„דף השוואה”",
    action: "כדי להכין דף השוואה",
    source: gateOf("comparison.service.ts", "async create(", "async listForBuyer("),
  },
];

describe.each(GATES)("השגיאה שמשרד חדש מקבל על $what", ({ action, source }) => {
  it("השער מנסח מחדש את החוסר במונחי הפעולה שנלחצה", () => {
    expect(source).toContain("AgreementFieldsMissingError");
    expect(source).toContain(`forAction("${action}")`);
  });

  /*
   * ‏גם רשימת השדות וגם המשפט עצמו מגיעים מהשגיאה — אחרת היה כאן
   * ‏עותק שני של „מה חובה” או של „איך אומרים שחסר”, שנפרד מהמקור
   * ‏בעדכון הבא.
   */
  it("שום ניסוח מקומי אינו משכפל את השגיאה", () => {
    expect(source).not.toContain("fields.join(");
    expect(source).not.toContain("REQUIRED_PLACEHOLDERS");
  });

  it("שגיאה אחרת אינה נבלעת", () => {
    expect(source).toContain("if (!(error instanceof AgreementFieldsMissingError)) throw error;");
  });
});

describe("השגיאה נושאת את השדות החסרים", () => {
  const err = new AgreementFieldsMissingError(["דמי תיווך", "מועד תשלום"]);

  it("מי שבאמת לחץ „שלח לחתימה” מקבל את הנוסח המקורי", () => {
    expect(err.fields).toEqual(["דמי תיווך", "מועד תשלום"]);
    expect(err.message).toContain("אי אפשר לשלוח הסכם לחתימה");
    expect(err.message).toContain("דמי תיווך, מועד תשלום");
    expect(err.getStatus()).toBe(400);
  });

  it("`forAction` פותח בפעולה שנלחצה, ונושא את אותם שדות", () => {
    const reworded = err.forAction("כדי להכין דף השוואה");
    expect(reworded.message).toMatch(/^כדי להכין דף השוואה /u);
    expect(reworded.message).toContain("דמי תיווך, מועד תשלום");
    expect(reworded.message).not.toContain("אי אפשר לשלוח הסכם לחתימה");
    expect(reworded.getStatus()).toBe(400);
  });
});
