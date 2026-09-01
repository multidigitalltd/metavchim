import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, activeOfficeStatuses, matchOfficeStatus } from "@metavchim/shared";

/**
 * ‎**שדה שמוצהר בקטלוג ואינו נקרא בביצוע — הבאג שהקטלוג נבנה למנוע.**
 *
 * ‎`field-spec.ts` מסביר למה השדות מוצהרים פעם אחת: כדי שהפרומפט,
 * הוולידציה והמסך לא יחלקו. אבל ההצהרה **אינה** מגיעה עד הביצוע —
 * המודל יכול למלא שדה שהמבצע פשוט לא קורא, והמתווך מקבל „הכרטיס
 * עודכן” על משפט שלא נכנס לשום מקום.
 *
 * זה לא תרחיש תיאורטי: `officeStatus` נוסף ל-`BUYER_PROFILE_FIELDS`,
 * שמשמש **גם** את `create_buyer`, ובלי לחפש אותו שם הוא היה נשמט
 * בדיוק שם — בכרטיס הראשון של כל לקוח שהוקלט בקול.
 *
 * ## למה רק שתי הפעולות האלה
 *
 * שער רחב על כל הקטלוג היה דורש רשימת היתרים ארוכה: תאריכים
 * וקואורדינטות נפתרים במקום אחר בכוונה, ופעולות קריאה אינן נוגעות
 * ב-`params` כלל. שער עם רשימת היתרים ארוכה נחלש עם הזמן עד שהוא
 * מפסיק לתפוס. שתי הפעולות שנוגעות בכרטיס הקונה נקיות היום, וזו
 * טענה שאפשר להחזיק.
 */

const EXECUTE = readFileSync(
  new URL("./execute.service.ts", import.meta.url),
  "utf8",
);

describe("כל שדה של פעולות הקונה נקרא בביצוע", () => {
  for (const id of ["create_buyer", "update_buyer"] as const) {
    it(`${id} — אין שדה מוצהר שאיש אינו קורא`, () => {
      const action = AGENT_ACTIONS.find((candidate) => candidate.id === id);
      expect(action, `${id} אינה בקטלוג`).toBeDefined();
      const unread = action!.fields
        .map((field) => field.key)
        .filter((key) => !EXECUTE.includes(`params["${key}"]`));
      expect(unread).toEqual([]);
    });
  }

  /*
   * ההכרעה עצמה חיה בחבילה המשותפת ונבדקת שם. כאן נבדק רק שהמבצע
   * באמת קורא לה — שדה שנקרא ואז מועבר כמו שהוא היה שומר על הכרטיס
   * את מה שנאמר במקום מזהה מהרשימה.
   */
  it("סטטוס המשרד נפתר מול הרשימה ואינו נשמר כטקסט", () => {
    expect(EXECUTE).toMatch(/matchOfficeStatus\(list, spoken\)/u);
    /* מה שנשמר הוא המזהה שחזר מההתאמה, ולא הטקסט. */
    expect(EXECUTE).toMatch(/if \(matched !== null\) return matched\.id;/u);
    /*
     * ‎**כל קריאה של השדה עוברת דרך ההכרעה.** מסלול אחד שמעביר את
     * מה שנאמר כמו שהוא היה שומר על הכרטיס „בסיורים” כמזהה — ערך
     * שאינו נפתר לשום תווית בשום מסך.
     */
    const raw = [...EXECUTE.matchAll(/params\["officeStatus"\]/gu)];
    const resolved = [
      ...EXECUTE.matchAll(/this\.spokenOfficeStatus\(str\(params\["officeStatus"\]\)\)/gu),
    ];
    expect(raw.length).toBeGreaterThan(1);
    expect(resolved.length).toBe(raw.length);
  });

  /* הפונקציה מיוצאת ובשימוש — לא העתק מקומי שיתיישן. */
  it("ההתאמה היא הפונקציה המשותפת", () => {
    expect(typeof matchOfficeStatus).toBe("function");
    expect(typeof activeOfficeStatuses).toBe("function");
  });
});
