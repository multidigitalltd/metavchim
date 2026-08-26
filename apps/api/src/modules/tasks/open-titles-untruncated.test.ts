import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**הכותרות הפתוחות אינן נחתכות — כי הדדופליקציה נשענת עליהן.**
 *
 * ‎`listForEntity` מחזיר את המשימות הפתוחות עם `take: 50`, וזה
 * נכון: כרטיס אינו מציג מאתיים שורות. אבל המסך משתמש ברשימה הזו
 * גם כדי לסנן „משימות מוצעות” מול מה שכבר פתוח — וסינון מול רשימה
 * חתוכה אינו סינון.
 *
 * והצירוף גרוע במיוחד: משימה שנוצרת מהצעה נוצרת **בלי מועד**,
 * והמיון הוא `dueAt asc, nulls last`. כלומר היא נדחפת לסוף הרשימה,
 * והיא **הראשונה** שהתקרה מפילה. הכרטיס היה מציע שוב בדיוק את מה
 * שכבר קיים, ולחיצה הייתה יוצרת כפילות (ביקורת Codex).
 *
 * לכן `openTitles` מגיע בשאילתה נפרדת, בלי `take`, עם `distinct`
 * שחוסם את הגודל בלי תקרה שרירותית.
 *
 * ‎**מה הבדיקה הזו אינה עושה:** היא אינה מריצה שאילתה. אין היום
 * הרנס בדיקות ל-`TasksService` (Prisma, RLS, הקשר דייר), ובדיקה
 * התנהגותית דורשת אותו. זו בדיקה מבנית — באותו דפוס של
 * ‎`recompute-purge` ו-`tenant-purge-coverage` — שמונעת חזרה
 * לתבנית השגויה בעריכה עתידית, ולא יותר מזה.
 */

const SERVICE = readFileSync(join(import.meta.dirname, "tasks.service.ts"), "utf8");

/** גוף `listForEntity` בלבד. */
const BODY =
  /async listForEntity\([\s\S]*?\n {2}\}/u.exec(SERVICE)?.[0] ?? "";

/**
 * השאילתה שמביאה את הכותרות.
 *
 * ‎**פיצול ולא ביטוי רגולרי אחד.** הניסיון הראשון היה
 * ‎`findMany\(\{[^}]*?select:` — והוא נכשל, כי `[^}]` אינו יכול
 * לחצות את הסוגריים המקוננים של `where`. השער שמתחת תפס זאת
 * מיד, וזו בדיוק הסיבה שהוא נכתב.
 */
const TITLES_QUERY =
  BODY.split("tx.task.findMany(").find((part) => part.includes("select: { title: true }")) ?? "";

describe("listForEntity — כותרות המשימות הפתוחות", () => {
  it("הגוף נמצא, אחרת הבדיקה בודקת מחרוזת ריקה", () => {
    /*
     * שער על הבדיקה עצמה. בלעדיו שינוי בחתימה היה הופך את כל
     * האסרשנים למדידה של `""` — כלומר בדיקה שעוברת תמיד. זה כבר
     * קרה כאן פעם, וזו הסיבה שהשורה הזו קיימת.
     */
    expect(BODY).toContain("listForEntity");
    expect(TITLES_QUERY).not.toBe("");
  });

  it("הרשימה המוצגת אכן חתוכה — זו ההנחה שהכול נשען עליה", () => {
    expect(BODY).toContain("take: 50");
  });

  it("שאילתת הכותרות אינה נושאת תקרה", () => {
    expect(TITLES_QUERY).not.toContain("take");
  });

  it("שאילתת הכותרות מוגבלת ב-distinct ולא בתקרה", () => {
    expect(TITLES_QUERY).toContain('distinct: ["title"]');
  });

  it("הכותרות נשלפות מהמשימות הפתוחות בלבד", () => {
    expect(TITLES_QUERY).toContain('status: "open"');
  });
});
