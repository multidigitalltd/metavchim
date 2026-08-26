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
 * ‎**ומה שאינו כאן, ובמכוון:** אין ערובה קשה נגד מרוץ בין שני
 * סוכנים. בדיקת קיום לפני כתיבה מצמצמת חלון ואינה סוגרת אותו,
 * ואינדקס ייחודי היה נבנה בזמן עליית ה-API מול מסד חי ונועל את
 * `tasks` לכתיבה. המגבלה מתועדת ב-`TasksService.create` ונדחתה
 * לפעולת תחזוקה מדודה.
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

describe("משימות מוצעות — מקור הזהות והיקף השליפה", () => {
  it("הגוף והשאילתה נמצאו, אחרת הבדיקה בודקת מחרוזת ריקה", () => {
    /*
     * שער על הבדיקה עצמה. בלעדיו שינוי בחתימה היה הופך את כל
     * האסרשנים למדידה של `""` — בדיקה שעוברת תמיד. זה כבר קרה
     * כאן פעם אחת, וזו הסיבה שהשורה הזו קיימת.
     */
    expect(BODY).toContain("listForEntity");
    expect(KEYS_QUERY).not.toBe("");
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
   * ‎**כל מסלול שסוגר משימה חייב לחתום את זמן ההשלמה.**
   *
   * ‎`completedAt` נוסף כדי שהכרטיס יאמר מתי משהו נגמר — אבל
   * ארבעה מסלולים אוטומטיים סוגרים משימות בלי לעבור ב-`update`:
   * סגירת SLA של ליד, המרת ליד לקונה, המרה לנכס, ופולו-אפ אחרי
   * סיור. מסלול ששוכח לחתום מייצר שורה שנראית „הושלמה” ואינה
   * יודעת מתי — כלומר בדיוק החור שהשדה נועד לסגור (ביקורת Codex).
   */
  it("אין מסלול שסוגר משימה בלי לחתום את זמן ההשלמה", () => {
    const dir = join(import.meta.dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const text = readFileSync(full, "utf8");
          /* סגירה שאינה נושאת `completedAt` באותה קריאה */
          if (/data:\s*\{\s*status:\s*"done"\s*\}/u.test(text)) offenders.push(entry.name);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
