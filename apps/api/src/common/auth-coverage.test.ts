import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * כל נתיב HTTP חייב להצהיר במפורש מי רשאי להגיע אליו.
 *
 * ה-AuthGuard כבר דורש Session מכל נתיב שאינו @Public, ולכן נתיב
 * שנשכח ממנו @RequireCapability עדיין *עובד* — הוא פשוט פתוח לכל
 * מי שמחובר למשרד. כך נולד `GET /contacts/:id/related` בלי שער,
 * וכך היה גם `GET /analytics/office` מאחורי יכולת שיש ל-viewer.
 *
 * הבדיקה קוראת את קוד הבקרים ב-AST (לא ברג'קס) ומוודאת שלכל נתיב
 * יש בדיוק אחת מארבע ההצהרות. "פתוח לכל מחובר" הוא החלטה לגיטימית —
 * אבל היא חייבת להיכתב, לא להישכח. נתיב חדש בלי שער מפיל את ה-CI.
 */

const GATES = ["Public", "RequireCapability", "AnyAuthenticated", "PlatformAdmin"] as const;
const HTTP_METHODS = new Set(["Get", "Post", "Patch", "Put", "Delete", "Head", "Options", "All"]);

const MODULES_DIR = join(import.meta.dirname, "..", "modules");

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".controller.ts"))
    .map((name) => join(dir, name));
}

/** שמות הדקורטורים על הצומת, למשל ["Get", "RequireCapability"]. */
function decoratorNames(node: ts.Node): string[] {
  return (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [])
    .map((d) => (ts.isCallExpression(d.expression) ? d.expression.expression : d.expression))
    .filter(ts.isIdentifier)
    .map((id) => id.text);
}

interface Route {
  file: string;
  controller: string;
  handler: string;
  gates: string[];
}

function routesIn(file: string): Route[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2023,
    /* setParentNodes */ true,
  );
  const routes: Route[] = [];

  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const classDecorators = decoratorNames(statement);
    if (!classDecorators.includes("Controller")) continue;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const methodDecorators = decoratorNames(member);
      if (!methodDecorators.some((name) => HTTP_METHODS.has(name))) continue;

      // שער ברמת המחלקה תקף לכל נתיביה (כך עובד Reflector.getAllAndOverride)
      const gates = [...methodDecorators, ...classDecorators].filter((name) =>
        (GATES as readonly string[]).includes(name),
      );
      routes.push({
        file: file.slice(file.lastIndexOf("/modules/") + 1),
        controller: statement.name?.text ?? "?",
        handler: member.name.getText(source),
        gates,
      });
    }
  }
  return routes;
}

describe("כיסוי הרשאות על נתיבי ה-API", () => {
  const routes = controllerFiles(MODULES_DIR).flatMap(routesIn);

  it("נמצאו בקרים ונתיבים לסריקה", () => {
    // רשת ביטחון לבדיקה עצמה: שינוי מבנה תיקיות שמאפס את הסריקה היה
    // הופך אותה ל"עוברת תמיד" בלי שאיש ישים לב
    expect(routes.length).toBeGreaterThan(50);
  });

  it("לכל נתיב יש הצהרת גישה מפורשת", () => {
    const ungated = routes
      .filter((route) => route.gates.length === 0)
      .map((route) => `${route.file} → ${route.controller}.${route.handler}`);

    expect(
      ungated,
      `הנתיבים הבאים אינם מצהירים מי רשאי להגיע אליהם. הוסיפו @RequireCapability ` +
        `אם נדרשת יכולת, @Public אם אין צורך בהתחברות, או @AnyAuthenticated ` +
        `אם הנתיב פתוח בכוונה לכל משתמש מחובר:\n${ungated.join("\n")}`,
    ).toEqual([]);
  });

  it("נתיב ציבורי אינו נושא גם דרישת יכולת", () => {
    // צירוף כזה הוא סתירה: ה-AuthGuard מחזיר true על @Public לפני
    // שהוא מגיע לבדיקת היכולת, ולכן היכולת לא נאכפת — והקוד נראה מוגן
    const contradictory = routes
      .filter((route) => route.gates.includes("Public") && route.gates.length > 1)
      .map((route) => `${route.controller}.${route.handler}: ${route.gates.join(" + ")}`);

    expect(contradictory).toEqual([]);
  });

  it("כל נתיבי ניהול הפלטפורמה מוגנים בשער מנהל הפלטפורמה", () => {
    const platform = routes.filter((route) => route.file.includes("/platform/platform."));
    expect(platform.length).toBeGreaterThan(0);
    for (const route of platform) {
      expect(route.gates, `${route.controller}.${route.handler}`).toContain("PlatformAdmin");
    }
  });
});
