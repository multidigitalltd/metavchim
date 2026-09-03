import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**„ליד ממתין מאתמול” — ארבע פעמים, בלי לומר על מי.**
 *
 * ## מה היה שבור
 *
 * שני האותות שמייצרים את ההמלצות הדחופות ביותר נכתבו עם שם קבוע:
 * ‎`contactName: "ליד"` ו-`contactName: "לקוח"`, עם הנימוק „ה-UI
 * מקשר לליד, אין צורך לפענח PII כאן”.
 *
 * הנימוק נכון למסך — ושגוי לחלוטין לסוכן בוואטסאפ, שנבנה במפורש
 * כדי שאפשר יהיה לעבוד **בלי** להיכנס למערכת. שם הטקסט הוא כל
 * ההודעה, ואין לאן ללחוץ: מתווך קיבל בבוקר ארבע שורות זהות של
 * „ליד ממתין מאתמול” ולא יכול היה לדעת אם אלה ארבעה לקוחות או
 * אחד (דיווח מהשטח).
 *
 * ## למה בדיקת קוד
 *
 * הניסוח נבדק בהתנהגות ב-`coach.test.ts`. מה שנשאר כאן הוא
 * **שהשם אכן מפוענח ולא נכתב קבוע** — הנפילה חזרה לקבוע היא
 * שורה אחת, והיא שקטה לגמרי: ההמלצות ממשיכות לצאת, רק בלי לומר
 * על מי.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const COACH = read("./coach.service.ts");
const WORKERS = read("../../../../../apps/workers/src/main.ts");

describe("השם בהמלצות המאמן", () => {
  it("השם מפוענח, ואינו נכתב קבוע", () => {
    expect(COACH).toContain("this.crypto.decrypt(row.nameEncrypted)");
    /*
     * ‎`?? "ליד"` ו-`?? "לקוח"` הם נפילה לגיטימית כשאין שם. מה
     * שאסור הוא הצורה הישנה — השמה ישירה בלי שאילתה.
     */
    expect(COACH, "שם קבוע במקום פענוח").not.toMatch(/contactName: "ליד"/u);
    expect(COACH, "שם קבוע במקום פענוח").not.toMatch(/contactName: "לקוח"/u);
    expect(COACH).toContain('contactName: contact?.name ?? "ליד"');
    expect(COACH).toContain('contactName: contact?.name ?? "לקוח"');
  });

  it("הטלפון נלקח יחד עם השם — אותה שורה, בלי שאילתה שנייה", () => {
    expect(COACH).toContain("this.crypto.decrypt(row.phoneEncrypted)");
    expect(COACH).toContain("contactPhone: contact?.phone");
  });

  /*
   * ‏שאילתה בתוך `.map()` על חמישה לידים היא חמש שאילתות בכל
   * טעינה של הדשבורד. הטעינה מרוכזת, ו-`contactsOf` מקבל רשימה.
   */
  it("אנשי הקשר נטענים בשאילתה אחת", () => {
    const fn = COACH.slice(COACH.indexOf("private async contactsOf("), COACH.indexOf("async recommendations()"));
    expect(fn).toContain("id: { in: ids }");
    expect(fn).toContain("new Set(contactIds)");
  });

  it("פענוח שנכשל אינו מפיל את ההמלצות", () => {
    const fn = COACH.slice(COACH.indexOf("private async contactsOf("), COACH.indexOf("async recommendations()"));
    expect(fn).toContain("catch");
  });

  /*
   * המשימה שנוצרת באסקלציה נקראת בשלושה מקומות — רשימת המשימות,
   * תקציר הבוקר וההתראה בוואטסאפ. כותרת בלי שם חוזרת בשלושתם.
   */
  it("משימת ה-SLA נושאת את שם הלקוח", () => {
    expect(WORKERS).toContain("function leadSlaTitle(");
    expect(WORKERS).toContain("title: leadSlaTitle(contactName)");
    expect(WORKERS).toContain("`לחזור ל${contactName} — מחכה יותר מדי זמן בלי מענה`");
  });

  it("גם ההתראה עצמה נוקבת בשם", () => {
    const fn = WORKERS.slice(
      WORKERS.indexOf("async function escalateLeadSla("),
      WORKERS.indexOf("await tx.interaction.create(", WORKERS.indexOf("async function escalateLeadSla(")),
    );
    expect(fn).toContain("`⏳ ${contactName} ממתין למענה`");
  });
});
