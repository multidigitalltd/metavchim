import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * ‎**שורה שנולדה מתמונה זהה לשורה שנולדה מטופס.**
 *
 * ## ‏מה זה מבטיח
 *
 * ‏מודעה מצולמת פותחת נכס לגיוס. הדרך הקצרה לכתוב אותה הייתה
 * ‎`tx.recruitmentTarget.create` ישירות מהשירות החדש — וזה היה
 * ‏עובד, ועובר typecheck, ומייצר שורות שנראות תקינות ומתנהגות
 * ‏אחרת: בלי הוולידציה של `create`, בלי `createdBy`, ובלי
 * ‏ההכרעות שהצטברו שם (סטטוס פתיחה, בדיקת קישור המקור).
 *
 * ‏ההבדל מתגלה חודשיים אחר כך, כשמישהו מתקן משהו ב-`create`
 * ‏ומגלה שחצי מהשורות לא עברו שם מעולם.
 *
 * ## ‏והתמונה עצמה
 *
 * ‏אינה נשמרת. מה שנשמר הוא מה שנקרא ממנה. שמירת מדיה פותחת
 * ‏מכסות, מחיקה ו-GDPR על יכולת שכל תכליתה לחסוך הקלדה — ואת
 * ‏התמונה המקורית המתווך מחזיק בגלריה שלו ממילא.
 */

const FILE = new URL("./recruitment-ad.service.ts", import.meta.url).pathname;
const source = readFileSync(FILE, "utf8");

/** ‏כל `X.<name>` שבו `X` הוא `tx`, `prisma` או `this.prisma`. */
function modelsTouched(): string[] {
  const file = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2023, true);
  const found: string[] = [];
  const isDbRoot = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return node.text === "tx" || node.text === "prisma";
    if (ts.isPropertyAccessExpression(node)) {
      return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "prisma";
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isDbRoot(node.expression)) {
      found.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return found;
}

describe("מודעה מצולמת — דרך הכתיבה", () => {
  /*
   * ‎**הטענה המרכזית.** השירות אינו נוגע במסד בכלל: הוא קורא
   * למודל, מפענח, ומעביר ל-`RecruitmentService.create`.
   */
  it("אינו כותב למסד בעצמו", () => {
    expect(modelsTouched(), "מסלול כתיבה שני לטבלת הגיוס").toEqual([]);
  });

  it("עובר במסלול היחיד שכותב שורת גיוס", () => {
    expect(source).toContain("this.recruitment.create(");
  });

  /*
   * ‏שמירת התמונה הייתה החלטה בפני עצמה — מכסות, מחיקה, תקופת
   * ‏שמירה — ולא תופעת לוואי של „כבר יש לנו את הקובץ ביד”.
   */
  it("אינו שומר את התמונה", () => {
    expect(source).not.toMatch(/storage|upload|putObject|s3/iu);
  });
});

describe("מודעה מצולמת — הסוכן בוואטסאפ", () => {
  const assistant = readFileSync(
    new URL("../messaging/whatsapp-assistant.service.ts", import.meta.url).pathname,
    "utf8",
  );

  /*
   * ‎**הכתיבה חייבת לרוץ בתוך הקשר הדייר.**
   *
   * ‏`extractText` רצה **לפני** ה-`TenantContext.run` שעוטף את
   * ‏השיחה, ולכן `RecruitmentService.create` — שקורא ל-
   * ‏`TenantContext.current()` — היה נכשל שם. ההקשר מועבר
   * ‏במפורש, וזה מה שהבדיקה הזו שומרת: מי שיפשט את החתימה
   * ‏„כי ממילא יש הקשר” ישבור בדיוק את זה.
   */
  it("קריאת המודעה רצה בתוך הקשר הדייר", () => {
    expect(assistant).toMatch(/TenantContext\.run\(context, \(\) => this\.ads\.fromImage\(media\)\)/u);
  });

  /*
   * ‏תמונה שהמודל לא קרא, מודל שאינו מוגדר, מדיה שלא ירדה —
   * ‏כולם חוזרים כמשפט. „משהו השתבש אצלי” על שלט מצולם הוא
   * ‏בדיוק הרגע שבו מתווך מפסיק לנסות את היכולת.
   */
  it("כשל חוזר כמשפט ולא כחריגה", () => {
    const body = /private async adFromImage\([\s\S]*?\n {2}\}/u.exec(assistant)?.[0] ?? "";
    expect(body, "לא נמצאה adFromImage").not.toBe("");
    expect(body).toContain("catch");
    expect(body).not.toMatch(/\bthrow\b/u);
  });
});
