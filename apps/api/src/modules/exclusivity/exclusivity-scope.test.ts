import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**„הבלעדיויות שדורשות טיפול” — של מי שמטפל בהן.**
 *
 * ‏שורת ההתראה במסך הנכסים הציגה לכל מי שנכנס את כל הבלעדיויות של
 * המשרד. סוכן פתח את המסך שלו וראה „חסרות פעולות שיווק” על נכס
 * שאינו שלו, שאין לו מה לעשות איתו.
 *
 * ומה שזה עושה גרוע מהפרעה: תור שרובו לא-שלי מלמד את העין לדלג
 * עליו, ואז גם השורה שכן שלי נבלעת. כאן זה נופל על מועד שאחריו
 * הבלעדיות פוקעת **בדין**.
 *
 * ‏מה שקל לשבור כאן הוא לא החישוב אלא **מקום** הסינון: אותה רשימה
 * מוגשת לשני צרכנים (המסך והסוכן הקולי), והיא נחתכת ב-`LIMIT 200`.
 * סינון אחרי החיתוך נראה נכון בכל בדיקה על משרד קטן, ומתחיל לבלוע
 * שורות אמיתיות בדיוק במשרד הגדול שבגללו הוא נכתב.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./exclusivity.service.ts");
const OWNERSHIP = read("../../common/ownership.ts");
const AGENT = read("../agent/execute.service.ts");

const scope = OWNERSHIP.slice(OWNERSHIP.indexOf("export function ownedPropertyScope("));

/**
 * ‎`async list(` יושבת **אחרי** `async current(` בקובץ, ולכן חיתוך
 * בין השתיים מחזיר מחרוזת ריקה — ובדיקה על מחרוזת ריקה עוברת בשקט
 * על כל `not.toContain`. החיתוך כאן קדימה בלבד, והבדיקה הראשונה
 * מוודאת שהוא לא ריק.
 */
const from = (code: string, marker: string, chars: number): string => {
  const at = code.indexOf(marker);
  return at === -1 ? "" : code.slice(at, at + chars);
};

const list = from(SERVICE, "async list(", 1600);

describe("היקף הבלעדיויות — הכלל", () => {
  it("הכלל חי ב-`ownership.ts` ולא בשאילתה", () => {
    expect(scope).toContain("export function ownedPropertyScope(");
    expect(scope).toContain("agent_user_id = ${ctx.userId}");
  });

  /*
   * ‎**הבעלות על הנכס, לא על תיק הבלעדיות.** `property_exclusivities`
   * אינו נושא סוכן, ולכן התנאי הוא תת-שאילתה. השוואת עמודה על
   * הטבלה הזו הייתה מתקמפלת ומחזירה כלום.
   */
  it("הסינון עובר דרך הנכס ומסויג בשוכר", () => {
    expect(scope).toContain("property_id IN (SELECT id FROM properties");
    expect(scope, "בלי סיוג שוכר, תת-השאילתה חוצה משרדים").toContain(
      "WHERE tenant_id = ${tenantId}",
    );
  });

  /*
   * ‎**מנהל ממשיך לראות את כל המשרד.** לבלעדיות יש מועד שאחריו היא
   * פוקעת בדין, והאחריות היא של המשרד; הסתרתה ממי שמפקח הופכת את
   * התיקון לרגרסיה במקום הרגיש ביותר.
   */
  it("מי שרואה את עבודת המשרד אינו מסונן", () => {
    expect(scope).toContain('ctx.capabilities.has("tasks.view_all")');
    expect(scope).toContain("return Prisma.sql`TRUE`");
    /* הבדיקה לפני ההגבלה — אחריה היא כבר לא פוטרת מכלום */
    expect(scope.indexOf('has("tasks.view_all")')).toBeLessThan(
      scope.indexOf("property_id IN"),
    );
  });
});

describe("היקף הבלעדיויות — השאילתה", () => {
  it("השאילתה נחתכה נכון לבדיקה", () => {
    expect(list).not.toBe("");
    expect(list).toContain("FROM property_exclusivities");
  });

  /*
   * ‎**בתוך ה-WHERE, לפני ה-LIMIT.** סינון אחרי החיתוך היה מחזיר
   * לסוכן פחות משלו ככל שהמשרד גדול יותר — כלומר נכשל בדיוק במשרד
   * שבגללו הוא קיים.
   */
  it("הסינון בשאילתה עצמה, ולא על התוצאה", () => {
    expect(list).toContain("AND ${ownedPropertyScope(tenantId)}");
    expect(list.indexOf("ownedPropertyScope")).toBeLessThan(list.indexOf("LIMIT 200"));
  });

  /* עותק ידני של הכלל הוא בדיוק הדרך שבה הוא נשחק במקום השני */
  it("אין העתק ידני של הכלל בשירות", () => {
    expect(list).not.toContain("agent_user_id");
    expect(list).not.toContain('capabilities.has("tasks.view_all")');
  });
});

/*
 * ‎**הרשימה מוגשת גם בקול, ולכן גם המילים שם השתנו.** „אין בלעדיות
 * פעילות במשרד” הוא דיווח על המשרד כולו — טענה שהסוכן הקולי אינו
 * יכול לעשות עוד, כי הוא רואה רק את מה שבטיפול הדובר.
 */
describe("הסוכן הקולי אומר רק את מה שהוא יודע", () => {
  it("אינו מדווח על המשרד כשהוא רואה סוכן אחד", () => {
    const reply = from(AGENT, "const items = await this.exclusivity.list();", 500);
    expect(reply, "לא נמצאה התשובה של הסוכן הקולי").not.toBe("");
    expect(reply).toContain('"אין בלעדיות פעילות"');
    expect(reply, "„במשרד” הוא טענה על כל המשרד").not.toContain("אין בלעדיות פעילות במשרד");
  });
});
