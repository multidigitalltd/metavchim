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
  /*
   * ‎**ו„מגיע למסך” פירושו שהמסך מציג אותו.** בסבב הקודם השדה נוסף
   * ל-DTO ולא נוסף לו קורא: ה-`ThreadView` לא הכיר אותו והתצוגה
   * תייגה כל הודעה יוצאת „תשובת התמיכה”. ההודעה הצפה נעלמת ברענון,
   * והשורה נראית ככל תשובה שנשלחה (ביקורת Codex) — התיקון שנעצר
   * צעד לפני מי שצריך לדעת.
   */
  it("מצב השליחה מגיע למסך בשתי התיבות — וגם מוצג", () => {
    expect(SUPPORT).toMatch(/sendState\?: string;/u);
    expect(SUPPORT).toMatch(/message\.sendState === null \? \{\} : \{ sendState: message\.sendState \}/u);
    expect(SUPPORT_WEB).toMatch(/sendState\?: string;/u);
    expect(SUPPORT_WEB).toContain("function sendStateNote(");
    expect(SUPPORT_WEB).toContain("sendStateNote(message.sendState)");
    // אותן מילים כמו בתיבת הלקוחות — הפעולה הנדרשת זהה
    expect(SUPPORT_WEB).toContain("לא ידוע אם נשלחה — בדקו לפני שליחה חוזרת");
  });

  /*
   * הכלל המשותף נכתב כדי לשרת **את שתיהן**; חיווט לצד אחד בלבד
   * הוא בדיוק הכפילות שהוא בא לבטל, רק עם שם משותף.
   */
  it("שתי התיבות באמת קוראות לכלל המשותף", () => {
    expect(CUSTOMER).toContain("inboundProviderMessageId(payload)");
    expect(CUSTOMER).not.toMatch(/payload\.MessageID === ""/u);
    expect(SUPPORT).toContain("inboundProviderMessageId(payload)");
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
    // ‏`openRef` נקבע בפתיחה (אחרי המונה), ולכן הבדיקה שלפני הטעינה משמעותית
    expect(SUPPORT_WEB).toMatch(
      /async function openThread\(id: string\): Promise<void> \{[\s\S]{0,120}openRef\.current = id;/u,
    );
  });

  /*
   * ‎`inboundBody` חתך ל-5,000 לפני שהתקרה של התמיכה הופעלה, ולכן
   * התקרה שלה לא התקיימה מעולם ודוח ארוך איבד עד 15,000 תווים.
   */
  it("תקרת הגוף נמסרת פנימה ואינה חותכת פעמיים", () => {
    expect(SUPPORT).toContain("inboundBody(payload, BODY_MAX)");
    expect(SUPPORT).not.toMatch(/inboundBody\(payload\)\.slice\(/u);
  });

  /*
   * ‎**התקרה חייבת להתאים לעמודה.** `SupportMessage.body` הוא
   * ‎`VarChar(20000)`; תו אחד מעבר מפיל את הכתיבה, הוובהוק מחזיר
   * שגיאה, והספק מנסה שוב בלי סוף. אצל תיבת הלקוחות ההפרש הוסתר
   * במאה תווים של מרווח בעמודה (ביקורת Codex).
   */
  it("התקרה זהה לרוחב העמודה", () => {
    const schema = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
    const model = schema.slice(schema.indexOf("model SupportMessage"));
    const width = /body\s+String\s+@db\.VarChar\((\d+)\)/u.exec(model)?.[1];
    expect(width, "רוחב העמודה לא נמצא").toBeDefined();
    expect(SUPPORT).toContain(`const BODY_MAX = ${Number(width).toLocaleString("en-US").replace(/,/gu, "_")};`);
  });

  /*
   * ‎`openThread` מעדכן את `openRef` בשורתו הראשונה, ולכן בדיקה
   * אחריו בלבד מסכימה עם עצמה תמיד — והטעינה מושכת את השולחן
   * בחזרה לשרשור הישן.
   */
  it("הבדיקה נעשית גם לפני הטעינה מחדש", () => {
    const send = SUPPORT_WEB.slice(SUPPORT_WEB.indexOf("async function send("));
    const guard = send.indexOf("if (openRef.current !== threadId) return;");
    const reload = send.indexOf("await openThread(threadId);");
    expect(guard, "הבדיקה המקדימה לא נמצאה").toBeGreaterThan(-1);
    expect(reload, "הטעינה מחדש לא נמצאה").toBeGreaterThan(guard);
  });

  /*
   * תשובה של פתיחה שכבר הוחלפה נזרקת במקום לדרוס את השרשור הנבחר.
   */
  it("פתיחה שהוחלפה אינה כותבת למסך", () => {
    expect(SUPPORT_WEB).toContain("const mine = ++openSeq.current;");
    expect((SUPPORT_WEB.match(/if \(openSeq\.current !== mine\) return;/gu) ?? []).length).toBe(2);
  });
});
