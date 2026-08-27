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

  it("הסוכן מבקש פתוחים כברירת מחדל, וסטטוס מפורש מצמצם", () => {
    expect(EXECUTE).toMatch(
      /status === undefined \? \{ open: true \} : \{ status \}/u,
    );
  });
});
