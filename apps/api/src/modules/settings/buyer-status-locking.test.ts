import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * ‎**רשימת הסטטוסים חיה במסמך JSON אחד — ולכן היא צריכה נעילה.**
 *
 * ## מה נשמר כאן
 *
 * שלוש טענות שאי אפשר לבדוק בבדיקת יחידה ואי אפשר לבדוק בבדיקת
 * אינטגרציה בלי לשחזר מרוץ: הן על **הימצאות** של קריאה בקוד, וברגע
 * שהיא תיעלם הן ייפלו.
 *
 * 1. עריכת הסטטוסים נועלת את שורת המשרד (`FOR UPDATE`). בלעדיה שני
 *    מנהלים שעורכים במקביל — או אחד שעורך סטטוס בזמן שהשני שומר את
 *    פרטי המשרד — דורסים זה את זה בשקט (ביקורת Codex).
 * 2. מסלול הכתיבה של הקונה לוקח נעילה **משותפת** על אותה שורה לפני
 *    שהוא קורא את הרשימה. זה הצד השני של אותו מרוץ: בלעדיו סוכן
 *    ששייך סטטוס בין הספירה למחיקה משאיר על הכרטיס מזהה שאינו נפתר
 *    לשום תווית.
 * 3. ספירת השימוש **אינה** מסננת `deletedAt`. קונה בארכיון עדיין
 *    נושא את הסטטוס, ושחזור שלו היה מחזיר כרטיס עם תווית שנעלמה.
 *
 * ההתנהגות של הנעילות עצמן (מי חוסם את מי) נבדקת מול Postgres אמיתי
 * ב-`buyers/office-status.int.test.ts`. כאן נבדק רק שהן נקראות.
 */

const read = (url: URL): string =>
  readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");

const SETTINGS = read(new URL("./settings.controller.ts", import.meta.url));
const BUYERS = read(new URL("../buyers/buyers.service.ts", import.meta.url));

/** גוף `saveBuyerStatuses` — כל הכתיבות עוברות דרכו. */
const SAVE = SETTINGS.slice(SETTINGS.indexOf("private async saveBuyerStatuses"));

describe("נעילה סביב רשימת סטטוסי הקונים", () => {
  it("עריכת הסטטוסים נועלת את שורת המשרד לפני שהיא קוראת", () => {
    const lock = SAVE.indexOf("lockTenantRow(tx, tenantId)");
    const read_ = SAVE.indexOf("readOfficeStatuses(tx, tenantId)");
    expect(lock).toBeGreaterThan(-1);
    expect(read_).toBeGreaterThan(-1);
    /* נעילה שנלקחת אחרי הקריאה אינה מגינה על דבר. */
    expect(lock).toBeLessThan(read_);
  });

  /*
   * ‎`inUse` הוא מה שמכריע בין מחיקה להסתרה. ספירה שרצה בטרנזקציה
   * משלה, לפני הנעילה, מאפשרת שיוך בין הספירה למחיקה.
   */
  it("ספירת השימוש רצה בתוך אותה טרנזקציה", () => {
    expect(SAVE).toMatch(/tx\.buyer\.count\(\{ where: \{ officeStatus: countFor \} \}\)/u);
  });

  it("ואינה מסננת קונים בארכיון", () => {
    const count = SAVE.slice(SAVE.indexOf("tx.buyer.count"));
    expect(count.slice(0, count.indexOf(")"))).not.toMatch(/deletedAt/u);
  });

  /*
   * שני מסלולי הכתיבה של הקונה — יצירה ועדכון — קוראים את הרשימה
   * ומכריעים לפיה. שניהם חייבים את הנעילה המשותפת.
   */
  it("מסלול הכתיבה של הקונה לוקח נעילה משותפת לפני כל קריאה של הרשימה", () => {
    /*
     * ‎**לכל מתודה בנפרד, ולא „איפשהו קודם בקובץ”.**
     *
     * הניסוח הראשון בדק אם `shareTenantRow` מופיע כלשהו לפני
     * הקריאה. הוא עבר גם כשהסרתי את הנעילה מ-`update`, כי הנעילה
     * ש-`createWithin` לוקחת יושבת קודם בקובץ — כלומר שער שאינו
     * שומר על מה שהוא מתיימר לשמור. מוטציה חשפה אותו.
     */
    const methods = BUYERS.split(/\n {2}(?:private )?async /u);
    const users = methods.filter((body) => body.includes("readOfficeStatuses("));
    expect(users.length).toBeGreaterThan(1);
    for (const body of users) {
      const name = body.slice(0, body.indexOf("("));
      const share = body.indexOf("shareTenantRow(tx, tenantId)");
      const read_ = body.indexOf("readOfficeStatuses(");
      expect(share, `${name}: אין shareTenantRow`).toBeGreaterThan(-1);
      expect(share, `${name}: הנעילה אחרי הקריאה`).toBeLessThan(read_);
    }
  });
});
