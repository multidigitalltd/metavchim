import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**התבנית שנרשמה ידנית ב-Meta, והקוד ששולח אליה.**
 *
 * ## למה בדיקת קוד ולא בדיקת התנהגות
 *
 * מה שנשבר כאן אינו חישוב אלא **התאמה בין שני צדדים שאין ביניהם
 * קומפיילר**: מה שבעל הפלטפורמה הקליד בטופס של Meta, ומה שהשירות
 * שולח. הצד השני אינו בריפו, ולכן מה שאפשר לקבע כאן הוא שהקוד
 * מרכיב את הבקשה כפי שתבנית בעלת שמות דורשת — ושהקוראים אינם
 * מרכיבים אותה בעצמם מחדש.
 *
 * הכישלון שהבדיקות האלה מקבעות הוא **שקט**: `sendTemplate` מחזיר
 * `false` ואינו זורק, וההודעה פשוט אינה מגיעה.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SEND = read("./whatsapp-send.service.ts");
const TELEPHONY = read("../telephony/telephony.service.ts");
const EMAIL = read("../email-inbox/email-inbox.service.ts");
const VIEWING = read("../calendar/viewing-reminder.service.ts");
const WORKERS = read("../../../../../apps/workers/src/main.ts");

describe("שליחת תבנית", () => {
  /*
   * ‎`params.map(text => ({ type, text }))` הוא בדיוק המשלוח המיקומי
   * ש-Meta דוחה בתבנית בעלת שמות. אם הוא חוזר — ההודעות נעלמות.
   */
  it("הערכים נמסרים כמו שהתקבלו, בלי הרכבה מיקומית מחדש", () => {
    const fn = SEND.slice(SEND.indexOf("async sendTemplate("), SEND.indexOf("async sendButtons("));
    expect(fn).toContain("{ type: \"body\", parameters: params }");
    expect(fn, "הרכבה מיקומית מחדש מבטלת את שמות המשתנים").not.toMatch(
      /parameters: params\.map\(/u,
    );
  });

  /*
   * ‎**כפתור נשלח רק כשיש כפתור.** Meta דוחה משני הכיוונים, ולכן
   * הרכיב מצטרף רק כשהקורא ביקש אותו במפורש.
   */
  it("הכפתור מצטרף רק כשנמסרה סיפא", () => {
    const fn = SEND.slice(SEND.indexOf("async sendTemplate("), SEND.indexOf("async sendButtons("));
    expect(fn).toContain("urlSuffix === undefined ? null : whatsappTemplateButton(urlSuffix)");
    expect(fn).toContain("...(button === null ? [] : [button])");
  });

  /* כל קורא מצהיר על התבנית שלו — ומקבל את שמותיה, לא שמות אחרים */
  it("כל ארבעת הקוראים עוברים דרך הבונה המשותף", () => {
    expect(TELEPHONY).toContain('whatsappTemplateParams("intake"');
    expect(EMAIL).toContain('whatsappTemplateParams("emailReply"');
    expect(VIEWING).toContain('whatsappTemplateParams("viewingReminder"');
    expect(WORKERS).toContain('whatsappTemplateParams("notify"');
  });

  /*
   * ‎**ההגדרה, ולא ניחוש.** תבנית שנרשמה בלי כפתור וקיבלה רכיב
   * כפתור נדחית — ולכן שני הקוראים שיודעים לשלוח כפתור בודקים קודם
   * מה נרשם בפועל.
   */
  it("הכפתור מותנה בהגדרה שאומרת מה נרשם ב-Meta", () => {
    expect(TELEPHONY).toContain('this.platformSettings.get("whatsappIntakeTemplateButton")');
    expect(TELEPHONY).toMatch(/hasButton\s*\?\s*whatsappDeepLinkSuffix\(/u);
    expect(WORKERS).toContain('stored.get("whatsappNotifyTemplateButton")');
    expect(WORKERS).toMatch(/config\.buttonUrl \? whatsappTemplateButton\(/u);
  });

  /*
   * ‎**שם המשרד נלקח מהדייר, ולא מהגדרה שיכולה לסטות ממנו.**
   *
   * הלקוח התקשר למשרד הזה, וההודעה חוזרת אליו בשמו. שדה נפרד היה
   * יכול להישאר על שם ישן אחרי שינוי שם משרד.
   */
  it("שם המשרד בהזמנת הדרישות מגיע מהדייר", () => {
    expect(TELEPHONY).toContain('select: { settings: true, name: true }');
    expect(TELEPHONY).toContain('const officeName = tenant?.name ?? "";');
    expect(TELEPHONY).toContain(
      'whatsappTemplateParams("intake", [officeName, created.url])',
    );
  });

  /*
   * ‎**הצורה נקבעת מההגדרה, לא מהגרסה.**
   *
   * תבנית שנרשמה עם נוסח אחד ומקבלת חמישה שמות נדחית אצל Meta,
   * ובערוץ „שניהם” המייל מצליח ולכן `deliver` מחזיר `true` ולא
   * נפתחת משימה — התזכורת בוואטסאפ נעלמת בלי סימן (ביקורת Codex,
   * P1). ברירת המחדל היא הישן, ולכן `=== "true"` ולא `!== "false"`.
   */
  it("צורת תזכורת הסיור נקראת מההגדרה, וברירת המחדל היא הישנה", () => {
    expect(VIEWING).toContain(
      'this.settings.get("whatsappViewingReminderTemplateFields")) === "true"',
    );
    expect(VIEWING).toContain('whatsappTemplateParams("viewingReminderFields"');
    expect(
      VIEWING,
      "בלי המסלול הישן, תבנית שכבר אושרה מפסיקה לעבוד בשקט",
    ).toContain('whatsappTemplateParams("viewingReminder", [body])');
  });

  /*
   * ‎**התזכורת לסיור אינה נושאת כפתור, בכוונה.** הנמען הוא לקוח או
   * דייר, ואין לו חשבון במערכת — כפתור „פתח במערכת” היה שולח אותו
   * למסך התחברות שאינו שלו.
   */
  it("תזכורת הסיור נשלחת בלי כפתור", () => {
    const fn = VIEWING.slice(VIEWING.indexOf("private async deliver("), VIEWING.indexOf("return delivered;"));
    expect(fn).not.toContain("whatsappDeepLinkSuffix");
  });
});
