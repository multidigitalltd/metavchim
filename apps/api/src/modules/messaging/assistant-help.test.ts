import { describe, expect, it } from "vitest";
import { helpMenu } from "./assistant-help";
import { isHelpMessage } from "./assistant-lang";

/**
 * ‎**הניסוח לוואטסאפ.** החלוקה עצמה — ומה נכלל בה — נבדקת ב-`shared`
 * (`agent-help.test.ts`), כי היא משרתת גם את המסך. מה שנבדק כאן הוא
 * מה שייחודי לערוץ: זיהוי בקשת התפריט, והטקסט שנשלח בפועל.
 */

describe("isHelpMessage", () => {
  it("מזהה בקשת תפריט על משפט שלם", () => {
    expect(isHelpMessage("עזרה")).toBe(true);
    expect(isHelpMessage(" עזרה! ")).toBe(true);
    expect(isHelpMessage("מה אתה יודע לעשות?")).toBe(true);
    expect(isHelpMessage("help")).toBe(true);
  });

  it("אינו חוטף משפט שרק מכיל את המילה", () => {
    expect(isHelpMessage("עזרה עם הקונה של אתמול")).toBe(false);
    expect(isHelpMessage("תפריט לפגישה מחר")).toBe(false);
  });
});

describe("helpMenu", () => {
  const allowed = ["find_buyers", "show_schedule", "create_buyer"];

  it("פונה בשם ומציג רק את הפעולות שמותרות", () => {
    const menu = helpMenu(allowed, "דוד");
    expect(menu.startsWith("דוד,")).toBe(true);
    expect(menu).toContain("לשאול על המאגר");
    expect(menu).toContain("היום שלי");
    expect(menu).toContain("להוסיף ולעדכן");
    // קבוצה שאין בה פעולה מותרת אינה מוצגת כלל
    expect(menu).not.toContain("רשת המשרדים");
  });

  /*
   * ‎**הכותרות נגזרות מהקטלוג ואינן מועברות פנימה.**
   *
   * קודם הן הגיעו כארגומנט, כלומר התפריט יכול היה להציג שם שאינו
   * שם הפעולה. עכשיו הוא מציג בדיוק את מה שהמודל מאומן עליו.
   */
  it("מציג כותרות ודוגמאות אמיתיות מהקטלוג", () => {
    const menu = helpMenu(["find_buyers"]);
    expect(menu).toContain("„");
    expect(menu.length).toBeGreaterThan(60);
  });

  it("אומר שאין הרשאות במקום להציג תפריט ריק", () => {
    expect(helpMenu([])).toContain("אין לך הרשאות");
  });

  it("מתעלם ממזהה שאינו בשום קבוצה — בלי לשבור את התפריט", () => {
    expect(helpMenu(["unknown_future_action"])).toContain("אין לך הרשאות");
  });

  /* התפריט הוא מה שנשלח כשההודעה האינטראקטיבית אינה אפשרית — הוא עומד בפני עצמו */
  it("מסביר שאפשר להקליט ושפעולה שמשנה נעצרת על אישור", () => {
    const menu = helpMenu(allowed);
    expect(menu).toContain("להקליט");
    expect(menu).toContain("אישור");
  });
});
