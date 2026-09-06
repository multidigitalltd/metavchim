import { describe, expect, it } from "vitest";
import { isSharedTabuProperty, SHARED_TABU_PROPERTY_TYPE } from "@metavchim/shared";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * ‎**טבלת המקרים שכל צורות השאלה נבדקות מולה — כולל `null`.**
 *
 * ‏שורת ה-`null` אינה השלמה: ב-SQL כל השוואה ל-`NULL` היא
 * ‏`UNKNOWN`, ולכן `property_type <> 'shared_tabu'` **מוציא** נכס
 * ‏בלי סוג. בלי השורה הזו שתי הצורות מסכימות על כל מה שנבדק,
 * ‏ונפרדות בדיוק על מה שלא — וטיוטה בלי סוג היא המקרה הנפוץ
 * ‏(ביקורת Codex, P1).
 */
const CASES: {
  sharedTabu: boolean;
  propertyType: string | null;
  expected: boolean;
  why: string;
}[] = [
  { sharedTabu: true, propertyType: "apartment", expected: true, why: "דגל על דירה רגילה" },
  { sharedTabu: false, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "הסוג הוותיק לבדו" },
  { sharedTabu: true, propertyType: SHARED_TABU_PROPERTY_TYPE, expected: true, why: "שניהם" },
  { sharedTabu: false, propertyType: "penthouse", expected: false, why: "אף אחד" },
  { sharedTabu: false, propertyType: null, expected: false, why: "טיוטה בלי סוג" },
  { sharedTabu: true, propertyType: null, expected: true, why: "טיוטה בלי סוג, עם הדגל" },
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
  /**
   * ‏הרצה של תנאי Prisma על שורה אחת.
   *
   * ‎`OR` הוא **מפתח לצד האחרים** ולא במקומם: הענף „רישום נפרד”
   * ‏הוא `sharedTabu: false` **וגם** אחד משני תנאי הסוג. גרסה
   * ‏קודמת של העזר החזירה על ה-`OR` והתעלמה מהשאר — כלומר הייתה
   * ‏מאשרת גם שורה שהדגל שלה דלוק.
   */
  function holds(
    where: Record<string, unknown>,
    row: { sharedTabu: boolean; propertyType: string | null },
  ): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === "OR") {
        return (condition as Record<string, unknown>[]).some((clause) => holds(clause, row));
      }
      const value = row[key as "sharedTabu" | "propertyType"];
      if (condition !== null && typeof condition === "object" && "not" in condition) {
        /* ‏`{ not: x }` ב-Prisma אינו תופס `NULL` — כמו ב-SQL */
        return value !== null && value !== (condition as { not: unknown }).not;
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

/**
 * ‎**דגל על הכרטיס אינו שורה מקושרת** (ביקורת Codex, P1).
 *
 * ‏מיזוג כפילויות מעביר שורות שמצביעות על הכפיל — קונים, לידים,
 * ‏נכסים, הודעות — ואז מוחק אותו. „טאבו משותף” אינו כזה: הוא דגל
 * ‏על הכרטיס עצמו, ולכן הוא נמחק יחד עם הכפיל בשקט.
 *
 * ‏והנזק דחוי: הכרטיס הממוזג נראה תקין, ורק בהמרה לנכס מאוחר יותר
 * ‏האזהרה המשפטית פשוט לא מופיעה.
 *
 * ‏הבדיקה מבנית ולא התנהגותית, וזה נאמר: `merge` נוגע בשתים-עשרה
 * ‏טבלאות בטרנזקציה אחת, ופיקסצ׳ר לכולן היה בודק את עצמו.
 */
describe("מיזוג כפילויות משמר את „טאבו משותף”", () => {
  const SOURCE = readFileSync(
    join(__dirname, "../contacts/duplicates.service.ts"),
    "utf8",
  );

  it("שני הכרטיסים נקראים עם הדגל", () => {
    const survivor = SOURCE.indexOf("id: survivorId, tenantId");
    expect(survivor).toBeGreaterThan(0);
    expect(SOURCE.slice(survivor, survivor + 200)).toContain("sharedTabu: true");
    const duplicate = SOURCE.indexOf("id: duplicateId, tenantId");
    expect(duplicate).toBeGreaterThan(0);
    expect(SOURCE.slice(duplicate, duplicate + 200)).toContain("sharedTabu: true");
  });

  /*
   * ‎`||` ולא השמה: מיזוג אינו מקום להוריד סימון. מי מבין השניים
   * ‏שסומן — הסימון נשאר.
   */
  it("והשורד מסומן כשהכפיל היה מסומן — ולעולם לא להפך", () => {
    expect(SOURCE).toContain("if (duplicate.sharedTabu && !survivor.sharedTabu)");
    const at = SOURCE.indexOf("if (duplicate.sharedTabu && !survivor.sharedTabu)");
    expect(SOURCE.slice(at, at + 220)).toContain("data: { sharedTabu: true }");
  });

  it("והעדכון קודם למחיקת הכפיל", () => {
    /* ‏אחרי המחיקה אין ממי לקרוא — הסדר הוא התיקון עצמו */
    expect(SOURCE.indexOf("if (duplicate.sharedTabu")).toBeLessThan(
      SOURCE.indexOf("tx.contact.delete({ where: { id: duplicateId } })"),
    );
  });
});
