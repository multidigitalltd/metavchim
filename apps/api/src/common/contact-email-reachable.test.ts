import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * כתובת הדוא"ל של איש הקשר — שלוש השכבות חייבות להסכים.
 *
 * ## הכשל שהבדיקה הזאת מונעת
 *
 * ‎`BuyersService.createWithin` ידע לשמור כתובת מהיום הראשון, ייבוא
 * מקובץ וטופס דף הנחיתה שניהם העבירו אותה — ורק **הטופס שהסוכן
 * ממלא** לא שאל. התוצאה נראית למשתמש כמו „השדה לא נשמר”, אבל אין
 * שדה: קונה שהוקלד ידנית פשוט לא יכול היה לקבל הצעה במייל.
 *
 * ‎`.strict()` בסכימות הופך את הפער השני לרועש (400 ולא השמטה
 * שקטה) — אבל את הפער הראשון, טופס שאינו שואל, שום דבר לא תפס.
 *
 * ## למה קריאת מקור ולא בדיקת ריצה
 *
 * המסלול המלא עובר דפדפן, HTTP ומסד — ומה שנשבר כאן אינו לוגיקה
 * אלא **הרכבה**: שדה שלא נוסף, מפתח שלא נשלח, סכימה שלא מקבלת.
 * שלושתם גלויים בטקסט, ושלושתם נבדקים כאן יחד.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), "utf8");

/** בלי הערות — טענה שמתקיימת בזכות הסבר בעברית אינה טענה. */
const code = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/u.test(line))
    .join("\n");

const FORMS = [
  {
    what: "קונה",
    form: ["apps", "web", "src", "app", "buyers", "new", "page.tsx"],
    controller: ["apps", "api", "src", "modules", "buyers", "buyers.controller.ts"],
    schema: "CreateBuyerSchema",
  },
  {
    what: "ליד",
    form: ["apps", "web", "src", "app", "leads", "new", "page.tsx"],
    controller: ["apps", "api", "src", "modules", "leads", "leads.controller.ts"],
    schema: "CreateLeadSchema",
  },
] as const;

describe("כתובת איש הקשר מגיעה מהטופס עד המסד", () => {
  for (const entry of FORMS) {
    it(`טופס ה${entry.what} מציג שדה דוא"ל ושולח אותו`, () => {
      const form = code(read(...entry.form));
      expect(form, `אין קלט דוא"ל בטופס ה${entry.what}`).toMatch(
        /name="contactEmail"[\s\S]{0,400}type="email"|type="email"[\s\S]{0,400}name="contactEmail"/u,
      );
      expect(form, `הערך אינו נכנס לגוף הבקשה בטופס ה${entry.what}`).toMatch(
        /contactEmail:\s*String\(f\.get\("contactEmail"\)/u,
      );
    });

    it(`הסכימה של ה${entry.what} מקבלת contactEmail`, () => {
      const controller = code(read(...entry.controller));
      const start = controller.indexOf(`const ${entry.schema}`);
      expect(start, `לא נמצאה ${entry.schema}`).toBeGreaterThan(-1);
      const body = controller.slice(start, controller.indexOf(".strict()", start));
      expect(
        body,
        `${entry.schema} אינה מקבלת contactEmail — ‎.strict()‎ תדחה את הטופס ב-400`,
      ).toMatch(/contactEmail:\s*z\./u);
    });
  }

  it("השירותים מקבלים ושומרים את הכתובת", () => {
    const buyers = code(read("apps", "api", "src", "modules", "buyers", "buyers.service.ts"));
    const leads = code(read("apps", "api", "src", "modules", "leads", "leads.service.ts"));
    for (const [what, source] of [
      ["קונה", buyers],
      ["ליד", leads],
    ] as const) {
      expect(source, `שירות ה${what} אינו מקבל contactEmail`).toMatch(/contactEmail\?: string/u);
      expect(source, `שירות ה${what} אינו כותב את הכתובת`).toMatch(
        /setEmail\([^)]*input\.contactEmail/u,
      );
    }
  });
});
