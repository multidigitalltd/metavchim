import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agreementRequiresProperty,
  AGREEMENT_KINDS,
  defaultAgreementTemplate,
  renderAgreement,
  REQUIRED_PLACEHOLDERS,
  SIGNER_PROVIDED_PLACEHOLDERS,
  type AgreementValues,
} from "@metavchim/shared";

/**
 * ‎**„איזה הסכם חייב נכס” — שאלה אחת, ולכן מקור אחד.**
 *
 * ‏השרת אוכף את הכלל ב-`agreementRequiresProperty`, והמסך כתב אותו
 * ‏מחדש בעצמו — ובגרסה מחמירה יותר: הוא דרש נכס בשני הסוגים, בעוד
 * ‏שהשרת דורש אותו בבלעדיות בלבד. התוצאה הייתה מסלול שהשרת מתיר
 * ‏והמסך חוסם, כלומר פיצ'ר שקיים ואי אפשר להגיע אליו.
 *
 * ‏השערים כאן הם על **טקסט המקור** ולא על התנהגות, כי זה בדיוק מה
 * ‏שאין לו שגיאת קומפילציה: תנאי שנכתב ביד במסך ימשיך לעבוד, והוא
 * ‏פשוט יחלוק עם השרת ביום שהקטלוג ישתנה.
 */
const panel = readFileSync(
  join(__dirname, "../../../../../apps/web/src/app/agreements-panel.tsx"),
  "utf8",
);
const service = readFileSync(join(__dirname, "agreements.service.ts"), "utf8");

describe("הסכם בלי נכס — כלל אחד לשרת ולמסך", () => {
  it("הזמנה בכתב אינה דורשת נכס, בלעדיות כן", () => {
    expect(agreementRequiresProperty("brokerage")).toBe(false);
    expect(agreementRequiresProperty("exclusivity")).toBe(true);
  });

  it("לכל סוג בקטלוג יש תשובה — גם לזה שיתווסף מחר", () => {
    for (const kind of AGREEMENT_KINDS) {
      expect(typeof agreementRequiresProperty(kind)).toBe("boolean");
    }
  });

  it("המסך נשען על הכלל המשותף ואינו כותב תנאי משלו", () => {
    expect(panel).toContain("agreementRequiresProperty");
    /*
     * ‏התנאי שהיה: `needsProperty && chosenProperty === ""`, כלומר
     * ‏„אין נכס בהקשר” הפך ל„חובה לבחור נכס”. השם עצמו נמחק כדי
     * ‏שהבלבול לא יחזור בשם הישן.
     */
    expect(panel).not.toContain("needsProperty");
  });

  it("השרת אוכף את אותה פונקציה לפני היצירה", () => {
    expect(service).toContain("agreementRequiresProperty(input.kind)");
  });

  it("המסך מחווה למתווך שההסכם נוצר בלי נכס — לפני השליחה ואחריה", () => {
    /* ‏החיווי בדיאלוג, לפני שנוצר קישור. */
    expect(panel).toContain("ההסכם ייחתם בלי נכס מהמערכת");
    /* ‏והחיווי ברשימה, שאליה המתווך חוזר כדי לבדוק על מה החתים. */
    expect(panel).toContain("בלי נכס מסוים — התחייבות כללית");
  });

  /*
   * ‎**מסמך שלם, לא מסמך עם חורים** (ביקורת Codex, P1).
   *
   * ‏הגרסה הראשונה פתחה את המסלול במסך בלבד, ו-`create` היה דוחה
   * ‏אותו: הנוסח הדיפולטיבי נוקב ב-`סוג_העסקה`, `תיאור_הנכס`
   * ‏ו-`מחיר_משוער`, שלושתם `REQUIRED_PLACEHOLDERS.brokerage`,
   * ‏ובלי נכס אין ממה לגזור אותם. כלומר הכפתור החדש היה מחזיר
   * ‏שגיאת API במקום קישור לחתימה.
   */
  const blocking = (values: Partial<AgreementValues>): string[] =>
    renderAgreement(defaultAgreementTemplate("brokerage"), values).unfilled.filter(
      (name) =>
        REQUIRED_PLACEHOLDERS.brokerage.includes(name as keyof AgreementValues) &&
        !SIGNER_PROVIDED_PLACEHOLDERS.includes(name as keyof AgreementValues),
    );

  const filled: Partial<AgreementValues> = {
    שם_המשרד: "משרד",
    שם_הלקוח: "לקוח",
    דמי_תיווך: "2%",
    מועד_תשלום: "במעמד החתימה",
  };

  it("בלי נכס ובלי שלושת השדות — הנוסח הדיפולטיבי אינו שלם", () => {
    expect(blocking(filled).sort()).toEqual(
      ["מחיר_משוער", "סוג_העסקה", "תיאור_הנכס"].sort(),
    );
  });

  it("עם שלושת השדות שהמתווך הקליד — המסמך שלם", () => {
    expect(
      blocking({
        ...filled,
        סוג_העסקה: "מכר",
        תיאור_הנכס: "דירת 4 חדרים באזור המרכז",
        מחיר_משוער: "עד 2,500,000 ₪",
      }),
    ).toEqual([]);
  });

  it("המסך מציע את שלושת השדות בדיוק כשאין נכס", () => {
    for (const label of ["סוג העסקה *", "תיאור הנכס *", "מחיר משוער *"]) {
      expect(panel).toContain(label);
    }
    /* ‏ונשלחים רק כשאין נכס — עם נכס הם רעש, לא מקור שני. */
    expect(panel).toContain('effectiveProperty === ""');
  });

  it("כשיש נכס, הנכס גובר על ערכים שנשלחו בבקשה", () => {
    /*
     * ‏`...input.values` פרוש מעל כל המפתחות, ולכן בלי השורה הזו
     * ‏אפשר לשלוח `תיאור_הנכס` משלך ולקבל מסמך שנושא `propertyId`
     * ‏של נכס אחד ומתאר נכס אחר.
     */
    const after = service.indexOf("...input.values");
    expect(after).toBeGreaterThan(-1);
    expect(service.slice(after)).toContain("input.propertyId === undefined");
    expect(service.slice(after)).toContain("תיאור_הנכס: propertyText");
  });
});
