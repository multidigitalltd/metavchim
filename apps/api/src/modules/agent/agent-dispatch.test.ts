import { readFileSync } from "node:fs";

import { AGENT_ACTIONS } from "@metavchim/shared";
import { describe, expect, it } from "vitest";

/**
 * ‎**כל פעולה בקטלוג מגיעה לביצוע — ואין ביצוע ליתומה.**
 *
 * הקטלוג הוא מקור האמת של מה שהסוכן **מציע**: ממנו נבנית ההנחיה
 * למודל, ממנו נגזרת הוולידציה, וממנו נבנה תפריט הוואטסאפ. ה-`switch`
 * ב-`dispatch` הוא מה שבאמת **עושה**. השניים נכתבים בקבצים שונים,
 * בחבילות שונות, ואין ביניהם קשר שהקומפיילר רואה: `actionId` הוא
 * ‎`string`, ולכן ענף חסר אינו שגיאת טיפוס.
 *
 * ‎**התוצאה של פער כזה אינה שקטה — היא גרועה מזה.** פעולה שנוספה
 * לקטלוג בלי ענף עוברת את הפירוש, עוברת את שער היכולות, ואז נופלת
 * על „פעולה לא מוכרת”. המתווך שאל שאלה לגיטימית שהמערכת הצהירה
 * שהיא יודעת לענות עליה, וקיבל שגיאה.
 *
 * זו בדיוק המחלקה שהפילה את הפרודקשן היום: משהו שהוצהר במקום אחד,
 * לא חובר במקום שני, וכל השערים היו ירוקים. שם זו הייתה תלות
 * ‎`express`; כאן זו יכולת שהובטחה למשתמש.
 *
 * ‎**והכיוון ההפוך חשוב לא פחות.** ענף בלי פעולה בקטלוג הוא קוד מת:
 * שום מסלול אינו מגיע אליו, כי `actionId` מאומת מול הקטלוג לפני
 * ה-`dispatch`.
 */

const SOURCE = readFileSync(new URL("./execute.service.ts", import.meta.url), "utf8")
  // בלי הסרת הערות, טענה על „הפעולה מוזכרת” מתקיימת על ההסבר שלה
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/^[ \t]*\/\/.*$/gmu, "");

/** תוויות ה-`case` שב-`dispatch`, בסדר הופעתן. */
function dispatchCases(): string[] {
  const start = SOURCE.indexOf("switch (actionId)");
  expect(start, "ה-switch של הביצוע לא נמצא").toBeGreaterThan(-1);
  return [...SOURCE.slice(start).matchAll(/case "([a-z_]+)":/gu)].map((match) => match[1]!);
}

describe("כיסוי הביצוע מול קטלוג הפעולות", () => {
  const catalogue = AGENT_ACTIONS.map((action) => action.id);
  const cases = dispatchCases();

  it("לכל פעולה בקטלוג יש ענף ביצוע", () => {
    const unwired = catalogue.filter((id) => !cases.includes(id));
    expect(unwired, "פעולות שהסוכן מציע ואין להן ביצוע").toEqual([]);
  });

  it("ואין ענף לפעולה שאינה בקטלוג", () => {
    const orphans = cases.filter((id) => !catalogue.includes(id));
    expect(orphans, "ענפים שאף מסלול אינו מגיע אליהם").toEqual([]);
  });

  /*
   * ‎`Set.add` מחזיר את הקבוצה ולא בוליאני, ולכן `!seen.add(id)` הוא
   * תמיד `false` — הניסוח הראשון כאן היה טענה ריקה שעברה על ענף
   * כפול אמיתי. נתפס באימות שבירה, כמו שנועד.
   */
  it("אין ענף כפול — הראשון היה מסתיר את השני בשקט", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of cases) {
      if (seen.has(id)) duplicates.push(id);
      seen.add(id);
    }
    expect(duplicates).toEqual([]);
  });

  /*
   * ה-`default` אינו נשען על כך שהקטלוג נאכף: קריאה ישירה ל-API עם
   * ‎`actionId` מומצא חייבת להידחות, לא ליפול על `undefined`.
   */
  it("פעולה שאינה מוכרת נדחית ולא נופלת", () => {
    const tail = SOURCE.slice(SOURCE.indexOf("switch (actionId)"));
    expect(tail).toMatch(/default:\s*\n\s*throw new BadRequestException\(/u);
  });

  it("הבדיקה אכן קוראת את הקטלוג ואת הענפים", () => {
    expect(catalogue.length).toBeGreaterThan(30);
    expect(cases.length).toBe(catalogue.length);
  });
});
