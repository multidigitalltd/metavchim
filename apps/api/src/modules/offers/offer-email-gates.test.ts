import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**שער שחל על מסלול אחד ולא על הניסיון החוזר שלו.**
 *
 * הזכאות הראשונית של ההצעות האוטומטיות דורשת נכס `active` שאינו
 * מחוק. הניסיון החוזר — שרץ על הצעות שנשארו `pending_email` אחרי
 * פסק זמן או תקלת ספק — בדק את **הלקוח** בלבד (הסרה מרשימת
 * התפוצה), ולא את הנכס.
 *
 * התוצאה: שליחה שנכשלה, הנכס נמכר, והסבב הבא שלח בכל זאת. הלקוח
 * מקבל הצעה על דירה שהמשרד כבר משך — ומאז שהשליחה מתעדת פעולת
 * שיווק, גם נרשמת פעולה על נכס שהוסר (ביקורת Codex).
 *
 * ‎**מה הבדיקה מחזיקה:** לא את הניסוח, אלא את **קיומו של השער בשני
 * המסלולים**. זו משפחת התקלות שחוזרת כאן — תנאי שנכתב פעמיים ואחד
 * העותקים נשאר מאחור — ובדיקה מבנית היא הדרך הזולה לתפוס אותה.
 *
 * אין הרנס בדיקות ל-`OfferEmailService` (Prisma, RLS, ספק דואר),
 * ולכן זו בדיקה על המקור — כמו `match-created-at` ו-`office-names`.
 */

const SOURCE = readFileSync(
  join(import.meta.dirname, "offer-email.service.ts"),
  "utf8",
);

/** גוף פונקציה פרטית אחת, עד הפונקציה הבאה באותה רמת הזחה. */
function body(name: string): string {
  const start = SOURCE.indexOf(`private async ${name}(`);
  expect(start, `${name} לא נמצאה בקובץ`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const end = rest.search(/\n {2}(?:private|public|async|\/\*\*)/u);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * ‎**תנאי ה-`where` של שאילתת ה**נכסים** בלבד — ולא של הפונקציה.**
 *
 * הניסוח הראשון של הבדיקה הזו חיפש `deletedAt: null` בכל גוף
 * הפונקציה, והוא נמצא שם — על שאילתת ה**קונה**. כלומר הבדיקה עברה
 * גם כשהסרתי את התנאי מהנכס: שער שנראה ירוק ואינו שומר על דבר,
 * שהוא בדיוק סוג הבדיקה שהקובץ הזה קיים כדי למנוע. אומת בשבירה.
 */
function propertyWhere(fn: string): string {
  const match = /tx\.property\.find(?:First|Many)\(\{[\s\S]*?\n {12}\},/u.exec(body(fn));
  expect(match, `${fn}: אין שאילתת נכסים כלל`).not.toBeNull();
  return match![0];
}

describe("שער הנכס בהצעות האוטומטיות", () => {
  it("הזכאות הראשונית דורשת נכס פעיל שאינו מחוק", () => {
    const where = propertyWhere("eligibleMatches");
    expect(where).toContain('status: "active"');
    expect(where).toContain("deletedAt: null");
  });

  /*
   * ‎**וזה הצד שנשבר.** בין היצירה לניסיון החוזר עוברות עשר דקות
   * לפחות, ובהן הנכס יכול להימכר, לרדת לטיוטה או להימחק.
   */
  it("והניסיון החוזר בודק אותו שוב", () => {
    const where = propertyWhere("retryPending");
    expect(where).toContain('status: "active"');
    expect(where).toContain("deletedAt: null");
  });

  /*
   * ‎**וגם את הלקוח** — הבדיקה שכן הייתה שם. אילו הייתי מחליף אותה
   * בבדיקת הנכס במקום להוסיף לצידה, הבדיקה שמעל הייתה עוברת.
   */
  it("ואת ההסרה מרשימת התפוצה", () => {
    expect(body("retryPending")).toContain("optedOutAt");
  });

  /*
   * ‎**„טיוטה” אינה נכללת באוטומציה, וזו הסיבה שלא נעשה כאן שימוש
   * חוזר ב-`offerPropertyMarketable`.** הוא מתיר `draft | active`,
   * כי מתווך רשאי להציע טיוטה במודע; האוטומציה משווקת רק מה שהמשרד
   * סימן פעיל. שימוש חוזר בו היה מרחיב את האוטומציה בשקט.
   */
  it("האוטומציה אינה משווקת טיוטות", () => {
    /*
     * הטענה היא על **הקוד** ולא על הופעת המילה: `draft` מוזכר
     * בהערות כאן בדיוק כדי להסביר למה הוא בחוץ, ובדיקה על הטקסט
     * החופשי הייתה נופלת על ההסבר של עצמה.
     */
    for (const fn of ["eligibleMatches", "retryPending"]) {
      expect(body(fn), fn).not.toMatch(/status:\s*\{\s*in:\s*\[[^\]]*"draft"/u);
    }
  });
});
