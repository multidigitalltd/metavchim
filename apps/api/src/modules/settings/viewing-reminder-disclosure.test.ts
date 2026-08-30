import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**„הנוסח הזה יוצא במייל בלבד” — והאם זה באמת מה שקורה.**
 *
 * ## למה בדיקת קוד ולא בדיקת התנהגות
 *
 * ‏מה שנשבר כאן הוא **התאמה בין שלושה צדדים שאין ביניהם קומפיילר**:
 * ההגדרה שאומרת איזו תבנית נרשמה מול Meta, השולח שקורא אותה, והמסך
 * שמספר למשרד מה יקרה לטקסט שהוא כותב.
 *
 * ‎`apiGet<T>` הוא **הצהרה ולא ולידציה**, ושער התאמת הצורות משווה
 * רק „אובייקט מול מערך” — לא שדות. כלומר שדה שיוסר מהבקר יחזור
 * ‎`undefined` למסך, ההודעה פשוט לא תוצג, והמשרד יערוך נוסח ויאמין
 * שהוא נשלח בוואטסאפ. הכישלון **שקט**, ושום טיפוס אינו נשבר בו.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const CONTROLLER = read("./settings.controller.ts");
const SENDER = read("../calendar/viewing-reminder.service.ts");
const SCREEN = read("../../../../../apps/web/src/app/settings/automations-section.tsx");

describe("גילוי נאות על נוסח תזכורת הסיור", () => {
  /* בלי השדה בבקר, המסך מקבל `undefined` וההודעה נעלמת בשקט */
  it("הבקר מוסר את מצב התבנית למסך", () => {
    expect(CONTROLLER).toContain("whatsappViewingReminderFields: boolean;");
    expect(CONTROLLER).toContain(
      'this.platformSettings.get("whatsappViewingReminderTemplateFields")',
    );
  });

  /*
   * ‎**אותה ברירת מחדל בדיוק כמו בשולח.**
   *
   * ‏`=== "true"` בשני הצדדים. אילו המסך היה קורא `!== "false"`, הוא
   * היה מציג „נשלח במייל בלבד” בזמן שהשולח עדיין שולח את הנוסח
   * בוואטסאפ — מסך שמתאר מערכת אחרת מזו שרצה.
   */
  it("המסך והשולח קוראים את ההגדרה באותה ברירת מחדל", () => {
    expect(CONTROLLER).toMatch(
      /get\("whatsappViewingReminderTemplateFields"\)\s*\)?\s*===\s*\n?\s*"true"/u,
    );
    expect(SENDER).toContain(
      'this.settings.get("whatsappViewingReminderTemplateFields")) === "true"',
    );
  });

  /*
   * ‎**ההודעה מותנית בדגל, ולא מוצגת תמיד.**
   *
   * „נשלח במייל בלבד” על משרד שהתבנית שלו היא הנוסח החופשי היא
   * טענה הפוכה מהאמת — והיא הייתה מרתיעה מלערוך נוסח שכן נשלח.
   */
  it("ההודעה מוצגת רק כשהתבנית היא זו עם השדות", () => {
    expect(SCREEN).toContain("data.whatsappViewingReminderFields ?");
    expect(SCREEN).toContain("במייל בלבד");
  });

  /*
   * ‎**וגם הצהרת הטיפוס במסך.** בלעדיה `data.whatsappViewingReminderFields`
   * אינו קיים בטיפוס, וההידור נופל — אבל דווקא הצהרה שנשארת בלי
   * שהבקר מוסר את השדה היא המצב השקט, ולכן שני הצדדים נבדקים.
   */
  it("המסך מצהיר על השדה", () => {
    expect(SCREEN).toContain("whatsappViewingReminderFields: boolean;");
  });
});
