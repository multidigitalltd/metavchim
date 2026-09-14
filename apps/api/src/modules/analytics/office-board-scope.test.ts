import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOARD_WEIGHTS } from "@metavchim/shared";

/**
 * ‎**„המשרד שלנו” — השיוכים שקל לשבור בלי לשים לב.**
 *
 * ‏המסך מדרג אנשים בשמם. שיוך שגוי כאן אינו מספר לא מדויק בדוח —
 * ‏הוא נקודות שסוכן אחד מקבל על עבודה של אחר, במסך שכל תכליתו
 * ‏לומר מי עשה מה. אלה ההכרעות, וכל אחת מהן היא שורה אחת שאפשר
 * ‏להחליף בטעות בשורה שנראית זהה.
 */

const SERVICE = readFileSync(
  join(import.meta.dirname, "analytics.service.ts"),
  "utf8",
);

/** ‏גוף `board` בלבד — לשאר הקובץ יש חלונות ושיוכים אחרים. */
const BOARD = (() => {
  const at = SERVICE.indexOf("async board(");
  expect(at, "המתודה board לא נמצאה").toBeGreaterThan(-1);
  return SERVICE.slice(at);
})();

describe("השיוך של כל מדד", () => {
  /*
   * ‎**זו ההכרעה שנושאת את המשקל.** פגישה שמנהל קובע לסוכן היא של
   * ‏הסוכן; ספירתה ל-`created_by` הייתה נותנת למנהל נקודות על
   * ‏עבודה של מישהו אחר — בדיוק במסך שאמור לומר מי עשה מה.
   */
  it("פגישות נספרות ליומן של מי, ולא למי שהקליד", () => {
    const appointments = BOARD.slice(BOARD.indexOf("tx.appointment.groupBy"));
    expect(appointments.slice(0, 300)).toContain('by: ["ownerUserId"]');
    expect(appointments.slice(0, 300)).not.toContain("createdBy");
  });

  /* ‏ופגישה שבוטלה אינה פעילות — היא בדיוק ההפך */
  it("פגישה שבוטלה אינה נספרת", () => {
    expect(BOARD).toContain('status: { not: "cancelled" }');
  });

  /*
   * ‎**שיחות יוצאות בלבד.** שיחה נכנסת מגיעה למי שהמרכזייה ניתבה
   * ‏אליו, ולכן היא מודדת ניתוב ולא יוזמה — ובטבלת תחרות זה ההבדל
   * ‏בין „מי עבד” ל„מי קיבל”.
   */
  it("רק שיחות יוצאות נספרות", () => {
    expect(BOARD).toContain('direction: "outgoing"');
  });

  /* ‏נכס שנמחק אינו גיוס ואינו עסקה, גם אם הסטטוס נשאר */
  it("נכס מחוק אינו נספר באף צד", () => {
    const properties = BOARD.match(/tx\.property\.groupBy/gu) ?? [];
    expect(properties.length, "שתי שאילתות נכסים: גיוס וסגירה").toBe(2);
    expect((BOARD.match(/deletedAt: null/gu) ?? []).length).toBe(2);
  });
});

describe("התקופה", () => {
  /*
   * ‎**הדירוג הקודם מחושב ואינו נשמר.** מיקום שמור בטבלה מתיישן
   * ‏ברגע שסוכן מצטרף או עוזב, והתנועה שהמסך מציג הייתה נמדדת
   * ‏מול צילום שגוי.
   */
  it("התקופה הקודמת נמדדת מחדש מאותן שאילתות", () => {
    expect(BOARD).toContain("window(prevStart, start)");
    expect(BOARD, "אין עמודת דירוג שמורה").not.toMatch(/previousRank:\s*(?:row|r)\./u);
  });

  /* ‏וגבול התקופה מגיע מהחבילה המשותפת, בשעון ישראל */
  it("הגבול נגזר מ-periodStart ולא מחישוב מקומי", () => {
    expect(BOARD).toContain("periodStart(period, now)");
    expect(BOARD).not.toContain("setMonth(");
  });
});

describe("היעד והניקוד", () => {
  /*
   * ‏היעד הוא זה שהסוכן קבע לעצמו במנטור. יעד שהסתיים שייך
   * ‏לתקופה שנגמרה, וספירתו הייתה מציגה אחוז מול מטרה ישנה.
   */
  it("רק יעד חודשי פעיל נספר", () => {
    expect(BOARD).toContain('period: "month"');
    expect(BOARD).toContain("endedAt: null");
  });

  /*
   * ‎**הניקוד מגיע מהחבילה המשותפת**, שממנה גם נגזר הכיתוב שמעל
   * ‏הטבלה. חישוב מקומי כאן היה מייצר מספר שאינו תואם את הנוסחה
   * ‏שהמסך מדפיס — וזה בדיוק הרגע שבו סוכן סופר ביד ומפסיק
   * ‏להאמין למערכת.
   */
  it("הניקוד מחושב ב-boardScore ולא כאן", () => {
    expect(BOARD).toContain("boardScore(");
    for (const weight of Object.values(BOARD_WEIGHTS)) {
      expect(BOARD, `משקל ${weight} נכתב ביד`).not.toMatch(
        new RegExp(String.raw`\*\s*${weight}\b`, "u"),
      );
    }
  });
});
