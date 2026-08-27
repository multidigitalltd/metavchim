import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**החותמת שאסור לה לזוז.**
 *
 * ההצעות האוטומטיות במייל מבטיחות גבול הפעלה: משרד שמדליק את הדגל
 * מקבל אותן על התאמות **חדשות**, ולא על המאגר ההיסטורי שלו. הגבול
 * מומש כ-`computed_at >= autoEmailOffersSince` — ו-`computed_at` זז:
 * ‎`upsertMatch` דורס אותו בכל חישוב מחדש, שקורה על כל עריכת נכס או
 * קונה.
 *
 * התוצאה: התאמה בת שנתיים שמחיר הנכס שלה עודכן אתמול נראתה כאילו
 * נולדה אתמול, חצתה את הגבול, ונשלחה במייל ללקוח שיושב במאגר
 * שנתיים (ביקורת Codex).
 *
 * ‎**מה שנשבר כאן אינו הערך אלא ההבטחה שהוא קבוע.** ערך שגוי מתגלה
 * בבדיקה; שדה שהתחיל לזוז נראה תקין לגמרי בכל שורה — ומתגלה רק
 * כשלקוח מקבל מייל על דירה שהוא כבר לא מחפש. לכן הבדיקה היא מבנית,
 * על הקוד עצמו.
 *
 * ‎**מה היא אינה עושה:** אינה מריצה שאילתה. אין הרנס בדיקות
 * ל-`MatchingService` (Prisma, RLS), ולכן זו בדיקה על המקור — באותו
 * דפוס של `office-names` ו-`network-disclosure`.
 */

const API_SRC = join(import.meta.dirname, "..", "..");

function read(...parts: string[]): string {
  return readFileSync(join(API_SRC, ...parts), "utf8");
}

describe("createdAt של התאמה", () => {
  const matching = read("modules", "matching", "matching.service.ts");

  it("הקובץ נקרא ומכיל את העדכון — אחרת הבדיקה בודקת מחרוזת ריקה", () => {
    expect(matching).toContain("tx.match.update(");
  });

  /*
   * ‎**כל עדכון של התאמה, ולא רק זה שב-`upsertMatch`.** מסלול עדכון
   * חדש שיוסיף `createdAt` ישבור את הגבול בדיוק כמו הישן.
   */
  it("שום עדכון של התאמה אינו כותב createdAt", () => {
    const updates = [...matching.matchAll(/tx\.match\.update(?:Many)?\(\{[\s\S]*?\n {4}\}\);/gu)];
    expect(updates.length).toBeGreaterThan(0);
    for (const [block] of updates) {
      expect(block).not.toContain("createdAt");
    }
  });

  it("computedAt דווקא כן מתעדכן — אחרת „חושב לאחרונה” היה משקר", () => {
    expect(matching).toContain("computedAt: new Date()");
  });
});

describe("גבול ההפעלה של ההצעות האוטומטיות", () => {
  const offerEmail = read("modules", "offers", "offer-email.service.ts");

  /*
   * ‎**זו ההנחה שנשברה.** הסינון היה על `computedAt`, ונראה נכון
   * לגמרי: „ההתאמה חושבה אחרי ההפעלה”. מה שהוא לא אמר הוא שחישוב
   * מחדש אינו יצירה.
   */
  it("הזכאות נמדדת לפי createdAt", () => {
    expect(offerEmail).toMatch(/createdAt:\s*\{\s*gte:\s*since\s*\}/u);
  });

  it("ולא לפי computedAt", () => {
    expect(offerEmail).not.toMatch(/computedAt:\s*\{\s*gte:\s*since\s*\}/u);
  });
});

describe("המיגרציה", () => {
  const sql = readFileSync(
    join(API_SRC, "..", "prisma", "migrations", "20260827060000_match_created_at", "migration.sql"),
    "utf8",
  );

  /*
   * ‎**המילוי לאחור הוא `computed_at` ולא `now()`.**
   *
   * מילוי ב-`now()` היה נותן לכל שורה קיימת חותמת **עתידית** ביחס
   * לכל הפעלה שקדמה לה — כלומר המיגרציה עצמה הייתה משחררת את כל
   * המאגר ההיסטורי, ומייצרת בדיוק את התקלה שהיא באה לתקן.
   */
  it("שורות קיימות מקבלות את computed_at, לא את הרגע הנוכחי", () => {
    expect(sql).toMatch(/UPDATE "matches" SET "created_at" = "computed_at"/u);
    expect(sql).not.toMatch(/SET "created_at" = (CURRENT_TIMESTAMP|now\(\))/iu);
  });

  it("העמודה חובה — התאמה בלי מועד יצירה אינה מצב חוקי", () => {
    expect(sql).toMatch(/ALTER COLUMN "created_at" SET NOT NULL/u);
  });

  /*
   * הסבב רץ כל עשר דקות לכל משרד שהדגל דלוק אצלו, על אותו צירוף
   * בדיוק. בלי אינדקס זו סריקה מלאה של טבלת ההתאמות בכל סבב.
   */
  it("יש אינדקס לסינון שהסבב מריץ", () => {
    expect(sql).toMatch(/CREATE INDEX[\s\S]*"tenant_id", "status", "created_at"/u);
  });
});
