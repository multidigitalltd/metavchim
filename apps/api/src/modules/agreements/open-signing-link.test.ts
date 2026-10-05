import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PhoneInputSchema } from "@metavchim/shared";

const read = (name: string): string =>
  readFileSync(new URL(name, import.meta.url), "utf8");

const CONTROLLER = read("./agreements.controller.ts");
const SERVICE = read("./agreements.service.ts");

/**
 * ‎**קישור החתמה פתוח — שני הדברים שאין למהדר דרך לתפוס.**
 *
 * ‏שניהם עלו בביקורת Codex, ושניהם „עובד, אבל לא עושה את מה
 * ‏שהתכונה קיימת בשבילו” — כלומר בדיוק מה שבדיקה מבנית נועדה
 * ‏לשמור עליו.
 */
describe("קישור החתמה פתוח — ההגנות שאינן נראות במהדר", () => {
  /*
   * ‎**הטלפון הוא מה שמזהה לקוח קיים.**
   *
   * ‏„אם זה לקוח קיים אז שההסכם יכנס לו כבר לכרטיס” הוא כל הלב
   * ‏של התכונה, והוא נשען על כך ש-`findOrCreateByPhone` תמצא את
   * ‏הכרטיס. היא מגבבת את מה שהיא מקבלת **כמות שהוא**, וכל שאר
   * ‏המערכת שומרת `+972…`.
   *
   * ‏חותם שהקליד `050-1234567` היה מייצר גיבוב שאינו תואם לשום
   * ‏כרטיס — כרטיס כפול, וההסכם עליו.
   */
  it("הטלפון של החותם עובר דרך הנרמול המשותף ולא כמחרוזת חופשית", () => {
    expect(CONTROLLER).toContain("phone: PhoneInputSchema");
    expect(CONTROLLER).not.toMatch(/phone: z\.string\(\)/u);
  });

  it("והנרמול עצמו הוא זה שכל המערכת שומרת לפיו", () => {
    expect(PhoneInputSchema.parse("050-123-4567")).toBe("+972501234567");
    expect(PhoneInputSchema.parse("0501234567")).toBe("+972501234567");
  });

  /*
   * ‎**הקשר הדייר נקבע במפורש.**
   *
   * ‏`withExplicitTenant` קובעת הקשר רק כשאין אחד — והיא צודקת.
   * ‏אבל הנתיב ציבורי, והחותם עשוי להחזיק עוגייה של משרד אחר; אז
   * ‏RLS יהיה של ההסכם וההקשר של העוגייה, והחתימה תיפול.
   */
  it("פתירת הכרטיס רצה תחת הדייר של ההסכם, ולא תחת עוגייה של החותם", () => {
    expect(SERVICE).toContain("TenantContext.run(\n      officeContext(head.tenantId),");
  });

  /*
   * ‎**בקשה שאינה תואמת את סוג הקישור נדחית בשני הכיוונים** —
   * ‏קישור פתוח בלי פרטים, והסכם רגיל שנשלחים אליו פרטים שהיו
   * ‏דורסים את מה שכבר בנוסח.
   */
  it("שני הכיוונים נחסמים, ולא רק אחד", () => {
    expect(SERVICE).toContain('row.signerTemplate !== null && input.open === undefined');
    expect(SERVICE).toContain('row.signerTemplate === null && input.open !== undefined');
  });

  /*
   * ‏הנוסח הקפוא הוא ההבטחה של המודול: מה שנחתם מורץ ממנו ולא
   * ‏מהתבנית של המשרד, שאולי השתנתה בינתיים.
   */
  it("החתימה מורצת מהנוסח הקפוא ולא מתבנית המשרד", () => {
    expect(SERVICE).toContain("renderAgreement(\n              row.signerTemplate,");
    expect(SERVICE).not.toContain("templateFor(tx, row.kind)");
  });
});
