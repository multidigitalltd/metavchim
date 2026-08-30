import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ‎**מחיקת נכסים מרוכזת — כמו בקונים, על כל הלקחים שלה.**
 *
 * מסך הנכסים כבר ידע לבחור כמה שורות, ומה שאפשר היה לעשות איתן היה
 * פרסום לרשת בלבד. הבקשה היא מחיקה מרוכזת „כמו שיש בקונים”, ולכן
 * הבדיקות כאן נכתבו על **מה שנשבר שם** — כל אחת מהן מכסה ליקוי
 * שנמצא במסלול הקונים ולא היה נמצא שוב מעצמו.
 */

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

const SERVICE = read("./properties.service.ts");
const CONTROLLER = read("./properties.controller.ts");
const OWNERSHIP = read("../../common/ownership.ts");
const LIST = read("../../../../web/src/app/properties/page.tsx");

describe("מחיקת נכסים מרוכזת", () => {
  /*
   * ‎**ההחרגה היא של כל הבחירה, ולא של נכס אחד.**
   *
   * בעלים ששני הנכסים שלו נבחרו נמחק כשהאחרון יורד, והחרגה בודדת
   * הייתה עונה עליו „יישאר” — כלומר התצוגה שלפני האישור מבטיחה
   * פחות ממה שקורה בפועל. אותה תקלה בדיוק (P1) נמצאה במחיקת
   * הקונים המרוכזת, ושם התיקון היה `buyerIds`.
   */
  it("התצוגה המקדימה מחריגה את כל הנכסים שנבחרו", () => {
    expect(OWNERSHIP).toContain("propertyIds?: readonly string[];");
    expect(OWNERSHIP).toContain("const exceptProperties = [");
    expect(OWNERSHIP).toContain(
      "...(exceptProperties.length === 0 ? {} : { id: { notIn: exceptProperties } }),",
    );
    expect(SERVICE).toMatch(/isOrphanContact\(tx, tenantId, contactId, \{ propertyIds \}\)/u);
  });

  /*
   * ‎**התצוגה המקדימה מכסה כל מה שהמחיקה יכולה למחוק.**
   *
   * המחיקה המרוכזת מוחקת גם נכס שכבר בארכיון — היא מארכבת,
   * מתעלמת מכישלון, ומוחקת. סינון `deletedAt: null` בתצוגה
   * המקדימה היה משמיט נכס שאורכב בלשונית אחרת בין הטעינה לאישור,
   * והאישור היה מודיע „לא יימחקו כרטיסים” בזמן שכרטיסי הבעלים שלו
   * נמחקים (ביקורת Codex, P1). המסלול הבודד מעולם לא סינן כך.
   */
  it("התצוגה המקדימה כוללת גם נכס שכבר בארכיון", () => {
    // ההערות מוסרות: ההסבר עצמו מצטט את המסנן שאסור שיהיה בקוד
    const fn = SERVICE.slice(
      SERVICE.indexOf("async bulkDeletionPreview("),
      SERVICE.indexOf("async removeMany("),
    ).replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(fn).toContain("where: { id: { in: [...ids] }, tenantId },");
    expect(fn, "סינון פעילים משמיט נכסים שהמחיקה כן מוחקת").not.toContain("deletedAt: null");
  });

  /*
   * ‎**המחיקה לצמיתות עוברת דרך הארכיון ולא במקומו.**
   *
   * ‎`purge` דורש נכס שכבר בארכיון, והרשימה מציגה פעילים — ולכן
   * קריאה ישירה הייתה נדחית על כל אחד מהם ומדווחת אפס מחיקות בלי
   * שום הסבר.
   */
  it("מחיקה לצמיתות מארכבת קודם", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("async removeMany("), SERVICE.indexOf("async purge("));
    expect(fn).toMatch(/softDelete\(id\)\.catch\(\(\) => undefined\)[\s\S]{0,80}purge\(id\)/u);
  });

  /* נכס של עמית או כזה שכבר נמחק נספר כדולג, ואינו מפיל את השאר */
  it("כישלון בודד אינו מפיל את הקבוצה", () => {
    const fn = SERVICE.slice(SERVICE.indexOf("async removeMany("), SERVICE.indexOf("async purge("));
    expect(fn).toContain("skipped += 1");
    expect(fn).toContain("removed += 1");
  });

  /* אותה הרשאה כמו המחיקה הבודדת — הכמות אינה משנה מי רשאי */
  it("שני הנתיבים דורשים את הרשאת המחיקה", () => {
    const bulk = CONTROLLER.slice(
      CONTROLLER.indexOf('@Post("bulk-deletion-preview")'),
      CONTROLLER.indexOf('@Delete(":id")'),
    );
    expect((bulk.match(/@RequireCapability\("properties\.delete"\)/gu) ?? []).length).toBe(2);
  });

  /* תקרה מפורשת — בקשה אחת אינה מוחקת מאגר שלם */
  it("הבקשה חסומה בתקרה", () => {
    expect(CONTROLLER).toContain("ids: z.array(IdSchema).min(1).max(500)");
  });

  /*
   * ‎**„לא ידוע” חוסם — אינו מבטיח ואינו מוחק.** כשל בבדיקה מחזיר
   * שגיאה ועוצר, במקום להציג אישור בלי גילוי.
   */
  it("כשל בבדיקה עוצר את המחיקה", () => {
    const fn = LIST.slice(LIST.indexOf("async function removeSelected("), LIST.indexOf("const filtering ="));
    expect(fn).toMatch(/catch \{[\s\S]{0,120}בדיקת המחיקה נכשלה[\s\S]{0,80}return;/u);
  });

  /*
   * ‎**הבחירה שייכת לשתי היכולות.** תיבות הסימון היו מותנות
   * ביכולת השיתוף בלבד, ולכן מי שרשאי למחוק ואינו רשאי לפרסם לא
   * ראה תיבות כלל — המחיקה המרוכזת הייתה קיימת בשרת ובלתי נגישה.
   */
  it("תיבות הסימון מוצגות גם למי שרשאי רק למחוק", () => {
    expect(LIST).toContain('const mayDelete = can(user, "properties.delete");');
    expect(LIST).toContain("const maySelect = mayShare || mayDelete;");
    expect(LIST).not.toMatch(/\{mayShare \? \(\s*<input/u);
  });

  /*
   * ‎**הרענון בנפרד מהמחיקה.** כישלון רענון בתוך אותו `try` היה
   * מדווח „המחיקה נכשלה” על מחיקה שהצליחה, ומזמין למחוק שוב.
   */
  it("כישלון רענון אינו מדווח ככישלון מחיקה", () => {
    const fn = LIST.slice(LIST.indexOf("async function removeSelected("), LIST.indexOf("const filtering ="));
    expect(fn).toContain("הרשימה לא רועננה");
  });
});
