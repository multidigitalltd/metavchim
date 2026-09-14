import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ‎**תוכן המנטור — שני היקפים בטבלה אחת, וזה בדיוק מה שצריך שער.**
 *
 * ‏הטבלה נושאת `tenant_id` נילי: `NULL` הוא תוכן של הפלטפורמה
 * ‏שמוצג בכל המשרדים, וערך הוא תוכן של משרד אחד. שני ההיקפים
 * ‏באותה טבלה נותנים למסך רשימה אחת — ובאותה נשימה יוצרים שתי
 * ‏דרכים להיכשל:
 *
 * 1. ‏משרד שמצליח **לכתוב** שורה עם `tenant_id` ריק — כלומר לפרסם
 *    ‏סרטון במסך של כל מתווך במערכת.
 * 2. ‏שולחן הפלטפורמה שרואה או נוגע בשורות של משרדים.
 *
 * ‏שתיהן שקטות: אף אחת מהן אינה שגיאה בזמן ריצה, ואף אחת מהן אינה
 * ‏נראית ב-diff שמוסיף פונקציה. לכן הבדיקה כאן קוראת את המיגרציה
 * ‏ואת השירות ודורשת שהמבנה יישאר כפי שנבנה.
 */

const DIR = import.meta.dirname;
const SERVICE = readFileSync(join(DIR, "mentor-content.service.ts"), "utf8");
const CONTROLLER = readFileSync(join(DIR, "mentor-content-platform.controller.ts"), "utf8");
const MIGRATION = readFileSync(
  join(DIR, "../../../prisma/migrations/20260914090000_mentor_content/migration.sql"),
  "utf8",
);

describe("מדיניות ה-RLS", () => {
  /*
   * ‎**זו הבדיקה שמצדיקה את הקובץ.** פוליסה בלי `FOR SELECT` היא
   * ‎`FOR ALL`, ופוליסה מתירה בלי `WITH CHECK` יורשת את `USING` גם
   * ‏לכתיבה — כלומר `tenant_id IS NULL` היה הופך מ„כל אחד רואה”
   * ‏ל„כל אחד כותב”. שינוי של שתי מילים, ואף בדיקה אחרת אינה
   * ‏מריצה SQL כדי לגלות אותו.
   */
  it("קריאת תוכן הפלטפורמה היא FOR SELECT ולא FOR ALL", () => {
    expect(MIGRATION).toMatch(
      /CREATE POLICY platform_content_read ON mentor_content\s+FOR SELECT USING \(tenant_id IS NULL\)/u,
    );
  });

  it("בידוד הדייר קיים על שני הצדדים", () => {
    const policy = MIGRATION.slice(MIGRATION.indexOf("CREATE POLICY tenant_isolation"));
    expect(policy).toContain("USING (tenant_id = current_setting('app.tenant_id', true))");
    expect(policy).toContain("WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  });

  /*
   * ‏גם ה-`USING` של השולחן מוגבל ל-`tenant_id IS NULL`, ולא רק
   * ה-`WITH CHECK`: בלעדיו מחיקה בשולחן הפלטפורמה יכולה להגיע
   * ‏לשורה של משרד.
   */
  it("שולחן הפלטפורמה אינו רואה שורות של משרדים", () => {
    const desk = MIGRATION.slice(MIGRATION.indexOf("CREATE POLICY platform_content_desk"));
    const both = desk.match(/tenant_id IS NULL/gu) ?? [];
    expect(both.length, "גם USING וגם WITH CHECK").toBe(2);
    expect(desk).toContain("current_setting('app.platform_content', true) = 'on'");
  });

  /* ‏הדגל נדלק במקום אחד בלבד, וזה מה שמחזיק את כל השאר */
  it("הדגל נדלק רק ב-withPlatformContent", () => {
    const prisma = readFileSync(join(DIR, "../../core/prisma.service.ts"), "utf8");
    const lit = prisma.match(/set_config\('app\.platform_content'/gu) ?? [];
    expect(lit.length).toBe(1);
  });
});

describe("מסלולי הכתיבה בשירות", () => {
  /*
   * ‎`create` של המשרד לוקח את המזהה מההקשר. שורה אחת שתכתוב
   * ‎`tenantId: null` כאן היא פרסום בכל המשרדים במערכת — והיא
   * ‏תיראה בדיוק כמו השורה של הפלטפורמה שמעליה בקובץ.
   */
  it("הכתיבה של המשרד אינה יכולה להיות nullית", () => {
    const create = SERVICE.slice(SERVICE.indexOf("async create("), SERVICE.indexOf("async remove("));
    expect(create).toContain("tenantId,");
    expect(create).not.toContain("tenantId: null");
    expect(create).not.toContain("withPlatformContent");
  });

  /*
   * ‏שורה של הפלטפורמה **גלויה** למשרד בקריאה, ולכן מחיקה לפי
   * ‏מזהה בלבד הייתה נחסמת ב-RLS ומגיעה כשגיאה שנראית כמו תקלה.
   * ‎`deleteMany` עם `tenantId` מפורש הופך את זה ל„לא נמצא”.
   */
  it("המחיקה של המשרד מוגבלת למזהה שלו", () => {
    const remove = SERVICE.slice(
      SERVICE.indexOf("async remove("),
      SERVICE.indexOf("/*  שולחן הפלטפורמה"),
    );
    expect(remove).toContain("deleteMany({ where: { id, tenantId } })");
    expect(remove).not.toContain("delete({");
  });

  /* ‏ושלושת מסלולי הפלטפורמה נוגעים רק בשורות בלי משרד */
  it("שולחן הפלטפורמה מסנן tenantId: null בכל פעולה", () => {
    const desk = SERVICE.slice(SERVICE.indexOf("async listPlatform("));
    for (const fn of ["listPlatform", "createPlatform", "removePlatform"]) {
      expect(desk, fn).toContain("withPlatformContent");
    }
    expect((desk.match(/tenantId: null/gu) ?? []).length).toBe(3);
    expect(desk).not.toContain("TenantContext");
  });
});

describe("השער על שולחן הפלטפורמה", () => {
  /*
   * ‏הבקר נפרד מבקר המנטור בדיוק כדי שהשער יהיה ברמת המחלקה: נתיב
   * ‏שיתווסף כאן חסום כברירת מחדל ולא „אם זכרו”.
   */
  it("הבקר חסום ברמת המחלקה", () => {
    const head = CONTROLLER.slice(CONTROLLER.indexOf('@Controller("platform")'));
    expect(head).toContain("@UseGuards(PlatformAdminGuard)");
    expect(head).toContain("@PlatformAdmin()");
  });

  /* ‏ואין בו אף פעולה שאינה על שולחן הפלטפורמה */
  it("כל פעולה בבקר פונה למסלול הפלטפורמה", () => {
    const calls = CONTROLLER.match(/this\.content\.(\w+)/gu) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatch(/Platform$/u);
  });
});
