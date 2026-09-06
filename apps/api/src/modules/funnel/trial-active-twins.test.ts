import { describe, expect, it } from "vitest";
import { isTrialActive, trialActiveWhere } from "./funnel-enrollment.service";

/**
 * ‎**„הניסיון חי” — שתי צורות, כלל אחד.**
 *
 * ‏שאילתה אינה יכולה לקרוא לפונקציה, ושורה שכבר בידי אינה צריכה
 * ‏שאילתה; לכן שתי הצורות נחוצות. שני **כללים** אינם נחוצים, וזו
 * ‏בדיוק הפרידה שכבר קרתה כאן פעמיים: פעם `trialEndsAt: { not:
 * ‏null }` מול `> now`, ופעם `closePage` שחישב מהתאריך בלבד בזמן
 * ‏שהשאילתה דרשה גם `status` (ביקורת Codex, P2, שני סבבים).
 *
 * ‏שתיהן מיוצאות אך ורק בשביל הטבלה הזו. בדיקה מבנית על המקור
 * ‏הייתה מוכיחה ששני הביטויים **קיימים**, לא שהם מסכימים.
 */

const NOW = new Date("2026-09-06T12:00:00Z");
const FUTURE = new Date("2026-09-20T12:00:00Z");
const PAST = new Date("2026-08-20T12:00:00Z");

/** ‏האם השורה עוברת את תנאי ה-`where` שנבנה. */
function passesWhere(row: { status: string; trialEndsAt: Date | null }): boolean {
  const where = trialActiveWhere(NOW);
  if (row.status !== where.status) return false;
  return row.trialEndsAt !== null && row.trialEndsAt.getTime() > where.trialEndsAt.gt.getTime();
}

const ROWS: { status: string; trialEndsAt: Date | null; live: boolean; label: string }[] = [
  { status: "trial", trialEndsAt: FUTURE, live: true, label: "בניסיון, התאריך לפנינו" },
  { status: "trial", trialEndsAt: PAST, live: false, label: "בניסיון, התאריך עבר" },
  { status: "trial", trialEndsAt: null, live: false, label: "בניסיון בלי תפוגה — הוקם ידנית" },
  /*
   * ‏זו השורה שהפרידה נולדה עליה: משרד ששילם בזמן שהיה מסומן
   * ‏`trial` שומר את התאריך המקורי גם אחרי שהפך ל-`active`. הצורה
   * ‏שמסתכלת על התאריך לבדו קוראת לו „עדיין בניסיון”.
   */
  { status: "active", trialEndsAt: FUTURE, live: false, label: "שילם, והתאריך הישן עדיין עתידי" },
  { status: "suspended", trialEndsAt: FUTURE, live: false, label: "מושהה עם תאריך עתידי" },
  { status: "active", trialEndsAt: null, live: false, label: "לקוח משלם רגיל" },
];

describe("‏שתי הצורות של „הניסיון חי” מסכימות", () => {
  for (const row of ROWS) {
    it(row.label, () => {
      expect(isTrialActive(row, NOW), "הפונקציה").toBe(row.live);
      expect(passesWhere(row), "השאילתה").toBe(row.live);
    });
  }

  /*
   * ‏שני פיקוחים, ובלעדיהם הטבלה יכולה להיות ירוקה על „הכול פסול”
   * ‏או „הכול מותר”.
   */
  it("יש בטבלה מקרה חי ומקרה פסול", () => {
    expect(ROWS.some((row) => row.live)).toBe(true);
    expect(ROWS.some((row) => !row.live)).toBe(true);
  });

  /*
   * ‏והפיקוח שמכוון בדיוק אל הבאג: תאריך עתידי לבדו אינו מספיק.
   * ‏בלעדיו „התאריך לפנינו” היה עובר בשתי הצורות והטבלה לא הייתה
   * ‏מבדילה ביניהן כלל.
   */
  it("יש בטבלה שורה עם תאריך עתידי שאינה חיה", () => {
    expect(
      ROWS.some((row) => !row.live && row.trialEndsAt !== null && row.trialEndsAt > NOW),
    ).toBe(true);
  });
});
