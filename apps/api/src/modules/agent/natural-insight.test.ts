import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**הניסוח הטבעי — מכוסה, מעוגן, ובאותו סדר בשני הערוצים.**
 *
 * בקשת בעל המוצר: „שיהיה בשפה טבעית ממש”. המימוש נשען על שלושה
 * גבולות שהקומפיילר אינו רואה:
 *
 * 1. **הכיסוי נגזר, לא מנוי** — כל פעולת קריאה מקבלת ניסוח. רשימה
 *    קשיחה נשכחת עם כל פעולה חדשה, והפער מתגלה רק כשמתווך שואל.
 * 2. **העובדות נאכפות, לא מתבקשות** — `groundedNumbers` פוסל משפט
 *    עם ספרה שלא נשלפה ולא נשאלה. פרומפט לבדו הוא בקשה מנומסת.
 * 3. **המשפט מוביל** — בוואטסאפ כמו במסך, המסקנה לפני הרשימה.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const EXECUTE = read(new URL("./execute.service.ts", import.meta.url));
const WA = read(new URL("../messaging/whatsapp-assistant.service.ts", import.meta.url));

describe("הניסוח הטבעי של הסוכן", () => {
  it("הכיסוי נגזר מהקטלוג — כל פעולת קריאה, בלי רשימה קשיחה", () => {
    expect(EXECUTE).toMatch(
      /const INSIGHT_ACTIONS = new Set<string>\(\s*AGENT_ACTIONS\.filter\(\(action\) => action\.risk === "read"\)/u,
    );
  });

  it("שומר העובדות נאכף על התובנה ועל ההצעה — לא רק מתבקש בפרומפט", () => {
    expect(EXECUTE).toMatch(/groundedNumbers\(text, \[compact, transcript\]\)/u);
    expect(EXECUTE).toMatch(/insight\.length <= 500 && grounded\(insight\)/u);
    expect(EXECUTE).toMatch(/suggestion\.length <= 200 && grounded\(suggestion\)/u);
  });

  /*
   * הסדר עצמו — מסקנה לפני הרשימה — כבר אינו נטען כאן: הוא קוד
   * משותף (`agentReplySegments`) עם בדיקת יחידה משלו. מה שנשאר
   * לאכוף הוא שהערוץ באמת צורך את התוכנית ולא בונה סדר משלו.
   */
  it("בוואטסאפ ההרכב מגיע מהתוכנית המשותפת — לא מסדר מקומי", () => {
    expect(WA).toMatch(/agentReplySegments\(\{/u);
  });
});
