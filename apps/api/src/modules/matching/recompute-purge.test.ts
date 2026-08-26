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
   * שני ענפי היציאה המוקדמת — „חסרים שדות” ו„יצא משיווק” — חייבים
   * שניהם למחוק. הבדיקה סופרת, כדי שהוספת ענף שלישי בלי מחיקה
   * תיתפס גם היא.
   */
  it("כל יציאה מוקדמת שאינה „הנכס לא נמצא” מוחקת הצעות", () => {
    const earlyReturns = [...RECOMPUTE.matchAll(/return NO_MATCHES;/gu)];
    // „הנכס לא נמצא” + „חסרים שדות” + „יצא משיווק”
    expect(earlyReturns).toHaveLength(3);

    const deletes = [
      ...RECOMPUTE.matchAll(
        /tx\.match\.deleteMany\(\{\s*where:\s*\{[^}]*status:\s*"suggested"[^}]*\}\s*\}\)/gu,
      ),
    ];
    expect(deletes).toHaveLength(2);
  });

  /*
   * ‎**סדר, לא רק נוכחות.** מחיקה שיושבת אחרי ה-`return` אינה רצה,
   * וזו בדיוק הצורה של הבאג שהיה כאן.
   */
  it("המחיקה קודמת ליציאה בענף השדות החסרים", () => {
    const branch =
      /property\.city === null[\s\S]*?return NO_MATCHES;/u.exec(RECOMPUTE)?.[0] ?? "";
    expect(branch).not.toBe("");
    expect(branch.indexOf("deleteMany")).toBeGreaterThan(-1);
    expect(branch.indexOf("deleteMany")).toBeLessThan(branch.indexOf("return NO_MATCHES;"));
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
