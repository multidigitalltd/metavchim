import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_KIND_CAPABILITY, WHATSAPP_IMPORT_KINDS } from "@metavchim/shared";

/**
 * ‎**ייבוא מהוואטסאפ — אותה יכולת, אותו מסלול כתיבה.**
 *
 * ## ‏למה זה שער ולא בדיקת התנהגות
 *
 * ‏הסוכן **אינו עובר בבקרים**. `@RequireCapability("buyers.edit")`
 * ‏יושב על הנתיב, והמסלול הזה אינו הנתיב — כלומר בלי בדיקה משלו
 * ‏כל מי שיש לו סוכן בוואטסאפ היה יכול לייבא מאה קונים, גם סוכן
 * ‏שאין לו הרשאת עריכה כלל. זו אותה משפחה של תקלה שכבר נתפסה
 * ‏ב-`add_agent` (הסלמת הרשאות דרך `/agent/execute`).
 *
 * ‏ובאותה נשימה: הכתיבה חייבת לעבור ב-`ImportWriteService` ולא
 * ‏להיכתב מחדש. עותק שני היה מדלג על איחוד לידים לפי טלפון, על
 * ‎`typedBy: "agent"`, ועל הורדת שדה פסול במקום השורה — שלושה
 * ‏כללים שאיש לא היה מרגיש בהיעדרם עד שמישהו יחפש לקוח.
 */

const dir = new URL(".", import.meta.url).pathname;
const service = readFileSync(`${dir}whatsapp-import.service.ts`, "utf8");
const assistant = readFileSync(`${dir}whatsapp-assistant.service.ts`, "utf8");
const controller = readFileSync(
  `${dir}../import/import.controller.ts`,
  "utf8",
);

describe("היכולת נבדקת במסלול הוואטסאפ", () => {
  /*
   * ‎**שתי נקודות, במכוון.** בתצוגה המקדימה — כדי שלא נוריד קובץ
   * ‏ונספור 400 שורות למי שאינו יכול לייבא; ובכתיבה — כי היא
   * ‏הנקודה שבה זה באמת קובע, וכי ההרשאה יכולה להישלל בין השתיים.
   */
  it("גם לפני הקריאה וגם לפני הכתיבה", () => {
    expect(assistant, "התצוגה המקדימה אינה בודקת יכולת").toContain(
      "IMPORT_KIND_CAPABILITY[kind]",
    );
    expect(service, "הכתיבה אינה בודקת יכולת").toContain("IMPORT_KIND_CAPABILITY[kind]");
  });

  /*
   * ‎`TenantContext.current()` ולא רשומת המשתמש: זה **אותו** מקור
   * ‏שהבקרים נבדקים מולו, ולכן הרשאה שנשללה משפיעה מיד.
   */
  it("מההקשר, ולא מרשומה שנטענה", () => {
    expect(service).toMatch(/context\.capabilities\.has\(/u);
  });

  /*
   * ‎**הטבלה מול הבקר.** הערך כאן והערך שהנתיב דורש הם אותה
   * ‏החלטה; שתי רשימות היו מסכימות ביום שנכתבו.
   */
  it.each(WHATSAPP_IMPORT_KINDS)("היכולת של %s זהה לזו שהנתיב דורש", (kind) => {
    const route = kind === "recruitment" ? "recruitment" : kind === "buyers" ? "buyers" : "leads";
    const at = controller.indexOf(`@Post("${route}")`);
    expect(at, `הנתיב ${route} לא נמצא`).toBeGreaterThan(-1);
    const decorator = controller.slice(at, at + 200);
    expect(decorator, `${kind}: הקטלוג אומר ${IMPORT_KIND_CAPABILITY[kind]}`).toContain(
      `@RequireCapability("${IMPORT_KIND_CAPABILITY[kind]}")`,
    );
  });
});

describe("הכתיבה עוברת במסלול אחד", () => {
  it("דרך ImportWriteService, ולא בשירותי היעד ישירות", () => {
    expect(service).toContain("ImportWriteService");
    for (const forbidden of ["BuyersService", "LeadsService", "RecruitmentService"]) {
      expect(service, `${forbidden} — מסלול כתיבה שני`).not.toContain(forbidden);
    }
  });

  /*
   * ‎**נכסים אינם סוג, וזו החלטה.** קובץ נכסים נכנס למאגר שממנו
   * ‏יוצאות הצעות לקונים; המסך נותן לו מיפוי עמודות ותצוגה מקדימה
   * ‏של כל שורה, ו„כן” על טלפון קטן אינו תחליף.
   */
  it("ואינה יכולה להגיע לייבוא נכסים", () => {
    expect(service).not.toContain("propertyRows");
    expect(service).not.toContain("PropertiesService");
  });

  /* ‏אותה תקרה של הנתיב — 500 שורות במעטפת */
  it("ותקרת השורות זהה לזו של הנתיב", () => {
    const envelope = /rows: z\.array\([\s\S]{0,80}?\.max\((\d+)\)/u.exec(controller)?.[1];
    expect(envelope, "לא נמצאה התקרה בנתיב").toBeDefined();
    expect(service, `הנתיב חוסם ב-${envelope ?? "?"}`).toContain(`.slice(0, ${envelope ?? ""})`);
  });
});

describe("אף שורה אינה נכתבת לפני אישור", () => {
  /*
   * ‏שלושה צעדים: קובץ ⟵ „מה יש בו?” ⟵ תצוגה מקדימה ⟵ „אשר”.
   * ‏רק האחרון כותב, ורק הוא צורך את ההצעה הממתינה אטומית.
   */
  it("הקריאה והכתיבה הן שתי מתודות", () => {
    expect(service).toMatch(/async read\(/u);
    expect(service).toMatch(/async write_\(/u);
  });

  it("והתצוגה המקדימה אינה קוראת לכתיבה", () => {
    const start = assistant.indexOf("private async importPreview(");
    expect(start).toBeGreaterThan(-1);
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    expect(body).toContain("this.imports.read(");
    expect(body, "התצוגה המקדימה כותבת").not.toContain("this.imports.write_(");
  });

  it("והאישור צורך את ההצעה לפני שהוא כותב", () => {
    const start = assistant.indexOf("private async importConfirm(");
    expect(start).toBeGreaterThan(-1);
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    expect(body.indexOf("takePending")).toBeGreaterThan(-1);
    expect(body.indexOf("takePending")).toBeLessThan(body.indexOf("this.imports.write_("));
  });
});
