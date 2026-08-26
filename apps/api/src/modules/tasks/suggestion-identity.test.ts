import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**„משימות מוצעות” — הזהות יציבה, והרשימה שלה אינה נחתכת.**
 *
 * שתי תכונות נפרדות, וכל אחת מהן נשברה כאן פעם אחת:
 *
 * ‎**1 · הרשימה המוצגת חתוכה ב-50, ואי אפשר לדדפ מולה.** משימה
 * שנוצרת מהצעה נוצרת בלי מועד, והמיון הוא `dueAt asc, nulls last`
 * — כלומר היא **הראשונה** שהתקרה מפילה. לכן המפתחות נשלפים
 * בשאילתה נפרדת, בלי `take`.
 *
 * ‎**2 · הזהות היא המפתח ולא הכותרת.** כותרת ניתנת לעריכה: מתווך
 * ששינה את שם המשימה גרם להצעה לחזור, ולחיצה עליה לא יכלה לתקן —
 * השרת החזיר את המשימה הקיימת, והמסך המשיך להציג את ההצעה.
 *
 * ‎**ומה שמונע כפילות בפועל אינו קוד אלא אינדקס:** ייחודי, חלקי,
 * על מרחב `suggestion:` הפתוח בלבד. בדיקת קיום לפני כתיבה מצמצמת
 * חלון ואינה סוגרת אותו.
 *
 * ‎**מה הבדיקה הזו אינה עושה:** היא אינה מריצה שאילתה. אין היום
 * הרנס בדיקות ל-`TasksService` (Prisma, RLS, הקשר דייר), ובדיקה
 * התנהגותית דורשת אותו. זו בדיקה מבנית — באותו דפוס של
 * ‎`recompute-purge` ו-`tenant-purge-coverage` — שמונעת חזרה
 * לתבנית השגויה בעריכה עתידית, ולא יותר מזה.
 */

const SERVICE = readFileSync(join(import.meta.dirname, "tasks.service.ts"), "utf8");

/** גוף `listForEntity` בלבד. */
const BODY = /async listForEntity\([\s\S]*?\n {2}\}/u.exec(SERVICE)?.[0] ?? "";

/**
 * השאילתה שמביאה את מפתחות ההצעות הפתוחות.
 *
 * ‎**פיצול ולא ביטוי רגולרי אחד.** ניסיון קודם השתמש ב-`[^}]*?`,
 * שאינו יכול לחצות את הסוגריים המקוננים של `where`; התוצאה הייתה
 * מחרוזת ריקה — כלומר בדיקה שעוברת תמיד. השער הראשון למטה תפס
 * זאת, וזו הסיבה שהוא קיים.
 */
const KEYS_QUERY =
  BODY.split("tx.task.findMany(").find((part) => part.includes("select: { sourceKey: true }")) ?? "";

/** ה-SQL של כל המיגרציות, לאיתור האינדקס הייחודי החלקי. */
const MIGRATIONS = (() => {
  const dir = join(import.meta.dirname, "..", "..", "..", "prisma", "migrations");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readFileSync(join(dir, entry.name, "migration.sql"), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
})();

describe("משימות מוצעות — מקור הזהות והיקף השליפה", () => {
  it("הגוף והשאילתה נמצאו, אחרת הבדיקה בודקת מחרוזת ריקה", () => {
    /*
     * שער על הבדיקה עצמה. בלעדיו שינוי בחתימה היה הופך את כל
     * האסרשנים למדידה של `""` — בדיקה שעוברת תמיד. זה כבר קרה
     * כאן פעם אחת, וזו הסיבה שהשורה הזו קיימת.
     */
    expect(BODY).toContain("listForEntity");
    expect(KEYS_QUERY).not.toBe("");
    expect(MIGRATIONS).not.toBe("");
  });

  it("הרשימה המוצגת אכן חתוכה — זו ההנחה שהכול נשען עליה", () => {
    expect(BODY).toContain("take: 50");
  });

  it("שאילתת המפתחות אינה נושאת תקרה", () => {
    expect(KEYS_QUERY).not.toContain("take");
  });

  it("היא מצומצמת למרחב ההצעות ולמשימות פתוחות", () => {
    expect(KEYS_QUERY).toContain("SUGGESTION_PREFIX");
    expect(KEYS_QUERY).toContain('status: "open"');
  });

  /*
   * ‎**הזהות אינה הכותרת.** אם השאילתה תחזור לשלוף `title`,
   * הדדופליקציה תישען שוב על טקסט שהמתווך יכול לערוך.
   */
  it("הזהות נשלפת מהמפתח ולא מהכותרת", () => {
    expect(KEYS_QUERY).toContain("sourceKey");
    expect(KEYS_QUERY).not.toContain("title: true");
  });

  /*
   * ‎**מתי הושלמה, ולא מתי נגעו בה.** מיון העשרים לפי `updatedAt`
   * היה מקדם משימה ישנה שנערכה ודוחק החוצה השלמה חדשה יותר.
   */
  it("המשימות שהושלמו ממוינות לפי זמן ההשלמה", () => {
    expect(BODY).toContain("completedAt");
    expect(BODY).toMatch(/completedAt:\s*\{\s*sort:\s*"desc"/u);
  });

  /*
   * ‎**הערובה הקשה.** בלי האינדקס, שתי טרנזקציות מקבילות עוברות
   * שתיהן את בדיקת הקיום ושתיהן כותבות.
   */
  it("קיים אינדקס ייחודי חלקי על הצעות פתוחות", () => {
    expect(MIGRATIONS).toContain("tasks_open_suggestion_unique");
    expect(MIGRATIONS).toMatch(/CREATE UNIQUE INDEX[\s\S]*?suggestion:%[\s\S]*?'open'/u);
  });

  /*
   * ‎**וחלקי ולא גורף.** אינדקס על כל `source_key` היה אוסר גם שתי
   * משימות ידניות באותו שם — שימוש לגיטימי — וגם עלול היה להיכשל
   * ביצירה על כפילויות קיימות של מפתחות מערכת.
   */
  it("האינדקס אינו חל על משימות ידניות", () => {
    expect(MIGRATIONS).toMatch(/tasks_open_suggestion_unique[\s\S]*?WHERE/u);
  });

  it("היצירה מתאוששת מהתנגשות האינדקס במקום להיכשל", () => {
    expect(SERVICE).toContain('error.code !== "P2002"');
    expect(SERVICE).toContain("findOpenBySourceKey");
  });
});
