import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, agentAction } from "./actions";
import { checkActionParams } from "./schema";

/**
 * ‎**ההצהרה בקטלוג היא כלל, ולא המלצה.**
 *
 * ‏עד כה `/agent/execute` צמצם פרמטרים **לפי שם השדה בלבד** ולא נגע
 * ‏בערך: `values: ASSIGNABLE_ROLES` הגביל את מה שהמודל **מתבקש
 * ‏לייצר**, ולא את מה שהמסלול **מקבל**. מי שמחובר יכול היה לשלוח
 * ‎`memberRole: "owner"` ולפתוח חשבון בעלים עם `billing.manage` —
 * ‏שאינו הפיך מהמסך (ביקורת Codex, P1 על #493).
 *
 * ‏זה מבני: 67 שדות `enum` ב-35 פעולות, ועוד 167 שדות עם גבולות.
 */

describe("הערך נבדק מול הקטלוג", () => {
  /*
   * ‎**הבדיקה שהפרצה נסגרה**, במקרה שהיא התגלתה בו.
   */
  it("owner אינו תפקיד שאפשר לשלוח ל-add_agent", () => {
    const action = agentAction("add_agent")!;
    const result = checkActionParams(action, {
      memberName: "דנה כהן",
      memberEmail: "dana@example.com",
      memberRole: "owner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe("memberRole");
      /* ‏ההודעה נוקבת בערכים המותרים — מי שקורא אותה מתקן לפיה */
      expect(result.message).toContain("agent");
    }
  });

  it("ותפקיד שכן ברשימה עובר", () => {
    const action = agentAction("add_agent")!;
    const result = checkActionParams(action, {
      memberName: "דנה כהן",
      memberEmail: "dana@example.com",
      memberRole: "agent",
    });
    expect(result.ok).toBe(true);
  });

  /* ‏גם מספרים מחוץ לתחום, ולא רק רשימות סגורות */
  it("מספר מחוץ לגבולות נדחה", () => {
    const action = agentAction("update_notifications")!;
    expect(checkActionParams(action, { quietFromHour: 99 }).ok).toBe(false);
    expect(checkActionParams(action, { quietFromHour: 23 }).ok).toBe(true);
  });

  /*
   * ‎**ריק = לא נאמר, ולא שגיאה.** שדה חסר הוא המצב הרגיל בקטלוג
   * ‏הזה, והמסך שולח `""` על שדה שלא נגעו בו. דחייה שלהם הייתה
   * ‏הופכת „לא מילאתי” לכישלון.
   */
  it("מחרוזת ריקה ורשימה ריקה יורדות ואינן נדחות", () => {
    const action = agentAction("create_buyer")!;
    const result = checkActionParams(action, { name: "דנה", phone: "", cities: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params).not.toHaveProperty("phone");
      expect(result.params).not.toHaveProperty("cities");
      expect(result.params["name"]).toBe("דנה");
    }
  });

  /*
   * ‎**מה שאינו שדה של הפעולה עובר כמו שהוא.** המזהים שנפתרו
   * ‎(`buyerId`, `relatedId`) ושדות `resolved` אינם ב-`fields`,
   * ‏והפלת שלהם כאן הייתה מנתקת את הקישור בדיוק בשלב האחרון.
   */
  it("מזהים ושדות שנפתרו אינם נופלים", () => {
    const action = agentAction("create_task")!;
    const result = checkActionParams(action, {
      taskTitle: "להתקשר לדני",
      relatedId: "01HTESTID0000000000000000",
      dueAt: "2026-09-20T08:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params["relatedId"]).toBe("01HTESTID0000000000000000");
      expect(result.params["dueAt"]).toBe("2026-09-20T08:00:00.000Z");
    }
  });

  /*
   * ‎**וכל הקטלוג עובר את עצמו.** אם הערך הראשון של כל רשימה סגורה
   * ‏אינו מתקבל, משהו בהגדרה עצמה שבור — ואז השער היה חוסם שימוש
   * ‏לגיטימי במקום לחסום התקפה.
   */
  it("הערך הראשון של כל שדה רשימה בקטלוג מתקבל", () => {
    for (const action of AGENT_ACTIONS) {
      for (const field of action.fields) {
        if (field.type !== "enum") continue;
        const first = field.values[0]!;
        const result = checkActionParams(action, { [field.key]: first });
        expect(result.ok, `${action.id}.${field.key} = ${first}`).toBe(true);
      }
    }
  });

  /* ‏ולהפך: ערך שאינו ברשימה נדחה בכל אחת מהן */
  it("וערך מומצא נדחה בכל שדה רשימה בקטלוג", () => {
    let checked = 0;
    for (const action of AGENT_ACTIONS) {
      for (const field of action.fields) {
        if (field.type !== "enum") continue;
        checked += 1;
        const result = checkActionParams(action, { [field.key]: "__לא_קיים__" });
        expect(result.ok, `${action.id}.${field.key}`).toBe(false);
      }
    }
    /* ‏שלא תעבור על אפס שדות ביום שמישהו ירוקן את הקטלוג */
    expect(checked).toBeGreaterThan(50);
  });
});
