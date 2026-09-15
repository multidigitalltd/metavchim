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
  /** ‏בלי הערות — הסבר שמזכיר ביטוי אינו הביטוי עצמו. */
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

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
   * ‎**סוכן אינו רואה את הפולואפ של עמיתו — וההשתקה נשארת משרדית.**
   *
   * ‏`listForEntity` סינן לפי דייר וישות בלבד, והיכולת שהנתיב דורש
   * ‏(`calendar.manage`) יש לכל סוכן — כלומר כל משימה על אותו כרטיס
   * ‏הייתה קריאה לכולם. אבל הסינון הוחל גם על שאילתת ההצעות, וזה
   * ‏היה יותר מדי (ביקורת Codex, P1 — על התיקון הקודם שלי).
   *
   * ‏„הצעה” היא על הכרטיס ולא על הסוכן: אם עמית כבר פתח אותה,
   * ‏העבודה נעשית. סינון לפי בעלות החזיר אותה כזמינה אצל השני,
   * ‏ושליחתה הגיעה לניכוי הכפילויות — שהחזיר את הכרטיס של העמית,
   * ‏עם שם המשויך ושם היוצר.
   *
   * ‏שתי טענות, ולכן שתי בדיקות: השאילתה השלישית **בלי** סינון,
   * ‏והניכוי אינו מוסר DTO מחוץ להיקף.
   */
  it("‏השתקת ההצעות משרדית — ורק שתי שאילתות המשימות מסוננות", () => {
    const service = read("apps", "api", "src", "modules", "tasks", "tasks.service.ts");
    const start = service.indexOf("async listForEntity(");
    const rest = service.slice(start);
    const end = rest.search(/\n {2}(?:async |private |\/\*\*)/u);
    const method = end === -1 ? rest : rest.slice(0, end);
    expect(method.split("tx.task.findMany").length - 1).toBe(3);
    /* ‏שתיים, לא שלוש: ההצעות נספרות משרדית */
    expect(method.split("...this.scopeFilter()").length - 1).toBe(2);
    expect(method).toContain("sourceKey: { startsWith: SUGGESTION_PREFIX }");
  });

  it("‏הניכוי אינו מוסר משימה של עמית", () => {
    const service = strip(
      read("apps", "api", "src", "modules", "tasks", "tasks.service.ts"),
    );
    const at = service.indexOf("sourceKey: input.sourceKey");
    expect(at, "ניכוי הכפילויות לא נמצא").toBeGreaterThan(-1);
    const block = service.slice(at, at + 900);
    expect(block).toContain("this.inScope(existing)");
    /* ‏והבדיקה נגזרת מאותה הכרעה, ולא מנוסחת לצדה */
    expect(service).toMatch(/inScope\([\s\S]{0,400}this\.scopeFilter\(\)/u);
  });

  /*
   * ‏ולפולואפ יש תווית — המסך מרכיב את הקישור רק כשיש גם נתיב וגם
   * ‏תווית, ולכן בלעדיה „לחזור לבעלים” לא אמר על איזה נכס.
   */
  it("‏לשורת גיוס יש תווית ברשימת המשימות", () => {
    const service = read("apps", "api", "src", "modules", "tasks", "tasks.service.ts");
    const start = service.indexOf("private async entityLabels(");
    const rest = service.slice(start);
    const end = rest.search(/\n {2}(?:async |private |\/\*\*)/u);
    const method = end === -1 ? rest : rest.slice(0, end);
    expect(method).toContain('byType.get("recruitment")');
    expect(method).toContain("tx.recruitmentTarget.findMany");
    expect(method).toContain('key("recruitment", t.id)');
  });

  /*
   * ‎**היכולת שהתווית והשער נשענים עליה — הצהרה אחת** (ביקורת
   * ‏Codex, P2, ואז שוב).
   *
   * ‎`calendar.manage` ו-`properties.view` הן שתי יכולות נפרדות, ומי
   * ‏שנשללה ממנו השנייה בלבד קיבל את כתובת שורת הגיוס ואת הקישור
   * ‏אליה — בזמן שהבקר דוחה אותו בכניסה. עכשיו יש **שני** קוראים
   * ‏באותו קובץ: התווית ברשימה, והשער שלפני הקישור.
   *
   * ‏הניסוח הקודם של השער הזה חיפש את המחרוזת
   * ‎`capabilities.has("properties.view")` בחלון שאחרי
   * ‎`byType.get("recruitment")` — כלומר נצמד ל**ביטוי** ולא לכלל,
   * ‏ונפל ברגע שהיכולת קיבלה שם. מה שהוא שומר עכשיו הוא הטענה
   * ‏שאי אפשר לבדוק בהרצה: **מופע אחד בדיוק** של שם היכולת, כלומר
   * ‏אין קורא שני שיכול לסטות. האכיפה עצמה נבדקת בהתנהגות
   * ‏(`task-entity-scope.test.ts`), ושם היא נהרגת כשמסירים אותה.
   */
  it("‏יכולת הגיוס מוצהרת פעם אחת, ואין ביטוי מילולי שני", () => {
    const service = strip(
      read("apps", "api", "src", "modules", "tasks", "tasks.service.ts"),
    );
    expect(service).toMatch(/const RECRUITMENT_CAPABILITY = "properties\.view";/u);
    expect(service.split('"properties.view"').length - 1).toBe(1);
    /* ‏ושני הקוראים אכן נשענים על השם */
    expect(service.split("RECRUITMENT_CAPABILITY").length - 1).toBe(3);
  });

  /*
   * ‎**ומחיקת שורת גיוס מנקה את הפולואפים שלה** (ביקורת Codex, P2).
   *
   * ‏אחרת הם נשארים ברשימה וביומן בלי תווית שאפשר לפתור, והעובד
   * ‏שולח את התזכורת — הוא בודק רק שהמשימה פתוחה ושהמועד הגיע.
   */
  it("‏מחיקת שורת גיוס מנקה את המשימות שלה, בזהירות מול היומן", () => {
    const service = strip(
      read("apps", "api", "src", "modules", "recruitment", "recruitment.service.ts"),
    );
    const start = service.indexOf("async remove(");
    expect(start).toBeGreaterThan(-1);
    const rest = service.slice(start);
    const end = rest.search(/\n {2}(?:async |private |\/\*\*)/u);
    const method = end === -1 ? rest : rest.slice(0, end);
    expect(method).toContain('entityType: "recruitment"');
    /* ‏עם אירוע ביומן — סימון והמתנה לסבב, ולא מחיקה */
    expect(method).toMatch(/googleEventId: \{ not: null \}[\s\S]{0,160}deletedAfterSync: true/u);
    /* ‏ובלעדיו — מחיקה */
    expect(method).toMatch(/deleteMany[\s\S]{0,120}googleEventId: null/u);
    /*
     * ‎**והנעילה לפני שתיהן** (ביקורת Codex, P2).
     *
     * ‏זהו סדר, ולא נוכחות: נעילה שנלקחת **אחרי** ניקוי הפולואפים
     * ‏אינה סוגרת דבר — היצירה כבר הספיקה לרוץ בין הקריאה שלה
     * ‏לכתיבה. אותו כלל שכתוב בראש `common/locks.ts`: הישות לפני
     * ‏כל נגזרת שלה.
     */
    const lockAt = method.indexOf("lockRecruitmentTarget(");
    expect(lockAt, "המחיקה אינה נועלת את השורה").toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(method.indexOf("tx.task."));
  });

  /*
   * ‎**ושני הצדדים לוקחים אותה** — נעילה שצד אחד בלבד לוקח אינה
   * ‏נועלת. הצד השני הוא היצירה ב-`TasksService`, והוא נבדק
   * ‏בהתנהגות ב-`task-entity-scope.test.ts`.
   */
  it("‏גם יצירת הפולואפ נועלת את אותה שורה", () => {
    const service = strip(
      read("apps", "api", "src", "modules", "tasks", "tasks.service.ts"),
    );
    expect(service).toContain("lockRecruitmentTarget(tx, tenantId, entityId)");
  });

  /*
   * ‎**והתזכורת עצמה אומרת על איזה נכס** (ביקורת Codex, P2).
   *
   * ‏העובד אסף רק נכס, קונה וליד, ולכן פולואפ גיוס הפיק
   * ‏‎`about: null` — „לחזור לבעלים” בלי כתובת, כלומר בדיוק המידע
   * ‏שבגללו שולחים אותה. הכתובת נבנית מ-`propertyAddressOr` ולא
   * ‏מנוסחה מקומית, כי אותה כתובת מוצגת גם בכרטיס ובמסך המשימות.
   */
  it("‏העובד מעשיר תזכורת גיוס בכתובת, ומגביל אותה ביכולת", () => {
    const worker = strip(
      read("apps", "workers", "src", "main.ts"),
    );
    /*
     * ‏על **הביטוי שמרכיב את `about`**, ולא על „המחרוזת מופיעה
     * ‏איפשהו בקובץ”: הניסוח הראשון חיפש
     * ‎`task.entityType === "recruitment"` בכל הקובץ, ומצא אותו
     * ‏בשורת `aboutNeeds` שמתחת — כלומר עבר גם כשהענף עצמו הוסר.
     */
    const aboutAt = worker.indexOf("const about =");
    expect(aboutAt, "ביטוי ה-about לא נמצא").toBeGreaterThan(-1);
    const about = worker.slice(aboutAt, worker.indexOf(";", aboutAt));
    expect(about).toContain("recruitmentAddressById");
    expect(worker).toContain("recruitmentIds.add(");
    expect(worker).toContain("tx.recruitmentTarget.findMany");
    expect(worker).toContain("propertyAddressOr(");
    /* ‏והפרט נושא את היכולת שנדרשת כדי לראות אותו */
    expect(worker).toMatch(/aboutNeeds:[\s\S]{0,120}"properties\.view"/u);
  });

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
