import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **נכס שאי אפשר לנקד — מנקה את ההצעות שלו.**
 *
 * ‎`recomputeForProperty` יוצא מוקדם כשחסרים עיר, מחיר או סוג עסקה.
 * קודם היציאה הזו קדמה לכל מחיקה, וזה השאיר בדיוק את השורות שכלל
 * הברזל של המיקום נועד להסיר: התאמה שנשמרה לפני הכלל על נכס בלי
 * מיקום שרדה **כל** סבב רענון, מפני שהסבב (`sweepOnce`) עובר על
 * נכסים בלבד וכל נכס כזה יצא מיד (ביקורת Codex).
 *
 * כלומר העלאת גרסת המנוע — המנגנון שאמור לנקות שורות ישנות — לא
 * ניקתה דווקא את אלה שבגללן היא הועלתה.
 *
 * **מה הבדיקה הזו אינה עושה:** היא אינה מריצה חישוב. אין היום הרנס
 * בדיקות ל-`MatchingService` (Prisma, RLS, הקשר דייר וטרנזקציה),
 * ובדיקה התנהגותית דורשת אותו. עד שיהיה — זו בדיקה מבנית, באותו
 * דפוס של `payment-claim` ו-`tenant-purge-coverage`: היא מונעת
 * חזרה לתבנית השגויה בעריכה עתידית, ולא יותר מזה.
 */

const SERVICE = readFileSync(join(import.meta.dirname, "matching.service.ts"), "utf8");

/** גוף `recomputeForProperty` עד תחילת הסינון הגס. */
const RECOMPUTE =
  /async recomputeForProperty\([\s\S]*?const fields = rowToFields\(property\);/u.exec(SERVICE)?.[0] ??
  "";

describe("רענון נכס מנקה מה שאינו ניתן לניקוד", () => {
  it("הפונקציה נמצאה", () => {
    expect(RECOMPUTE).not.toBe("");
  });

  /*
   * ‎**המחיקה מכוונת לנכס בלי מיקום, ולא לנכס שאי אפשר לחשב כאן.**
   *
   * שתי שאלות נפרדות. הסינון הגס נשען על שם העיר, ולכן בלי עיר אין
   * ממה לבחור מועמדים — אבל נכס עם קואורדינטות ובלי עיר **ממוקם**:
   * המנוע בוחן אותו מול אזורי המפה, ו-`recomputeForBuyer` בוחר
   * אותו דרך התיבה התוחמת. הגרסה הראשונה של הניקוי מחקה על
   * ‎`city === null` לבדו, וכך הרסה בכל סבב יומי התאמות תקינות
   * (ביקורת Codex).
   */
  it("„ממוקם” נשען על עיר **או** קואורדינטה", () => {
    expect(RECOMPUTE).toMatch(
      /const locatable = property\.city !== null \|\| property\.latitude !== null;/u,
    );
  });

  it("המחיקה תלויה בהיעדר מיקום, לא בהיעדר עיר", () => {
    const guard = /if \(!locatable\) \{[\s\S]*?return NO_MATCHES;\s*\}/u.exec(RECOMPUTE)?.[0] ?? "";
    expect(guard).not.toBe("");
    expect(guard).toContain("deleteMany");
    expect(guard.indexOf("deleteMany")).toBeLessThan(guard.indexOf("return NO_MATCHES;"));
  });

  /*
   * ‎**הענף שאינו מוחק חייב להישאר לא-מוחק.** נכס ממוקם שחסרים לו
   * שדות לסינון הגס יוצא בלי לגעת בהתאמות שהכיוון ההפוך יצר.
   */
  it("ממוקם אך חסר לסינון — יוצא בלי למחוק", () => {
    const branch =
      /if \(\s*property\.city === null \|\|[\s\S]*?return NO_MATCHES;\s*\}/u.exec(RECOMPUTE)?.[0] ??
      "";
    expect(branch).not.toBe("");
    expect(branch).not.toContain("deleteMany");
  });

  /*
   * שני ענפים מוחקים — „אין מיקום” ו„יצא משיווק”. הספירה תופסת
   * הוספת ענף מחיקה שלישי שלא נשקל.
   */
  it("בדיוק שני ענפים מוחקים הצעות", () => {
    const deletes = [
      ...RECOMPUTE.matchAll(
        /tx\.match\.deleteMany\(\{\s*where:\s*\{[^}]*status:\s*"suggested"[^}]*\}\s*\}\)/gu,
      ),
    ];
    expect(deletes).toHaveLength(2);
  });

  /*
   * הצעה שהסוכן כבר נגע בה אינה נמחקת — לא חוטפים ממנו כרטיס
   * שהוא עבד עליו. זו התנהגות קיימת, והבדיקה שומרת עליה.
   */
  it("רק הצעות שלא נגעו בהן נמחקות", () => {
    const deletes = [...RECOMPUTE.matchAll(/tx\.match\.deleteMany\(\{[\s\S]*?\}\)/gu)].map(
      (m) => m[0],
    );
    expect(deletes.length).toBeGreaterThan(0);
    for (const clause of deletes) {
      expect(clause).toContain('status: "suggested"');
      expect(clause).toContain("tenantId");
    }
  });
});
