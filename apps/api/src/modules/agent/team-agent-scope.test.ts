import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { AGENT_ACTIONS, ASSIGNABLE_ROLES } from "@metavchim/shared";
import { TeamMemberInputSchema } from "../settings/team.service";

/**
 * ‎**„תוסיף סוכן” מהשיחה — ומה שאסור שיילך איתו.**
 *
 * ## ‏למה זו הפעולה הרגישה בקטלוג
 *
 * ‏כל שאר הפעולות נוגעות בנתונים של המשרד. זו מוסיפה **מישהו**
 * ‏לתוך המשרד — עם גישה לנתוני הלקוחות שלו. פעולה שרצה על פירוש
 * ‏שגוי של משפט פותחת חשבון לאדם שאיש לא התכוון לצרף.
 *
 * ## ‏והסיסמה
 *
 * ‎`TeamService.create` מחזיר סיסמה זמנית — נכון למסך, שמציג
 * ‏אותה פעם אחת מול מי שיצר. **בשיחה אין „פעם אחת”**: ההודעה
 * ‏נשארת בטלפון, נקראת בעדכון מסך, ונשלחת הלאה בצילום מסך.
 * ‏הסוכן החדש מקבל קישור לקביעת סיסמה במייל, והסיסמה עצמה
 * ‏אינה נכתבת לשום מקום שיוצא מהשרת.
 *
 * ‏זו בדיוק ההבטחה שנשברת בעריכה הבאה — „נחזיר אותה, נוח יותר
 * ‏למנהל” — ולכן היא נבדקת ולא נכתבת בהערה.
 */

const FILE = new URL("./execute.service.ts", import.meta.url).pathname;
const source = readFileSync(FILE, "utf8");

/** ‏גוף השיטה בשם הזה, כטקסט. */
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

describe("הוספת סוכן מהשיחה — הסיסמה אינה יוצאת", () => {
  /*
   * ‎**הטענה המרכזית של הקובץ.** הסיסמה הזמנית אינה נכנסת לתשובה,
   * לא ל-`message`, לא ל-`data`, ולא ללוג.
   */
  it("הסיסמה הזמנית אינה מגיעה לשום דבר שיוצא", () => {
    const body = methodBody("addAgent");
    expect(body, "הסיסמה הוחזרה מהיצירה ונקשרה למשתנה").not.toMatch(/tempPassword/u);
  });

  /*
   * ‏מה שכן יוצא: קישור לקביעת סיסמה במייל. בלעדיו נפתח חשבון
   * ‏שאיש אינו יכול להיכנס אליו, והמנהל אינו יודע זאת.
   */
  it("במקומה נשלח קישור לקביעת סיסמה", () => {
    const body = methodBody("addAgent");
    expect(body).toContain("this.passwordReset.welcome(");
  });

  /*
   * ‎**ומדווח מה באמת קרה.** „נשלח קישור” על מייל שלא יצא הוא
   * ‏סוכן שממתין למשהו שלא יגיע, ומנהל שלא יידע לשלוח שוב.
   */
  it("כישלון בשליחה נאמר, ולא נבלע", () => {
    const body = methodBody("addAgent");
    expect(body).toMatch(/const sent = await this\.passwordReset\.welcome\(/u);
    expect(body).toMatch(/sent\s*\n?\s*\?/u);
  });

  /*
   * ‏המסלול היחיד שכותב שורת משתמש — עם המכסה, המנעול והיומן
   * ‏באותה טרנזקציה. שאילתה ישירה כאן הייתה מדלגת על שלושתם.
   */
  it("היצירה עוברת במסלול היחיד", () => {
    const body = methodBody("addAgent");
    expect(body).toContain("this.team.create(");
    expect(body, "כתיבה ישירה למסד מהביצוע").not.toMatch(/this\.prisma\.user\./u);
  });
});

/**
 * ‎**הקטלוג אינו שער — הוא הנחיה למודל.**
 *
 * ‏צמצום הפרמטרים ב-`/agent/execute` מסנן **מפתחות בלבד**:
 * ‎`params[field.key] = body.params[field.key]`. הרשימה `values`
 * ‏שבקטלוג מגבילה את מה שהמודל מתבקש לייצר, לא את מה שהנתיב
 * ‏מקבל — ולכן מנהל ששולח `memberRole: "owner"` ישירות עקף אותה.
 *
 * ‏הבדיקות כאן על **הסכימה שכותבת**, כי היא היחידה ששני המסלולים
 * ‏עוברים בה.
 */
describe("הוספת סוכן — מה שנכתב באמת נבדק", () => {
  /*
   * ‎**P1.** חשבון בעלים נושא `billing.manage` וכל מערך היכולות,
   * ‏ומסך ההגדרות מסרב לערוך אותו אחר כך — כלומר העלאת דרגה
   * ‏עצמית דרך נתיב צדדי, שאי אפשר לבטל מהממשק.
   */
  it("owner אינו ניתן להענקה", () => {
    const result = TeamMemberInputSchema.safeParse({
      name: "דנה כהן",
      email: "dana@example.com",
      role: "owner",
    });
    expect(result.success, "owner התקבל כתפקיד").toBe(false);
  });

  it("וכל תפקיד שכן ניתן להענקה מתקבל", () => {
    for (const role of ASSIGNABLE_ROLES) {
      const result = TeamMemberInputSchema.safeParse({
        name: "דנה כהן",
        email: "dana@example.com",
        role,
      });
      expect(result.success, `${role} נדחה`).toBe(true);
    }
  });

  /*
   * ‎**P2.** אימייל פגום נכנס, השליחה נכשלת, ונשאר חשבון שאי אפשר
   * ‏להיכנס אליו — ושתופס מקום במכסת המשתמשים של המסלול.
   */
  it("אימייל פגום נדחה לפני שנוצרת שורה", () => {
    for (const email of ["dana", "dana@", "@example.com", ""]) {
      expect(
        TeamMemberInputSchema.safeParse({ name: "דנה כהן", email, role: "agent" }).success,
        `„${email}” התקבל`,
      ).toBe(false);
    }
  });

  /*
   * ‏שדה שאינו בסכימה אינו „נשמר ליתר ביטחון”: `.strict()` הוא מה
   * ‏שמונע מפרמטר שהומצא בבקשה להגיע ל-`user.create`.
   */
  it("שדה שאינו בסכימה נדחה", () => {
    expect(
      TeamMemberInputSchema.safeParse({
        name: "דנה כהן",
        email: "dana@example.com",
        role: "agent",
        isActive: true,
      }).success,
    ).toBe(false);
  });
});

describe("הוספת סוכן — מה הקטלוג מצהיר", () => {
  const action = AGENT_ACTIONS.find((a) => a.id === "add_agent");

  it("הפעולה קיימת", () => {
    expect(action).toBeDefined();
  });

  /*
   * ‎`read` היה מריץ אותה מיד על הפירוש, בלי כרטיס ובלי אישור.
   * ‏פתיחת חשבון על משפט שהובן לא נכון היא בדיוק מה שאסור.
   */
  it("דורשת אישור מפורש ואינה רצה על פירוש", () => {
    expect(action?.risk).toBe("create");
  });

  /*
   * ‏אותה יכולת שהמסך דורש (`users.manage`). „מותר לו כי הוא לא
   * ‏נחסם” אינו טיעון: הסוכן אינו עובר בבקרים.
   */
  it("דורשת את היכולת שהמסך דורש", () => {
    expect(action?.capability).toBe("users.manage");
  });

  /*
   * ‏„תוסיף את דנה” הוא משפט שיכול להיות ליד, קונה, איש קשר או
   * ‏סוכן. בלי ההבחנה בתיאור, המודל בוחר לפי ניחוש — ופתיחת
   * ‏חשבון על כוונה ליצור ליד היא התקלה שאי אפשר לבטל בלחיצה.
   */
  it("התיאור מבדיל בינה לבין יצירת לקוח", () => {
    expect(action?.when).toMatch(/ליד|קונה|איש קשר/u);
  });
});
