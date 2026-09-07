import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSharedTabuProperty, sharedTabuFit } from "@metavchim/shared";

/**
 * ‎**העובדה על הרישום המשותף חייבת לחצות את גבול המשרד**
 * ‏(ביקורת Codex, P1 ×2).
 *
 * ‏עד שהתכונה הפכה לדגל היא נשאה את עצמה דרך `propertyType`
 * ‏(`shared_tabu`), ולכן הגיעה לרשת בלי שאיש התכוון לכך. מרגע
 * ‏שהיא דגל — ובדיוק בגלל ה-PR הזה — היא נעצרה בגבול:
 *
 * ‏**בנכס:** מודעה של נכס שסומן בתיבה יצאה כרגילה. היא הוצעה
 * ‏לקונה שסירב למושאע, והמשרד המקבל לא ראה את מצב הרישום.
 *
 * ‏**בקונה:** `refuses` לא נסע כלל, והצד השני קרא „טרם נשאל” —
 * ‏כלומר ההתאמה הותרה על סירוב **מפורש**. זה הכיוון החמור, כי
 * ‏סירוב הוא הצהרה של הלקוח ולא העדפה.
 */

const SRC = join(import.meta.dirname);

describe("‏מה שנשמר בפרסום — ומה שמשוחזר ממנו", () => {
  const LISTINGS = readFileSync(join(SRC, "listings.service.ts"), "utf8");
  const COLLAB = readFileSync(join(SRC, "collaboration.service.ts"), "utf8");

  it("‏הפרסום שומר את הדגל — דרך הגזירה, לא דרך השדה הגולמי", () => {
    expect(LISTINGS).toContain("sharedTabu: isSharedTabuProperty(property)");
  });

  it("‏והשחזור מחזיר אותו — גם לניקוד וגם לכרטיס", () => {
    expect(LISTINGS.split("sharedTabu: row.sharedTabu").length - 1).toBe(2);
  });

  it("‏הביקוש שומר את העמדה — דרך הגזירה", () => {
    expect(COLLAB).toContain("sharedTabuStance: buyerSharedTabuStance(requirements) ?? null");
  });

  /*
   * ‏שני שחזורים ולא אחד: `collaboration.service` מנקד את הנכסים
   * ‏שלי מול ביקושי הרשת, ו-`listings.service` את המודעות שלי מול
   * ‏הביקושים. שכפול מודע — ולכן שניהם חייבים לשאת את השדה.
   */
  it("‏ושני השחזורים של הביקוש קוראים אותה", () => {
    for (const [name, source] of [
      ["collaboration.service", COLLAB],
      ["listings.service", LISTINGS],
    ] as const) {
      expect(source, name).toMatch(/demand\.sharedTabuStance === null/u);
    }
  });
});

/**
 * ‎**ומה זה עושה בפועל** — הטענה, ולא צורת הקוד.
 *
 * ‏שתי השורות האלה הן כל ההבדל: מה `sharedTabuFit` מחזיר כשהעמדה
 * ‏נסעה, ומה הוא מחזיר כשהיא אבדה בדרך.
 */
describe("‏סירוב שאבד בדרך מתיר את מה שהלקוח שלל", () => {
  it("‏סירוב שנסע — הנכס נפסל", () => {
    expect(sharedTabuFit(true, "refuses").excluded).toBe(true);
  });

  it("‏וסירוב שאבד — נקרא „טרם נשאל”, וההצעה עוברת", () => {
    expect(sharedTabuFit(true, undefined).excluded).toBe(false);
  });

  /*
   * ‏ובצד הנכס: דגל שאבד הופך אותו לנכס רגיל, ואז גם קונה שסירב
   * ‏מקבל אותו — כי אין מה לפסול.
   */
  it("‏ודגל שאבד — הנכס נראה רגיל", () => {
    expect(isSharedTabuProperty({ sharedTabu: true, propertyType: "apartment" })).toBe(true);
    expect(isSharedTabuProperty({ sharedTabu: false, propertyType: "apartment" })).toBe(false);
  });
});
