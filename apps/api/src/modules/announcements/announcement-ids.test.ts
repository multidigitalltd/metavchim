import { describe, expect, it } from "vitest";
import { ANNOUNCEMENTS, RETIRED_ANNOUNCEMENT_IDS } from "@metavchim/shared";
import { SeenSchema } from "./announcements.controller";

/**
 * ‎**„הבנתי” חייב להישמר — גם מטאב שנפתח לפני הגרסה.**
 *
 * ## מה נשבר כאן
 *
 * ‏השרת מקבל רק מזהה **מוכר**, ובצדק: בלי זה לקוח היה יכול לכתוב
 * ‏מזהה מומצא וגבוה על המשתמש ולהשתיק לעצמו כל הכרזה עתידית. אבל
 * ‏„מוכר” אינו „מוצג היום”: כשהכרזה יורדת מהרשימה, טאב שכבר טען
 * ‏אותה ממשיך לשלוח את המזהה שלה — והדחייה פירושה אישור שאינו
 * ‏נשמר והרצועה חוזרת (ביקורת Codex, P2).
 *
 * ‏הכישלון הזה שקט: `whats-new-banner` בולע את השגיאה בכוונה.
 */
describe("מזהי „נצפה”", () => {
  it("מזהה שמוצג היום מתקבל", () => {
    const newest = ANNOUNCEMENTS[0];
    expect(newest).toBeDefined();
    expect(SeenSchema.safeParse({ id: newest?.id }).success).toBe(true);
  });

  /* ‏זו הבדיקה של הממצא: מזהה שהוסר עדיין מתקבל */
  it("מזהה שהוסר מהרשימה עדיין מתקבל", () => {
    expect(RETIRED_ANNOUNCEMENT_IDS.length).toBeGreaterThan(0);
    for (const id of RETIRED_ANNOUNCEMENT_IDS) {
      expect(SeenSchema.safeParse({ id }).success, id).toBe(true);
    }
  });

  /* ‏ומה שלא היה מעולם — נדחה. זו הסיבה שהרשימה סגורה מלכתחילה. */
  it("מזהה מומצא נדחה, גם כשהוא גבוה מכולם", () => {
    expect(SeenSchema.safeParse({ id: "zzzz-never-existed" }).success).toBe(false);
    expect(SeenSchema.safeParse({ id: "" }).success).toBe(false);
  });

  /*
   * ‎**רשומה שהוסרה אינה חוזרת לרשימה.** מזהה שנמצא בשתיהן פירושו
   * ‏שמישהו החזיר הכרזה בלי להסיר אותה מ„הוסרו” — והרשומה תוצג
   * ‏שוב למי שכבר סימן שראה אותה.
   */
  it("אין מזהה שנמצא גם ברשימה וגם ב„הוסרו”", () => {
    const shown = new Set(ANNOUNCEMENTS.map((a) => a.id));
    expect(RETIRED_ANNOUNCEMENT_IDS.filter((id) => shown.has(id))).toEqual([]);
  });
});
