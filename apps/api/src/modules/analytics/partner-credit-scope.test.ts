import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**השער המרכזי של השת״פ הפנימי: הוא מתעד ואינו מחשב.**
 *
 * ‏הכרעת בעל המוצר היא שהניקוד בטבלה **אינו נוגע** בשת״פ — העסקה
 * ‏נספרת על הסוכן המטפל, בדיוק כפי שהיה. זה לא פרט מימוש: ברגע
 * ‏שסימון משנה דירוג, כל סימון הוא ויכוח, וסוכן שיודע שהוא מפסיד
 * ‏נקודות פשוט לא מסמן.
 *
 * ‏הבדיקה קוראת את המקור עצמו, כי החישוב יושב בתוך עסקה שדורשת
 * ‏מסד — ומה שצריך להישמר הוא **צורת השאילתה**, לא תוצאה אחת.
 */

const SERVICE = readFileSync(
  new URL("./analytics.service.ts", import.meta.url),
  "utf8",
);

/** ‏חלון הספירה של הניקוד — מ-`const window` ועד סופה. */
function scoringWindow(): string {
  const from = SERVICE.indexOf("const window = async (");
  expect(from, "חלון הספירה לא נמצא — הבדיקה מצביעה על קוד שזז").toBeGreaterThan(0);
  const to = SERVICE.indexOf("const [current, previous]", from);
  expect(to).toBeGreaterThan(from);
  return SERVICE.slice(from, to);
}

describe("הניקוד אינו יודע על שותף", () => {
  /*
   * ‎**זה הלב.** חלון הספירה הוא המקום היחיד שמזין את `boardScore`,
   * ‏ו-`partnerUserId` בתוכו — בקיבוץ, בסינון או בבחירה — פירושו
   * ‏שהשת״פ התחיל להשפיע על הדירוג.
   */
  it("חלון הספירה אינו נוגע בעמודת השותף", () => {
    expect(scoringWindow()).not.toContain("partnerUserId");
  });

  /* ‏העסקאות מקובצות לפי הסוכן המטפל, ולא לפי „מי היה מעורב” */
  it("והעסקאות מקובצות לפי הסוכן המטפל בלבד", () => {
    const win = scoringWindow();
    expect(win).toContain('by: ["agentUserId"]');
    expect(win).not.toContain('by: ["partnerUserId"]');
  });
});

describe("מקטע השת״פים קורא בנפרד", () => {
  /* ‏קריאה נפרדת לגמרי — לא ענף בתוך חלון הספירה */
  it("יש שאילתה משלו על עמודת השותף", () => {
    expect(SERVICE).toContain("partnerUserId: { not: null }");
  });

  /*
   * ‎**ואותה הגדרת „עסקה”.** הגדרה שנייה כאן הייתה מציגה
   * ‏„3 שת״פים מתוך 12 עסקאות” על שני מכנים שונים — מספר שנראה
   * ‏אמין ואינו נכון.
   */
  it("ועל אותה הגדרת עסקה שהניקוד סופר", () => {
    expect(SERVICE).toContain("status: { in: [...DEAL_STATUSES] }");
    /* ‏ולא רשימת סטטוסים שנכתבה שוב ביד לצד הקטלוג */
    expect(SERVICE).not.toMatch(/status:\s*\{\s*in:\s*\["sold"/u);
  });

  /* ‏המכנה הוא אותו `deals` שהניקוד סופר, ולא ספירה שנייה */
  it("והמכנה הוא הסכום שכבר חושב", () => {
    expect(SERVICE).toContain('partnerShare(partnerDeals.length, sum(current, "deals"))');
  });
});

describe("סימון שותף אינו שיוך", () => {
  const PROPERTIES = readFileSync(
    new URL("../properties/properties.service.ts", import.meta.url),
    "utf8",
  );

  /*
   * ‎**שער אחר מ-`agentUserId`, ובמכוון** (הכרעת בעל המוצר):
   * ‏העברת בעלות דורשת `tasks.assign`; תיעוד של מי עוד היה בעסקה
   * ‏אינו מעביר דבר, ודרישת אישור מנהל על שדה שאינו עולה כלום
   * ‏פירושה שדה שיישאר ריק לנצח.
   */
  it("ואינו דורש את היכולת להטיל משימות", () => {
    const from = PROPERTIES.indexOf("if (partnerUserId !== undefined) {");
    expect(from).toBeGreaterThan(0);
    const block = PROPERTIES.slice(from, PROPERTIES.indexOf("const readiness", from));
    expect(block).not.toContain("assertCanAssignAgents");
  });

  /* ‏הכלל היחיד — המסך והשרת קוראים ממנו, ולכן אין הצעה שנדחית */
  it("אבל הוא כן עובר בכלל המשותף ובבדיקת השייכות למשרד", () => {
    const from = PROPERTIES.indexOf("if (partnerUserId !== undefined) {");
    const block = PROPERTIES.slice(from, PROPERTIES.indexOf("const readiness", from));
    expect(block).toContain("partnerRejection(");
    expect(block).toContain("assertAgentInOffice(");
  });
});
