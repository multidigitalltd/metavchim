import { describe, expect, it } from "vitest";
import { isSharedTabuProperty, SHARED_TABU_PROPERTY_TYPE } from "@metavchim/shared";
import { fieldsToColumns, rowToFields } from "./property.mapper";
import { sharedTabuWhere } from "./properties.service";

/**
 * ‎**עובדה אחת, שני מקורות — ושתי דליפות הפוכות** (ביקורת Codex, P1).
 *
 * ‏`shared_tabu` קיים ב-`PropertyTypeSchema` מלפני הדגל, והמסלולים
 * ‏שמזינים אותו חיים: מחלץ ההקלטה, ייבוא ה-CSV, וכל שורה שנרשמה כך.
 *
 * ‏דירה שסומן עליה הדגל נפסלה מקונה שביקש את הסוג; ונכס שנרשם בסוג
 * ‏נשאר עם דגל `false` — בלי האזהרה, בלי הסינון ובלי שידוך שותפים.
 * ‏דווקא הנכסים שהתכונה נבנתה בשבילם היו היחידים שלא מקבלים אותה.
 */

/** ‏טבלת המקרים שכל צורות השאלה נבדקות מולה. */
const CASES: { sharedTabu: boolean; propertyType: string; expected: boolean; why: string }[] = [
  { sharedTabu: true, propertyType: "apartment", expected: true, why: "דגל על דירה רגילה" },
  { sharedTabu: false, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "הסוג הוותיק לבדו" },
  { sharedTabu: true, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "שניהם" },
  { sharedTabu: false, propertyType: "penthouse", expected: false, why: "אף אחד" },
];

describe("isSharedTabuProperty — התשובה היחידה", () => {
  for (const testCase of CASES) {
    it(testCase.why, () => {
      expect(isSharedTabuProperty(testCase)).toBe(testCase.expected);
    });
  }
});

describe("‏הקריאה מהשורה גוזרת משני המקורות", () => {
  for (const testCase of CASES) {
    it(testCase.why, () => {
      expect(rowToFields({ ...testCase, attributes: null } as never).sharedTabu).toBe(
        testCase.expected,
      );
    });
  }
});

describe("‏הכתיבה — הסוג מדליק ולעולם לא מכבה", () => {
  it("סוג „טאבו משותף” מדליק את הדגל גם כשלא נשלח", () => {
    expect(fieldsToColumns({ propertyType: SHARED_TABU_PROPERTY_TYPE }).sharedTabu).toBe(true);
  });

  /*
   * ‏זה החלק שקל לטעות בו: גזירה סימטרית הייתה **מוחקת** סימון
   * ‏מפורש ברגע ששינו „דירה” ל„פנטהאוז”, בלי שאיש ביקש.
   */
  it("שינוי סוג בלבד אינו מכבה סימון קיים", () => {
    expect("sharedTabu" in fieldsToColumns({ propertyType: "penthouse" })).toBe(false);
  });

  it("הדגל ששולח מפורשות שולט", () => {
    expect(fieldsToColumns({ sharedTabu: false, propertyType: "apartment" }).sharedTabu).toBe(false);
    expect(fieldsToColumns({ sharedTabu: true, propertyType: "apartment" }).sharedTabu).toBe(true);
  });

  it("ומה שלא נשלח כלל אינו נכתב", () => {
    expect("sharedTabu" in fieldsToColumns({ city: "רעננה" })).toBe(false);
  });
});

/**
 * ‏ה-SQL הוא הצורה השנייה והאחרונה של אותה שאלה, ולכן הוא נבדק
 * ‏**מול הפונקציה** ולא מול ציפייה שנכתבה ביד: שתי רשימות שנכתבות
 * ‏בנפרד מסכימות ביום שנכתבו ולא ביום שאחריו.
 */
describe("sharedTabuWhere מסכים עם isSharedTabuProperty", () => {
  /** ‏הרצה של תנאי Prisma על שורה אחת — בדיוק המקרים שהעזר מייצר. */
  function holds(where: Record<string, unknown>, row: { sharedTabu: boolean; propertyType: string }) {
    if (Array.isArray(where["OR"])) {
      return (where["OR"] as Record<string, unknown>[]).some((clause) => holds(clause, row));
    }
    return Object.entries(where).every(([key, condition]) => {
      const value = row[key as "sharedTabu" | "propertyType"];
      if (condition !== null && typeof condition === "object" && "not" in condition) {
        return value !== (condition as { not: unknown }).not;
      }
      return value === condition;
    });
  }

  for (const testCase of CASES) {
    it(`„רק משותפים” — ${testCase.why}`, () => {
      expect(holds(sharedTabuWhere(true) as Record<string, unknown>, testCase)).toBe(
        testCase.expected,
      );
    });

    it(`„רק רישום נפרד” — ${testCase.why}`, () => {
      expect(holds(sharedTabuWhere(false) as Record<string, unknown>, testCase)).toBe(
        !testCase.expected,
      );
    });
  }

  it("בלי ערך — בלי תנאי", () => {
    expect(sharedTabuWhere(undefined)).toEqual({});
  });
});
