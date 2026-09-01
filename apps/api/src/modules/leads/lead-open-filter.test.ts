import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**„הלידים הפתוחים” מסוננים במסד — לא על העמוד שחזר.**
 *
 * ‎`list` מעמדת לפי `id` יורד וחותכת בתקרה. סינון סטטוס **אחרי**
 * החיתוך היה מחסיר בשקט כל ליד פתוח שנדחק מעבר לעמוד הראשון על-ידי
 * לידים סגורים חדשים ממנו — בדיוק הכשל שתועד ותוקן
 * ב-`openAwaitingResponse` (ביקורת Codex), חוזר בדלת של הסוכן.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const LEADS = read(new URL("./leads.service.ts", import.meta.url));
const EXECUTE = read(new URL("../agent/execute.service.ts", import.meta.url));

describe("סינון הלידים הפתוחים של הסוכן", () => {
  it("הסינון יושב בתוך ה-where של השאילתה, לפני העימוד", () => {
    const where = LEADS.slice(LEADS.indexOf("async list("));
    expect(where).toMatch(
      /query\.open === true\s*\? \{ status: \{ in: \[\.\.\.OPEN_LEAD_STATUSES\] \} \}/u,
    );
  });

  /*
   * ‎**„טופל” הוא השלילה של אותה רשימה, ולא רשימה שנייה.**
   *
   * לשוניות מסך הלידים חילקו את מה שחזר מהעמוד הראשון, ולכן במשרד
   * עם יותר מ-100 לידים ליד פתוח שנדחק החוצה לא הופיע בתור העבודה
   * (ביקורת Codex). התיקון מעביר את החלוקה למסד — ושתי הלשוניות
   * **חייבות** להישען על אותו קבוע, אחרת ליד שאינו באף אחת מהן
   * נעלם משתיהן.
   */
  it("„טופל” הוא השלילה של אותו קבוע, וגם הוא לפני העימוד", () => {
    const where = LEADS.slice(LEADS.indexOf("async list("));
    expect(where).toMatch(
      /query\.open === false\s*\? \{ status: \{ notIn: \[\.\.\.OPEN_LEAD_STATUSES\] \} \}/u,
    );
  });

  /* בלי החשיפה בבקר, הסינון בשירות אינו נגיש למסך כלל. */
  it("הבקר חושף את הפרמטר", () => {
    const CONTROLLER = read(new URL("./leads.controller.ts", import.meta.url));
    const schema = CONTROLLER.slice(CONTROLLER.indexOf("const ListQuerySchema"));
    expect(schema.slice(0, schema.indexOf(".strict()"))).toMatch(/\bopen: z\b/u);
  });

  it("הסוכן מבקש פתוחים כברירת מחדל, וסטטוס מפורש מצמצם", () => {
    expect(EXECUTE).toMatch(
      /status === undefined \? \{ open: true \} : \{ status \}/u,
    );
  });
});
