import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**ליד בלי סוכן משויך חייב להיראות לכולם, ולא לאיש.**
 *
 * ## הכשל שהשער הזה מקבע
 *
 * ‏`ownershipFilter` מייצר `{ assignedToUserId: <אני> }`, ו-NULL אינו
 * שווה לכלום ב-SQL. לכן ליד לא-משויך לא התאים **לאף סוכן** — הוא לא
 * היה „של מישהו אחר”, הוא היה בלתי נראה. וזה המצב שנוצר הכי הרבה:
 * שיחה ממספר לא מוכר פותחת ליד עם `assignedToUserId = null`.
 *
 * הנזק הגיע עד יומן השיחות: `visibleContactIds` אוסף לקוחות דרך
 * הלידים שלהם, ולכן הלקוח לא נכנס לרשימה, וכל ארבעת הענפים של
 * ‎`visibleCallsCondition` נכשלו — מסך שיחות ריק לכל סוכן בלי
 * ‎`view_all`, בזמן שהמסד מלא (דיווח מהשטח, ייצור).
 *
 * ## שלוש טענות
 *
 * ‏אין דרך לבדוק את זה בבדיקת יחידה בלי מסד וסשן, ולכן הטענות הן על
 * המקור: שהכלל קיים, שהוא **יחיד** — כל אתר בעלות של ליד עובר דרכו
 * — ושהצורה שבה הוא נשתל אינה נשברת בשקט.
 */

const API_SRC = join(import.meta.dirname, "..");

/** בלי הערות — טענה שמתקיימת בזכות הסבר בעברית אינה טענה. */
const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const FILES = tsFiles(API_SRC).map((path) => ({
  path: path.slice(API_SRC.length + 1),
  code: strip(readFileSync(path, "utf8")),
}));

const OWNERSHIP = FILES.find((f) => f.path === "common/ownership.ts")!;

describe("ליד לא-משויך הוא הערימה המשותפת", () => {
  it("שולף הקבצים עובד, אחרת כל השאר בודק רשימה ריקה", () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(OWNERSHIP.code).toContain("export function ownershipFilter(");
  });

  /*
   * ‎**הכלל עצמו.** בלי ענף ה-NULL זו בדיוק הפונקציה שהחליפה כלום.
   */
  it("‎`leadOwnershipFilter` כולל את הלידים שאינם משויכים", () => {
    const body = /export function leadOwnershipFilter\([\s\S]*?\n\}/u.exec(OWNERSHIP.code)?.[0];
    expect(body, "לא נמצאה הפונקציה").toBeDefined();
    expect(body).toMatch(/assignedToUserId:\s*ctx\.userId/u);
    expect(body).toMatch(/assignedToUserId:\s*null/u);
    // ‏`view_all` ממשיך לראות הכול בלי סינון כלל
    expect(body).toMatch(/leads\.view_all/u);
  });

  /*
   * ‎**ושהוא יחיד.** אתר אחד שחוזר ל-`ownershipFilter` הגולמי הוא
   * מסך אחד שבו הליד נעלם שוב — וזה בדיוק מה שקרה עד עכשיו.
   */
  it("אין אתר בעלות של ליד שעוקף את הכלל", () => {
    const offenders = FILES.filter((f) =>
      /ownershipFilter\(\s*"leads\.view_all"/u.test(f.code),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  /*
   * ‎**והצורה.** הכלל מוחזר כ-`OR`, והוא נשתל בפיזור לתוך `where`.
   * ‏`where` שכבר יש בו `OR` משלו — לחיפוש טקסט, למשל — היה **דורס**
   * אחד מהשניים בלי שגיאת הידור ובלי שגיאת ריצה: או שסינון הבעלות
   * נעלם (דליפה), או שהתנאי השני נעלם (תוצאות שגויות). הבדיקה
   * אוסרת את הצירוף הזה במקום להסתמך על כך שמישהו יבחין בו.
   */
  it("אף אתר אינו משתל לתוך where שכבר יש בו OR", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const match of file.code.matchAll(/\.\.\.leadOwnershipFilter\(\)/gu)) {
        const block = enclosingObject(file.code, match.index);
        if (block !== null && /^\s*OR:/mu.test(block)) offenders.push(file.path);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

/** הליטרל שהפיזור יושב בתוכו — מהסוגר הפותח שלו ועד הסוגר שלו. */
function enclosingObject(code: string, at: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}
