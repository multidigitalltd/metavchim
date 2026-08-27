import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**תיבת התמיכה נכתבה כהעתק של תיבת הלקוחות — בלי התיקונים.**
 *
 * שלושה מהממצאים בסבב האחרון היו באגים שתיבת הלקוחות **כבר תיקנה
 * ותיעדה**: מזהה הודעה ריק שמרעיל את הדה-דופליקציה, חיתוך שיחה
 * שמציג את הישנות, ואזהרת „לא ידוע” שנמחקת בטעינה מחדש. אחד מהם
 * נושא שם, בקוד תיבת הלקוחות, הערה שמתעדת את הביקורת שמצאה אותו.
 *
 * זו אינה סדרת באגים אלא באג בתהליך: קוד הועתק אחרי שהמקור תוקן.
 * לכן הכללים המשותפים ירדו ל-`packages/shared`, והשער הזה אוכף
 * שהשתיים אינן נפרדות שוב.
 */

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

const SUPPORT = read("./support-inbox.service.ts");
const CUSTOMER = read("../email-inbox/email-inbox.service.ts");
const SUPPORT_WEB = read("../../../../web/src/app/platform/support-inbox-section.tsx");

describe("תיבת התמיכה מול תיבת הלקוחות", () => {
  /*
   * ‎**„אין מזהה” אינו מזהה.** העמודה ייחודית, ולכן מחרוזת ריקה
   * שנשמרת כערך אמיתי נתפסת על ידי ההודעה הראשונה בלי מזהה — וכל
   * פנייה נוספת בלי מזהה נדחית כ„כפילות”, גם משולח אחר. פניות
   * שנעלמות בשקט. `?? null` תופס `undefined` ולא מחרוזת ריקה.
   */
  it("שתי התיבות גוזרות את מזהה הספק מאותו כלל", () => {
    expect(SUPPORT).toContain("inboundProviderMessageId(payload)");
    expect(SUPPORT).not.toMatch(/payload\.MessageID \?\? null/u);
    expect(SUPPORT).not.toMatch(/providerMessageId: payload\.MessageID,/u);
  });

  /*
   * ‎`asc` עם `take` מחזיר את **הישנות**: פנייה חדשה נעלמת מהשולחן
   * בזמן שפתיחת השרשור מסמנת אותו כנקרא.
   */
  it("שתיהן שולפות את החדשות ומהפכות לתצוגה", () => {
    for (const [name, source] of [
      ["תמיכה", SUPPORT],
      ["לקוחות", CUSTOMER],
    ] as const) {
      const at = source.indexOf("take: 200");
      expect(at, `${name}: החיתוך לא נמצא`).toBeGreaterThan(-1);
      expect(source.slice(Math.max(0, at - 200), at), `${name}: מיון עולה לפני החיתוך`).toContain(
        'orderBy: { createdAt: "desc" }',
      );
    }
    expect(SUPPORT).toContain(".reverse()");
  });

  /*
   * בלי `sendState` ב-DTO, תשובה שהסתיימה בתוצאה עמומה נראית ככל
   * תשובה שנשלחה — הזמנה לשלוח שוב לנמען שאולי כבר קיבל.
   */
  it("מצב השליחה מגיע למסך בשתי התיבות", () => {
    expect(SUPPORT).toMatch(/sendState\?: string;/u);
    expect(SUPPORT).toMatch(/message\.sendState === null \? \{\} : \{ sendState: message\.sendState \}/u);
  });

  /*
   * ‎`openThread` פותח ב-`setNotice(null)`, ולכן אזהרה שנכתבת לפניו
   * נמחקת לפני שנראתה. אותו תיקון בדיוק כמו בתיבת הלקוחות.
   */
  it("האזהרה נקבעת אחרי הטעינה מחדש ושייכת לשרשור שממנו נשלח", () => {
    const reload = SUPPORT_WEB.indexOf("await openThread(threadId);");
    const notice = SUPPORT_WEB.indexOf('sent?.state === "unknown"');
    expect(reload, "הטעינה מחדש לא נמצאה").toBeGreaterThan(-1);
    expect(notice, "קביעת ההודעה לא נמצאה").toBeGreaterThan(reload);
    expect(SUPPORT_WEB).toContain("if (openRef.current === threadId) {");
    expect(SUPPORT_WEB).toMatch(/async function openThread\(id: string\): Promise<void> \{\n\s*openRef\.current = id;/u);
  });

  /*
   * ‎`inboundBody` חתך ל-5,000 לפני שהתקרה של התמיכה הופעלה, ולכן
   * התקרה שלה לא התקיימה מעולם ודוח ארוך איבד עד 15,000 תווים.
   */
  it("תקרת הגוף נמסרת פנימה ואינה חותכת פעמיים", () => {
    expect(SUPPORT).toContain("inboundBody(payload, BODY_MAX)");
    expect(SUPPORT).not.toMatch(/inboundBody\(payload\)\.slice\(/u);
  });
});
