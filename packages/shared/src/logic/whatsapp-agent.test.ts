import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { WHATSAPP_AGENT_DENIAL_TEXT, whatsappAgentDenial } from "./whatsapp-agent";

/**
 * ‎**מי רשאי לסוכן בוואטסאפ — ומה קורה למי שאינו.**
 *
 * שתי תקלות נפרדות מכוסות כאן, ושתיהן היו „עובד” עד שמישהו הסתכל:
 *
 * 1. ‎**הזכאות נבדקה רק על הודעה נכנסת.** הפקת קוד הצימוד הייתה
 *    פתוחה לכל משתמש מאומת בכל מסלול — אונבורדינג מלא לתכונה שאינה
 *    נמכרת למשרד הזה, וקישור חי במסד שאיש לא ישתמש בו.
 * 2. ‎**ההסבר נבלע.** אחרי שנוסף השער, המסך קיבל 403 עם הסיבה
 *    המדויקת והציג „הפקת הקוד נכשלה — נסו שוב”: הוראה לנסות שוב על
 *    בקשה שלעולם לא תצליח (ביקורת Codex).
 */
describe("זכאות לסוכן בוואטסאפ", () => {
  it("מסלול שאינו כולל את הסוכן חוסם את כולם, גם את בעל המשרד", () => {
    expect(
      whatsappAgentDenial({ planHasAgent: false, role: "owner", whatsappAccess: true }),
    ).toBe("plan");
  });

  /* בעל המשרד הוא בעל המנוי, ואיש אינו מוסמך להדליק לו את הדגל */
  it("בעל המשרד כלול גם בלי מנוי אישי", () => {
    expect(
      whatsappAgentDenial({ planHasAgent: true, role: "owner", whatsappAccess: false }),
    ).toBeNull();
  });

  it("סוכן בלי מנוי אישי נחסם, ועם מנוי מורשה", () => {
    expect(
      whatsappAgentDenial({ planHasAgent: true, role: "agent", whatsappAccess: false }),
    ).toBe("seat");
    expect(
      whatsappAgentDenial({ planHasAgent: true, role: "agent", whatsappAccess: true }),
    ).toBeNull();
  });

  /*
   * הסדר אינו שרירותי: „אינו כלול במסלול” הוא מצב של המשרד, ו„לא
   * הופעל עבורך” הוא מצב אישי שיש לו פתרון בלחיצה. הצגת השני
   * כשהראשון הוא הסיבה שולחת את המתווך לבקש משהו שאין לו מה לעשות
   * איתו.
   */
  it("המסלול קודם למנוי האישי כשהשניים חסרים", () => {
    expect(
      whatsappAgentDenial({ planHasAgent: false, role: "agent", whatsappAccess: false }),
    ).toBe("plan");
  });

  it("לכל סיבה יש נוסח, והוא אומר מה לעשות", () => {
    expect(WHATSAPP_AGENT_DENIAL_TEXT.plan).toContain("מסלול");
    expect(WHATSAPP_AGENT_DENIAL_TEXT.seat).toContain("בעל המשרד");
  });
});

describe("שני הצדדים משתמשים באותה הכרעה", () => {
  const read = (relative: string): string =>
    readFileSync(new URL(relative, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");

  const SETTINGS = read("../../../../apps/api/src/modules/settings/settings.controller.ts");
  const PROFILE = read("../../../../apps/web/src/app/profile/whatsapp-link-section.tsx");

  /*
   * שתי נקודות הכניסה — הצגת המצב והפקת הקוד — חייבות לענות אותה
   * תשובה. שתי בדיקות מקבילות היו נפרדות ביום שאחת מהן משתנה,
   * וההפרש ביניהן הוא בדיוק החור.
   */
  it("הצגת המצב והפקת הקוד קוראות לאותה פונקציה פרטית", () => {
    expect(SETTINGS).toContain("private async whatsappAgentDenial()");
    expect((SETTINGS.match(/await this\.whatsappAgentDenial\(\)/gu) ?? []).length).toBe(2);
  });

  /* הסיבה נמסרת עם המצב, ולא רק כשגיאה אחרי לחיצה */
  it("הזכאות נמסרת למסך יחד עם מצב החיבור", () => {
    expect(SETTINGS).toMatch(/Promise<LinkStatus & \{ denial\?: WhatsappAgentDenial \}>/u);
  });

  /*
   * ‎**ההודעה של השרת אינה נבלעת.** זו התקלה עצמה: 403 שנשא את
   * הסיבה הוחלף ב„נסו שוב”.
   */
  it("המסך שומר את הודעת השרת ואינו מחליף אותה", () => {
    expect(PROFILE).toContain("err instanceof ApiError ? err.message");
  });

  /* וכשאי אפשר — לא מציעים כפתור שיכשל */
  it("כפתור ההפקה אינו מוצג כשהזכאות נשללה", () => {
    expect(PROFILE).toContain("status?.denial === undefined ? (");
    expect(PROFILE).toContain("WHATSAPP_AGENT_DENIAL_TEXT[status.denial]");
  });
});
