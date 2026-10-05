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
    expect(SERVICE).toContain('sum(current, "deals")');
  });

  /*
   * ‎**והמונה נספר בנפרד מהרשימה** (ביקורת Codex, P2). התקרה קיימת
   * ‏כדי לשמור על זמן התגובה של המסך, ולא כדי לשנות את המספר:
   * ‏חודש עם 80 שת״פים היה מציג „50 מתוך 120”.
   */
  it("והמונה אינו אורך הרשימה החתוכה", () => {
    expect(SERVICE).toContain("partnerShare(partneredTotal,");
    expect(SERVICE).not.toContain("partnerShare(partnerDeals.length");
    expect(SERVICE).toContain("tx.property.count({ where: partnerWhere })");
  });

  /*
   * ‎**התקופה נמדדת על חותמת הסגירה** (ביקורת Codex, P1):
   * ‏‎`updatedAt` הוא „מתי מישהו נגע”, ולכן הוספת שותף לעסקה ישנה
   * ‏הייתה מזיזה אותה לחודש הנוכחי — וזה בדיוק מה שהשדה מזמין.
   */
  it("ועל חותמת הסגירה ולא על זמן העריכה", () => {
    expect(SERVICE).toContain("closedAt: { gte: start, lt: until }");
    expect(SERVICE).not.toContain("updatedAt: { gte: start, lt: until }");
    /* ‏וגם הניקוד עצמו — הגדרה אחת לשני הצדדים */
    expect(scoringWindow()).toContain("closedAt: range");
    expect(scoringWindow()).not.toContain("updatedAt: range");
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
    const from = PROPERTIES.indexOf("const nextAgent =");
    expect(from).toBeGreaterThan(0);
    const block = PROPERTIES.slice(from, PROPERTIES.indexOf("const readiness", from));
    expect(block).not.toContain("assertCanAssignAgents");
  });

  /* ‏הכלל היחיד — המסך והשרת קוראים ממנו, ולכן אין הצעה שנדחית */
  it("אבל הוא כן עובר בכלל המשותף ובבדיקת השייכות למשרד", () => {
    const from = PROPERTIES.indexOf("const nextAgent =");
    const block = PROPERTIES.slice(from, PROPERTIES.indexOf("const readiness", from));
    expect(block).toContain("partnerRejection(");
    expect(block).toContain("assertAgentInOffice(");
  });

  /*
   * ‎**והזוג נבדק כששני צידיו משתנים** (ביקורת Codex, P1). תנאי על
   * ‏`partnerUserId` בלבד דילג על שמירה שנוגעת רק בסוכן המטפל —
   * ‏והשאירה שותף בלי סוכן מטפל, או 500 מהאילוץ במסד.
   */
  it("והבדיקה רצה גם כששינו רק את הסוכן המטפל", () => {
    const from = PROPERTIES.indexOf("const nextAgent =");
    const block = PROPERTIES.slice(from, PROPERTIES.indexOf("const readiness", from));
    expect(block).toContain("agentUserId !== undefined || partnerUserId !== undefined");
    /* ‏ועל הזוג שיהיה אחרי השמירה, לא על מה שנשלח */
    expect(block).toContain("agentUserId: nextAgent");
    expect(block).toContain("partnerUserId: nextPartner");
  });
});
