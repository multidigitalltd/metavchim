import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ‎**מצב חיוב בוואטסאפ — פותח את התשלום, ולא שום דבר אחר.**
 *
 * ## מה נפתח כאן
 *
 * משרד שתקופתו נגמרה קיבל עד עכשיו „חדשו במסך ניהול המשרד” ותו
 * לא. עכשיו הוא מקבל כפתור שפותח דף תשלום אמיתי. זו הרחבה של מה
 * שמסלול חסום יודע לעשות, ולכן היא צריכה גבול שאפשר להצביע עליו.
 *
 * ## הגבול
 *
 * בדשבורד הוא קיים מזמן: `ctx.billingOnly` מחזיר 402 על כל נתיב
 * שאינו מסומן `@BillingAllowed`. לסוכן אין את השער הזה — הוא
 * **אינו עובר בבקרים** אלא קורא לשירותים ישירות (ראו
 * ‎`AGENT_ACTIONS`), ולכן „מותר לו כי הוא לא נחסם” אינו טיעון.
 *
 * מה שמחזיק את הגבול הוא שהמנוע כלל אינו רץ במסלול הזה:
 * ‎`handleExpiredOffice` מחזיר תשובה ויוצא, בלי פענוח, בלי זיהוי
 * ישות ובלי ביצוע. הבדיקה הזו קוראת את הפונקציה עצמה ומוודאת
 * זאת — כי „נזכור לא לקרוא למנוע משם” הוא בדיוק סוג ההבטחה
 * שנשברת בתוספת הבאה.
 *
 * ## ולמה `claimMessage` לפני התשלום
 *
 * ‎`startCheckout` **מבטל כל תשלום ממתין של המשרד**. Meta שולחת
 * הודעה שוב כשהתשובה מתמהמהת, ובלי התפיסה לחיצה אחת על „חידוש”
 * הייתה פותחת שני דפי תשלום — והשני מבטל את הראשון, שאולי כבר
 * פתוח מול הלקוח.
 */

const FILE = new URL("./whatsapp-assistant.service.ts", import.meta.url).pathname;
const source = readFileSync(FILE, "utf8");

/** גוף השיטה בשם הזה, כטקסט. */
function methodBody(name: string): string {
  const file = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2023, true);
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === name) {
      found = node.getText(file);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  if (found === null) throw new Error(`לא נמצאה שיטה בשם ${name}`);
  return found;
}

describe("משרד שתקופתו נגמרה — מה נפתח ומה לא", () => {
  /*
   * בלי זה הבדיקות למטה שומרות על פונקציה שאיש אינו קורא לה,
   * בזמן שהשער האמיתי עושה משהו אחר לגמרי.
   */
  it("שער התקופה באמת מנתב לשם", () => {
    /* ‏הקריאה מכילה סוגריים מקוננים, ולכן `[\s\S]*?` ולא `[^)]*`. */
    expect(source).toMatch(
      /if \(tenantPeriodEnded\([\s\S]*?\) \{\s*await this\.handleExpiredOffice\(msg, user\);\s*return;/u,
    );
  });

  /*
   * ‎**הטענה המרכזית של הקובץ.** המנוע אינו רץ במצב חיוב — לא
   * פענוח, לא זיהוי ישות ולא ביצוע. שלושתם נקראים דרך שדות
   * המחלקה, ולכן די לחפש אותם בגוף.
   */
  it("אינו מריץ את מנוע הפעולות", () => {
    const body = methodBody("handleExpiredOffice");
    for (const engine of ["this.interpreter", "this.resolver", "this.executor"]) {
      expect(body, `מצב חיוב קורא ל-${engine}`).not.toContain(engine);
    }
  });

  /*
   * ‏פתיחת תשלום דורשת את היכולת שפותחת תשלום גם במסך. כפתור למי
   * ‏שאין לו הוא הבטחה שנשברת בלחיצה.
   */
  it("פותח תשלום רק למי שרשאי לנהל חיוב", () => {
    const body = methodBody("handleExpiredOffice");
    expect(body).toContain('capabilities.has("billing.manage")');
    expect(body).toMatch(/if \(!pressedRenew \|\| !mayPay\)/u);
  });

  /*
   * ‎`startCheckout` מבטל כל תשלום ממתין, ולכן שליחה חוזרת של
   * Meta על אותה לחיצה חייבת להיעצר **לפני** הקריאה.
   */
  it("שליחה חוזרת אינה פותחת דף תשלום שני", () => {
    const body = methodBody("handleExpiredOffice");
    const claim = body.indexOf("this.claimMessage(");
    const checkout = body.indexOf("this.billing.renewalLink(");
    expect(claim, "אין תפיסת הודעה במסלול החידוש").toBeGreaterThan(-1);
    expect(checkout, "אין פתיחת תשלום במסלול החידוש").toBeGreaterThan(-1);
    expect(claim, "התשלום נפתח לפני תפיסת ההודעה").toBeLessThan(checkout);
  });

  /*
   * ‎`sendButtons` מחזיר `false` כשהיא אינה יכולה לשלוח (גוף ארוך
   * מהתקרה האינטראקטיבית, אין אישורי קו). בלי הנפילה לטקסט,
   * המשרד שתקופתו נגמרה — היחיד שחייב לקבל את ההודעה הזו — לא
   * מקבל דבר.
   */
  it("כשכפתור אינו אפשרי, ההודעה עדיין יוצאת", () => {
    const body = methodBody("handleExpiredOffice");
    expect(body).toContain("this.sender.sendButtons(");
    expect(body).toMatch(/if \(!withButton\) \{\s*await this\.sender\.sendText\(/u);
  });
});
