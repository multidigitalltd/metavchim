import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**„של מי הכרטיס הזה?” — ושלוש הדרכים שבהן התשובה נעלמת בשקט.**
 *
 * הבקשה הייתה של סוכנות עם כמה סוכנים: שכל נכס וכל ליד יהיו משויכים,
 * ושהמנהל יראה בכל כרטיס למי. שלוש הטענות כאן הן מה שקל לשבור בלי
 * שדבר ייראה שבור:
 *
 * 1. ‎**השם נשלף לכל שורה.** שליפה בתוך הלולאה עובדת מצוין על שלוש
 *    שורות בבדיקה, ונהיית N+1 בדיוק אצל הסוכנות עם מאה נכסים —
 *    כלומר אצל מי שהשדה נבנה בשבילו.
 * 2. ‎**כתיבה בלי אימות משרד.** הבורר מציג את אנשי המשרד, אבל בקשה
 *    ישירה ל-API אינה עוברת דרכו, ואפשר לכתוב כל מזהה שהוא.
 * 3. ‎**המסך שוכח דלי.** רשימה שלא מציגה סוכן מסתירה בדיוק את
 *    הכרטיסים שהמנהל מחפש — אלה שאין להם.
 *
 * הבדיקה קוראת קוד ולא מריצה אותו: שלושתן טענות על **צורה** —
 * שאילתה מקובצת, קריאה לשומר, ורכיב שמופיע בשישה מסכים.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const API = (path: string): string => read(new URL(`../modules/${path}`, import.meta.url));
const WEB = (path: string): string =>
  read(new URL(`../../../web/src/app/${path}`, import.meta.url));

describe("שיוך סוכן — נכס, ליד וקונה", () => {
  /**
   * ‎**ארגומנטים של כל קריאה ל-`agentNames`, לא „איפשהו בקובץ”.**
   *
   * חיפוש טקסט חופשי בקובץ שלם עונה „כן” גם כשהקריאה הנכונה נמחקה,
   * כי משהו אחר בקובץ מספק את התבנית. לכן כאן נשלפים הארגומנטים של
   * כל קריאה בנפרד — עם איזון סוגריים, כי `TenantContext.current()`
   * מכיל סוגריים משלו — והטענה היא על **הצורה של הארגומנט השלישי**.
   */
  const agentNamesArgs = (src: string): string[] => {
    const out: string[] = [];
    const call = /agentNames\(/gu;
    for (let m = call.exec(src); m !== null; m = call.exec(src)) {
      let depth = 1;
      let i = m.index + m[0].length;
      for (; i < src.length && depth > 0; i += 1) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") depth -= 1;
      }
      out.push(src.slice(m.index + m[0].length, i - 1));
    }
    return out;
  };

  /** הארגומנט השלישי — מה שממנו נגזרים המזהים. */
  const idsArg = (args: string): string => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 0) {
        parts.push(args.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(args.slice(start));
    return (parts[2] ?? "").trim();
  };

  /*
   * ‎`agentNames` מקבלת מערך מזהים ומחזירה מפה, ולכן יש בדיוק שתי
   * צורות תקינות להזין אותה: **עמוד שלם ממופה** (רשימה), או
   * ‎**שורה אחת** (כרטיס). כל צורה שלישית — למשל מזהה של השורה
   * הראשונה בלבד, או שליפה בתוך הלולאה — היא בדיוק ה-N+1 או
   * ה„רק הראשון מקבל שם” שהפונקציה נועדה למנוע.
   */
  const PAGE = /^[A-Za-z][\w.]*\.map\(\((row|r)\) => \1\.\w+\)$/u;
  const SINGLE = /^\[(row|r)\.\w+\]$/u;

  it.each([
    ["properties/properties.service.ts", "רשימת הנכסים"],
    ["leads/leads.service.ts", "רשימת הלידים"],
    ["buyers/buyers.service.ts", "רשימת הקונים"],
  ])("%s — שם הסוכן נשלף בשאילתה מקובצת", (path) => {
    const ids = agentNamesArgs(API(path)).map(idsArg);
    expect(ids.length, "אין קריאה ל-agentNames").toBeGreaterThan(0);

    /* אין צורה שלישית */
    for (const arg of ids) {
      expect(PAGE.test(arg) || SINGLE.test(arg), `ארגומנט שאינו עמוד ואינו שורה: ${arg}`).toBe(
        true,
      );
    }
    /* לפחות קריאה אחת מקבלת עמוד שלם */
    expect(ids.filter((arg) => PAGE.test(arg)).length, "אין שליפה מקובצת").toBeGreaterThanOrEqual(1);
    /*
     * ‎**ולכל היותר אחת מקבלת שורה בודדת** — זו של הכרטיס. שנייה
     * כזו פירושה שליפה שנכנסה ללולאה של רשימה, כלומר N+1.
     */
    expect(ids.filter((arg) => SINGLE.test(arg)).length, "יותר משליפת שורה אחת").toBeLessThanOrEqual(
      1,
    );
  });

  /*
   * ‎**כתיבה שאינה מאמתת משרד.** ל-`agentUserId` יש שני נתיבי כתיבה
   * בנכס — יצירה ועדכון — ושניהם חייבים לעבור בשומר. בלעדיו אפשר
   * לשייך נכס לכל מזהה, כולל של משרד אחר.
   */
  it("שני נתיבי הכתיבה של שיוך הנכס עוברים באימות משרד", () => {
    const src = API("properties/properties.service.ts");
    const guards = [...src.matchAll(/assertAgentInOffice\(/gu)];
    expect(guards.length, "פחות משני שומרים").toBeGreaterThanOrEqual(2);
    /* והשומר עצמו באמת שואל את המסד על המשרד */
    const helper = read(new URL("./agent-names.ts", import.meta.url));
    expect(helper).toMatch(/where: \{ tenantId, id: agentUserId \}/u);
    expect(helper).toMatch(/BadRequestException/u);
  });

  /*
   * ‎**שישה מסכים, תשובה אחת.** שלושת הכרטיסים ושלוש הרשימות. מסך
   * שנשמט מהרשימה הזו הוא בדיוק המסך שבו המנהל לא יידע של מי הכרטיס.
   */
  it.each([
    "properties/[id]/page.tsx",
    "properties/page.tsx",
    "leads/[id]/page.tsx",
    "leads/page.tsx",
    "buyers/[id]/page.tsx",
    "buyers/page.tsx",
  ])("%s — מציג את הסוכן", (path) => {
    /*
     * ‎`toContain("AgentTag")` היה עונה „כן” גם על `AgentTagX`, ועל
     * שורת ה-`import` לבדה אחרי שהרכיב הוסר מה-JSX. לכן הטענה היא על
     * ‎**אלמנט** שמקבל את `agentName` מה-DTO.
     */
    expect(WEB(path)).toMatch(/<AgentTag(?![A-Za-z0-9_])[\s\S]{0,160}?\.agentName/u);
  });

  /*
   * ‎**„לא משויך” נראה.** זו ברירת המחדל של הרכיב, והיא מה שהופך
   * כרטיס בלי סוכן לגלוי במקום להיעדר שקט.
   */
  it("„לא משויך” הוא ברירת המחדל ולא צריך לבקש אותו", () => {
    const tag = WEB("agent-tag.tsx");
    expect(tag).toMatch(/showUnassigned = true/u);
    expect(tag).toContain("לא משויך");
  });
});
