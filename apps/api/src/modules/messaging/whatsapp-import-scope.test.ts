import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMPORT_FEATURE,
  IMPORT_KIND_CAPABILITY,
  IMPORT_ROW_LIMIT,
  WHATSAPP_IMPORT_KINDS,
} from "@metavchim/shared";

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
    expect(assistant, "התצוגה המקדימה אינה בודקת").toContain("this.imports.blockedReason(");
    const write = service.slice(service.indexOf("async write_("));
    expect(write, "הכתיבה אינה בודקת").toContain("this.blockedReason(");
  });

  /*
   * ‎**שני הכללים במקום אחד, ולא שני עותקים.**
   *
   * ‏כשהתצוגה המקדימה בדקה יכולת בעצמה והכתיבה בדקה יכולת בעצמה,
   * ‏שתיהן פספסו את שער הפיצ'ר — אף אחת לא הייתה „המקום” שבו
   * ‏הכללים נמצאים, ולכן אף אחת לא הייתה המקום שבו חסר כלל
   * ‏(ביקורת Codex). `blockedReason` הוא המקום הזה.
   */
  it("ואין עותק שני של הכללים בתצוגה המקדימה", () => {
    const start = assistant.indexOf("private async importPreview(");
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    expect(body, "התצוגה המקדימה בודקת יכולת בעצמה").not.toContain("IMPORT_KIND_CAPABILITY");
    expect(body, "התצוגה המקדימה בודקת פיצ'ר בעצמה").not.toContain("tenantHasFeature");
  });

  /*
   * ‎`context.capabilities` ולא רשומת המשתמש: זה **אותו** מקור
   * ‏שהבקרים נבדקים מולו, ולכן הרשאה שנשללה משפיעה מיד.
   */
  it("מההקשר, ולא מרשומה שנטענה", () => {
    expect(service).toMatch(/context\.capabilities\.has\(/u);
  });

  /*
   * ‎**הפיצ'ר, ולא היכולת בלבד.**
   *
   * ‏המסלול הבסיסי כולל `voice_intake` ואינו כולל `data_io`, ולכן
   * ‏משרד שקנה וואטסאפ בלבד ייבא דרך הצ'אט בדיוק את מה שמסך
   * ‏הייבוא חוסם לו — יכולת עריכה יש לכל סוכן. `@RequireFeature`
   * ‏על הבקר אינו מגן על מסלול שאינו עובר בבקר.
   */
  it("ופיצ'ר המסלול נבדק, כמו שהבקר דורש אותו", () => {
    expect(service, "מסלול הוואטסאפ אינו בודק את הפיצ'ר").toContain("tenantHasFeature");
    expect(service).toContain("IMPORT_FEATURE");
    expect(controller, `הבקר דורש פיצ'ר אחר`).toContain(
      `@RequireFeature("${IMPORT_FEATURE}")`,
    );
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

  /*
   * ‎**תקרה אחת לשני המסלולים — מהקטלוג, ולא מספר בכל קובץ.**
   *
   * ‏קודם כאן נקרא המספר מהמעטפת של הנתיב והושווה למחרוזת בשירות.
   * ‏זה עבד, אבל השאיר שני מקומות לערוך; עכשיו שניהם קוראים את
   * ‎`IMPORT_ROW_LIMIT`, והבדיקה היא שאיש לא החזיר מספר קשיח.
   */
  it("ותקרת השורות היא אותו קבוע בשני הצדדים", () => {
    expect(service, "השירות חותך במספר קשיח").toContain(".slice(0, IMPORT_ROW_LIMIT)");
    const at = controller.indexOf("const ImportEnvelopeSchema");
    expect(at, "המעטפת לא נמצאה").toBeGreaterThan(-1);
    const envelope = controller.slice(at, controller.indexOf(".strict();", at));
    expect(envelope, "המעטפת חוסמת במספר קשיח").toContain(".max(IMPORT_ROW_LIMIT)");
    expect(envelope).not.toMatch(/\.max\(\d+\)/u);
    expect(IMPORT_ROW_LIMIT).toBeGreaterThan(0);
  });

  /*
   * ‎**מה שנחתך — נאמר לפני האישור.**
   *
   * ‏קובץ של 900 שורות הציג „קראתי 500 שורות”, המתווך אישר ייבוא
   * ‏שנראה שלם, ו-400 לקוחות לא נכנסו בלי שאיש ידע. הספירה
   * ‏המקורית חייבת לשרוד את החיתוך ולהגיע לתצוגה המקדימה
   * ‏(ביקורת Codex).
   */
  it("והספירה המקורית שורדת את החיתוך", () => {
    expect(service, "הקריאה אינה מחזירה את הספירה המקורית").toContain(
      "total: parsed.rows.length",
    );
    const start = assistant.indexOf("private async importPreview(");
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    expect(body, "התצוגה המקדימה אינה מקבלת את הספירה").toContain("total: read.total");
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

  /*
   * ‎**וקובץ שנכנס מבטל את ההצעה הקודמת — גם כשאינו נקרא.**
   *
   * ‏מתווך ששלח PDF על „לפתוח כרטיס קונה? אשר/בטל” קיבל „אני
   * ‏קוראת ‎.xlsx‎ בלבד”, הבין שהשיחה עברה לקובץ, ו„אשר” שלו כעבור
   * ‏דקה פתח את הכרטיס הישן. הצריכה קודמת לכל יציאה מוקדמת
   * ‏(ביקורת Codex).
   */
  it("וקובץ שנכנס צורך את ההצעה לפני כל בדיקה", () => {
    const start = assistant.indexOf("private async documentArrived(");
    expect(start).toBeGreaterThan(-1);
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    const consume = body.indexOf("takePending");
    expect(consume).toBeGreaterThan(-1);
    for (const early of ["msg.mediaId === undefined", "=== \"unsupported\""]) {
      expect(body.indexOf(early), `${early} קודם לצריכה`).toBeGreaterThan(consume);
    }
  });

  it("והאישור צורך את ההצעה לפני שהוא כותב", () => {
    const start = assistant.indexOf("private async importConfirm(");
    expect(start).toBeGreaterThan(-1);
    const body = assistant.slice(start, assistant.indexOf("\n  }\n", start));
    expect(body.indexOf("takePending")).toBeGreaterThan(-1);
    expect(body.indexOf("takePending")).toBeLessThan(body.indexOf("this.imports.write_("));
  });
});
