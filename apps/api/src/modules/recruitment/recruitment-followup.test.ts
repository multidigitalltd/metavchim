import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TASK_ENTITY_TYPES, taskEntityHref, isTaskEntityType } from "@metavchim/shared";

/**
 * ‎**פולואפ על נכס לגיוס הוא משימה עם מועד — ולא מנגנון שני.**
 *
 * ‏„לחזור לבעלים ביום חמישי ב-17:00” צריך מועד, בעלים, תזכורת
 * ‏וסנכרון יומן. כל אלה כבר קיימים על משימות, ולכן שורת הגיוס
 * ‏הצטרפה לאוצר המילים שלהן במקום לקבל `followUpAt` משלה — שהיה
 * ‏גורר סורק תזכורות שני, סנכרון שני ורשימה שנייה.
 */
describe("‏פולואפ בגיוס — משימה, לא מנגנון שני", () => {
  const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
  const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), "utf8");

  it("‏„גיוס” הוא סוג ישות חוקי למשימה", () => {
    expect(TASK_ENTITY_TYPES).toContain("recruitment");
    expect(isTaskEntityType("recruitment")).toBe(true);
  });

  it("‏ויש לו יעד — הוא אינו נכס", () => {
    expect(taskEntityHref("recruitment", "01T")).toBe("/properties/recruitment/01T");
    expect(taskEntityHref("property", "01T")).toBe("/properties/01T");
  });

  /*
   * ‎**אוצר מילים אחד, ולא ארבעה עותקים.**
   *
   * ‏אותה רשימה הייתה כתובה בשתי סכימות בבקר, בטיפוס ה-prop של
   * ‏הרכיב וב-`switch` של הקישור. סוג שנוסף לחלקם נכתב במסד ולא
   * ‏היה לו מסך, או נחסם במסך אחרי שהשרת קיבל אותו. השער בודק
   * ‏שאיש אינו מאיית אותה מחדש.
   */
  it("‏אף צרכן אינו מאיית את הרשימה מחדש", () => {
    const consumers = [
      ["tasks.controller", read("apps", "api", "src", "modules", "tasks", "tasks.controller.ts")],
      ["entity-tasks", read("apps", "web", "src", "app", "entity-tasks.tsx")],
    ] as const;
    for (const [name, source] of consumers) {
      expect(source, name).not.toMatch(/"lead",\s*"buyer",\s*"property"/u);
    }
    expect(read("apps", "api", "src", "modules", "tasks", "tasks.controller.ts")).toContain(
      "z.enum(TASK_ENTITY_TYPES)",
    );
  });

  /*
   * ‎**וסוכן אינו רואה את הפולואפ של עמיתו.**
   *
   * ‏`listForEntity` סינן לפי דייר וישות בלבד, והיכולת שהנתיב דורש
   * ‏(`calendar.manage`) יש לכל סוכן — כלומר כל משימה על אותו כרטיס
   * ‏הייתה קריאה לכולם. `scopeFilter` הוא הביטוי שהמודול כבר
   * ‏מחזיק, וההערה שמעליו מזהירה בדיוק מהנתיב ששוכח אותו.
   */
  it("‏רשימת המשימות של ישות מסוננת בבעלות", () => {
    const service = read("apps", "api", "src", "modules", "tasks", "tasks.service.ts");
    const start = service.indexOf("async listForEntity(");
    expect(start).toBeGreaterThan(-1);
    const rest = service.slice(start);
    const end = rest.search(/\n {2}(?:async |private |\/\*\*)/u);
    const method = end === -1 ? rest : rest.slice(0, end);
    /* ‏שלוש השאילתות — הפתוחות, שבוצעו, וההצעות */
    expect(method.split("tx.task.findMany").length - 1).toBe(3);
    expect(method.split("...this.scopeFilter()").length - 1).toBe(3);
  });

  /*
   * ‏ושורת הגיוס נשארת מחוץ לנכסים: המשימה מקשרת למסך הגיוס,
   * ‏ולא מייצרת נכס ולא נכנסת להתאמות. זו ההכרעה שכל מודול
   * ‏הגיוס עומד עליה — ראו `recruitment-separation.test.ts`.
   */
  it("‏המקטע במסך מותנה ביכולת שהנתיב דורש", () => {
    const page = read(
      "apps",
      "web",
      "src",
      "app",
      "properties",
      "recruitment",
      "[id]",
      "page.tsx",
    );
    const mount = page.indexOf('<EntityTasks entityType="recruitment"');
    expect(mount, "מקטע הפולואפ נעלם ממסך הגיוס").toBeGreaterThan(-1);
    const guard = page.slice(Math.max(0, mount - 400), mount);
    expect(guard).toContain('can(user, "calendar.manage")');
  });
});
