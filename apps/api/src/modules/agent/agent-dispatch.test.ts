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

/**
 * ‎**חלון הדוח — מחרוזת בקטלוג, מספר בשירות.**
 *
 * ‎`windowDays` מוצהר כ-enum של מחרוזות ("30"/"90"/"365"), והשירות
 * מקבל מספר. פענוח שנשען על `num()` — שמחזיר `undefined` למחרוזת —
 * נופל תמיד לברירת המחדל: „ביצועים ברבעון” מחזיר חודש, שום דבר
 * אינו נכשל, ואיש אינו יודע. זו „תשובה מלאה על שאלה אחרת”, התקלה
 * שהמערכת הזו חוזרת ונכוות בה.
 *
 * שני הדוחות חייבים לקרוא לאותו פענוח, ולא כל אחד לנסח לעצמו.
 */
describe("חלון הדוחות", () => {
  const source = readFileSync(new URL("./execute.service.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

  it("שני הדוחות קוראים לאותה פונקציית פענוח", () => {
    expect(source).toContain("this.analytics.officeStats(reportWindow(params))");
    expect(source).toContain("const window = reportWindow(params);");
  });

  it("הפענוח קורא מחרוזת ולא מספר", () => {
    const fn = source.slice(
      source.indexOf("function reportWindow("),
      source.indexOf("function num("),
    );
    expect(fn).toContain('Number(str(params["windowDays"])');
    // `num` על מחרוזת מחזיר undefined — שימוש בו כאן הוא הבאג עצמו
    expect(fn).not.toMatch(/num\(params\["windowDays"\]\)/u);
  });
});

/**
 * ‎**„מה יש ברשת” הוא מה שאחרים פרסמו.** `ListingsService.list()`
 * מחזיר גם את המודעות שלי (המסך מסמן „שלי”), ומודעה שלי בראש
 * הרשימה גם ייצרה צעד „הבע התעניינות” שנכשל תמיד — אי אפשר להביע
 * עניין בנכס של המשרד עצמו (ביקורת Codex). שני הצרכנים של הפיד
 * מסננים.
 */
describe("פיד הרשת אינו כולל את המודעות שלי", () => {
  const strip = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

  it("שני הצרכנים מסננים mine", () => {
    const execute = strip(
      readFileSync(new URL("./execute.service.ts", import.meta.url), "utf8"),
    );
    const resolve = strip(
      readFileSync(new URL("./resolve.service.ts", import.meta.url), "utf8"),
    );
    expect(execute).toContain("row.mine !== true");
    expect(resolve).toContain("row.mine !== true");
  });
});
