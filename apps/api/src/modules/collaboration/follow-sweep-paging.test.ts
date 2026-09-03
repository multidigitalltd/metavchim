import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**הסבב חייב לעבור על הכול, לא על החלון הראשון.**
 *
 * ## הכשל שהבדיקה הזו מונעת
 *
 * ‏הסבב נכתב עם `take: 500` על המעקבים ו-`take: 200` על הנכסים,
 * בלי סדר ובלי סמן. שני המספרים נראו כמו „הגנה מפני שאילתה
 * ענקית”, ובפועל היו **תקרות שקטות**:
 *
 * - ‏13 סוכנים במלוא מכסת ה-40 חוצים 500 מעקבים.
 * - ‏משרד ב-Pro רשאי ל-300 נכסים, וב-Agency וב-Enterprise אין
 *   תקרה כלל.
 *
 * ‏וכיוון שכל ריצה שעתית חוזרת בדיוק על אותו חלון, מעקב או נכס
 * שמחוץ לו לא היו מפעילים התראה **לעולם** (ביקורת Codex). זו לא
 * איטיות אלא הבטחה שנשברת בשקט: המשתמש לחץ „עקוב”, והמערכת פשוט
 * לא מסתכלת עליו.
 *
 * ## למה בדיקת מקור
 *
 * ‏הכשל אינו בערך שמחזירה פונקציה אלא **בצורת השאילתה**, ולבדיקה
 * התנהגותית עליו נדרש מסד עם מאות שורות בכל ריצה. הקריאה כאן היא
 * על הקוד שרץ בפועל, ומספיקה כדי שהתקרה לא תחזור בעריכה הבאה.
 */
const SOURCE = readFileSync(
  join(import.meta.dirname, "collaboration.service.ts"),
  "utf8",
);

/**
 * ‏גוף הסבב — מתחילת `sweepFollowsForTenant` ועד `notifyMatches`,
 * כלומר שתי הפונקציות שמדפדפות, בלי זו שכותבת. חיתוך לפי סימנים
 * בקוד ולא לפי אורך קבוע: חלון של N תווים משתנה עם כל עריכה,
 * ובדיקה שסופרת מופעים בתוכו סופרת דבר אחר בכל פעם.
 */
function sweepBody(): string {
  const start = SOURCE.indexOf("async sweepFollowsForTenant(");
  const end = SOURCE.indexOf("private async notifyMatches(");
  expect(start, "sweepFollowsForTenant לא נמצאה — הסבב כנראה שונה שם").toBeGreaterThan(-1);
  expect(end, "notifyMatches לא נמצאה — הסבב כנראה שונה שם").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("סבב המעקבים עובר על הכול", () => {
  it("שתי השאילתות מדפדפות בסמן ולא נעצרות בחלון הראשון", () => {
    const body = sweepBody();
    /*
     * ‏סמן דורש סדר יציב: `cursor` בלי `orderBy` הוא דפדוף על סדר
     * שהמסד רשאי לשנות בין ריצות, כלומר דילוג על שורות.
     */
    expect(body.match(/orderBy:\s*\{\s*id:\s*"asc"\s*\}/gu) ?? []).toHaveLength(2);
    expect(body.match(/cursor:\s*\{\s*id:\s*cursor\s*\}/gu) ?? []).toHaveLength(2);
    /* ‏`skip: 1` — בלעדיו כל עמוד מתחיל שוב מהשורה האחרונה של קודמו */
    expect(body.match(/skip:\s*1/gu) ?? []).toHaveLength(2);
  });

  it("אין תקרה קבועה — רק גודל עמוד אחד, משותף לשתיהן", () => {
    const body = sweepBody();
    const takes = [...body.matchAll(/take:\s*([A-Z_a-z0-9]+)/gu)].map((m) => m[1]);
    expect(takes).toEqual(["SWEEP_PAGE", "SWEEP_PAGE"]);
    /*
     * ‏המספרים שהיו כאן, מפורשות: מי שיחזיר אחד מהם — גם בשם אחר —
     * מחזיר איתו את הכשל.
     */
    expect(body).not.toMatch(/take:\s*(?:500|200|100)\b/u);
  });

  it("הסבב עוצר כשעמוד חלקי חוזר, ולא רץ לנצח", () => {
    const body = sweepBody();
    expect(body.match(/length < SWEEP_PAGE\) break;/gu) ?? []).toHaveLength(2);
  });
});
