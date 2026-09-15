import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agreementRequiresProperty, AGREEMENT_KINDS } from "@metavchim/shared";

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
    expect(panel).toContain("ההסכם ייחתם בלי נכס בתוכו");
    /* ‏והחיווי ברשימה, שאליה המתווך חוזר כדי לבדוק על מה החתים. */
    expect(panel).toContain("בלי נכס מסוים — התחייבות כללית");
  });
});
