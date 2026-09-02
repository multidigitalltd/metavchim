import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * שולחן החיבורים נוגע **רק** בטבלאות שהוא אמור לגעת בהן.
 *
 * ההבטחה של השולחן הזה למשרד היא אחת: מנהל הפלטפורמה יכול לתקן את
 * חיבור המרכזייה בלי גישה ללידים, ללקוחות, לשיחות או לכסף. הבטחה
 * כזו אינה שווה דבר אם היא נשענת על כך שמי שיוסיף כאן פעולה בעוד
 * חצי שנה יזכור אותה — קריאה אחת ל-`tx.contact` בתוך פונקציה חדשה
 * תעבור typecheck, תעבור lint, ותרחיב את הגישה בלי שאיש יראה.
 *
 * לכן הגבול הוא **מבני**: הבדיקה קוראת את קובץ השירות ואת הקונטרולר
 * שלו, אוספת כל `tx.<model>` ו-`prisma.<model>` שנכתבו בהם, ומוודאת
 * שכולם ברשימה הלבנה. הוספת טבלה לרשימה היא שינוי גלוי בבדיקה —
 * כלומר החלטה, ולא תופעת לוואי.
 *
 * ## למה דווקא אלה מותרות
 *
 * - `integration` — **הטבלה שכל השולחן קיים בשבילה**: ספק, הגדרות
 *   שאינן סוד, מפתח ה-Webhook והאבחון. אין בה נתונים של לקוחות.
 * - `auditLog` ו-`notification` — התמורה לכך שאין הסכמה-מראש. שתיהן
 *   **כתיבה בלבד** אצל המשרד, וזה מה שהופך את הפעולה לגלויה לו.
 * - `tenant` — שם המשרד, כדי שהמסך יאמר על מי מדובר. מנהל הפלטפורמה
 *   רואה אותו ממילא ברשימת המשרדים.
 * - `user` — האימייל של מנהל הפלטפורמה הפועל, שנרשם ביומן של
 *   המשרד; ורשימת **הצוות** של המשרד (מזהה ושם של סוכנים פעילים
 *   בלבד), כדי שיהיה את מי לבחור בשיוך מספר. לא לקוחות.
 * - `virtualNumber` — המספר, שמו והסוכן שמקבל ממנו לידים. זו הגדרת
 *   ניתוב של המשרד, אותה שכבה כמו הספק ושם המשתמש שלו, ולא נתון
 *   של לקוח. בלעדיה משרד שכל סוכן בו מקבל מספר נפרד היה נשלח שוב
 *   לפתוח גישת תמיכה.
 *
 * מה שעדיין **אינו** כאן: `contact`, `lead`, `call`, `property`,
 * `message` וכל טבלת כסף. שיוך נכס למספר נשאר של המשרד.
 */

const DIR = import.meta.dirname;

const ALLOWED = new Set([
  "integration",
  "auditLog",
  "notification",
  "tenant",
  "user",
  "virtualNumber",
]);

/** כל `X.<name>` שבו `X` הוא `tx`, `prisma` או `this.prisma`. */
function modelsTouched(file: string): { name: string; line: number }[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const found: { name: string; line: number }[] = [];

  const isDbRoot = (node: ts.Expression): boolean => {
    if (ts.isIdentifier(node)) return node.text === "tx" || node.text === "prisma";
    if (ts.isPropertyAccessExpression(node)) {
      return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "prisma";
    }
    return false;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isDbRoot(node.expression)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push({ name: node.name.text, line: line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

describe("שולחן החיבורים — גבול הגישה", () => {
  const files = [
    join(DIR, "integration-desk.service.ts"),
    join(DIR, "integration-desk.controller.ts"),
  ];

  it("נוגע רק בטבלאות שברשימה הלבנה", () => {
    const outside = files.flatMap((file) =>
      modelsTouched(file)
        /*
         * `withExplicitTenant` וחבריו הם עוטפי הטרנזקציה של
         * `PrismaService` ולא מודלים — הם פותחים את ההקשר שבתוכו
         * נבדקות הטבלאות עצמן.
         */
        .filter(
          (hit) =>
            !ALLOWED.has(hit.name) && !hit.name.startsWith("$") && !/^with[A-Z]/u.test(hit.name),
        )
        .map((hit) => `${file.split("/").pop() ?? file}:${hit.line} → ${hit.name}`),
    );
    expect(outside, "טבלה מחוץ לרשימה הלבנה בשולחן החיבורים").toEqual([]);
  });

  /*
   * שתי צורות שמעקפות את הסריקה למעלה, ושתיהן היו מחזירות את
   * הגישה הרחבה בדלת האחורית: SQL גולמי שנכתב כמחרוזת, וסשן
   * שנוצר בשם משתמש של המשרד — כלומר בדיוק ה-`support-session`
   * שהשולחן הזה נבנה כדי שלא יהיה צריך אותו.
   */
  it("בלי SQL גולמי ובלי יצירת סשן", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, `${file}: SQL גולמי`).not.toMatch(/\$(?:query|execute)Raw/u);
      expect(text, `${file}: יצירת סשן`).not.toMatch(/session\.create|SESSION_COOKIE|res\.cookie/u);
    }
  });

  /*
   * הכתיבה אל המשרד עוברת ב-`withExplicitTenant` ולא ב-`withTenant`:
   * `withTenant` היה לוקח את הדייר מההקשר — כלומר את **הפלטפורמה** —
   * ומגיע לשורות של המשרד הלא נכון, או לאף שורה.
   */
  it("הגישה למשרד עוברת בהקשר דייר מפורש", () => {
    const service = readFileSync(join(DIR, "integration-desk.service.ts"), "utf8");
    expect(service).toContain("withExplicitTenant");
    expect(service).not.toMatch(/withTenant\(/u);
  });
});
