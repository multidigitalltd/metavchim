import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * כל ייבוא בקוד שנפרס חייב להיות תלות מוצהרת — ותלות **ריצה**.
 *
 * ה-API קרס בלולאה בפרודקשן עם 502 לכל המערכת מפני שקוד קליטת המייל
 * ייבא `express` ישירות והתלות לא הוצהרה. בעץ הפיתוח היא נמצאה
 * בעקיפין דרך NestJS, ולכן `lint`, `typecheck`, `test` ו-`build`
 * כולם עברו ירוק. תמונת הפרודקשן נבנית עם `pnpm deploy --prod`,
 * שגוזם כל מה שלא הוצהר — ושם היא פשוט לא הייתה.
 *
 * מכאן שני כללים, ושניהם נבדקים כאן:
 *
 * 1. **מוצהרת.** כל מפרט חבילה בקוד המקור נמצא ב-package.json של
 *    אותו workspace. ייבוא עקיף שנפתר במקרה דרך תלות של מישהו אחר
 *    הוא הישענות על עץ שאיננו שולטים בו.
 *
 * 2. **בתלויות הריצה.** `pnpm deploy --prod` גוזם גם devDependencies,
 *    ולכן ייבוא **ערך** (להבדיל מ-`import type`, שנמחק בקומפילציה)
 *    מתוך devDependency יקרוס בפרודקשן בדיוק כמו ייבוא לא מוצהר.
 *    קובצי בדיקה פטורים מהכלל השני — הם אינם נפרסים.
 *
 * הבדיקה קוראת AST ולא רג'קס: `require(...)`, `import(...)` דינמי,
 * `export ... from` וייבוא-לוואי (`import "x"`) נספרים כמו ייבוא רגיל.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

/** ה-workspaces שנארזים לתמונת הריצה. web נבנה ב-bundle ואינו כאן. */
const DEPLOYED = ["apps/api", "apps/workers", "packages/shared"] as const;

const NODE_BUILTINS = new Set([
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
]);

type Usage = { readonly pkg: string; readonly file: string; readonly runtime: boolean };

type Manifest = {
  readonly dependencies: ReadonlySet<string>;
  readonly declared: ReadonlySet<string>;
};

function manifest(workspace: string): Manifest {
  const raw: unknown = JSON.parse(readFileSync(join(REPO_ROOT, workspace, "package.json"), "utf8"));
  const pkg = raw as Record<string, Record<string, string> | undefined>;
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  return {
    dependencies,
    declared: new Set([
      ...dependencies,
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]),
  };
}

function sourceFiles(workspace: string): string[] {
  const dir = join(REPO_ROOT, workspace, "src");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => join(dir, name));
}

/**
 * שם החבילה מתוך המפרט: `@scope/name/sub` → `@scope/name`,
 * `name/sub` → `name`. נתיבים יחסיים ומובנים של node מסוננים.
 */
function packageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  return NODE_BUILTINS.has(name) ? null : name;
}

/** האם הייבוא שורד את הקומפילציה. `import type` נמחק ולכן לא. */
function isRuntimeImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return true; // import "x" — ייבוא לוואי
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  if (clause.name || !bindings || !ts.isNamedImports(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function usages(file: string): Usage[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relative = file.slice(REPO_ROOT.length + 1);
  const found: Usage[] = [];

  const record = (specifier: string | undefined, runtime: boolean): void => {
    if (specifier === undefined) return;
    const pkg = packageName(specifier);
    if (pkg) found.push({ pkg, file: relative, runtime });
  };

  const literal = (node: ts.Node | undefined): string | undefined =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      record(literal(node.moduleSpecifier), isRuntimeImport(node));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record(literal(node.moduleSpecifier), !node.isTypeOnly);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isRequire || callee.kind === ts.SyntaxKind.ImportKeyword) {
        record(literal(node.arguments[0]), true);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("תלויות מוצהרות בקוד שנפרס", () => {
  for (const workspace of DEPLOYED) {
    const { declared, dependencies } = manifest(workspace);
    const all = sourceFiles(workspace).flatMap(usages);

    it(`${workspace}: כל ייבוא מוצהר ב-package.json`, () => {
      const undeclared = all
        .filter((use) => !declared.has(use.pkg))
        .map((use) => `${use.file} → ${use.pkg}`);
      expect([...new Set(undeclared)].sort()).toEqual([]);
    });

    it(`${workspace}: ייבוא ערך בקוד הנפרס הוא תלות ריצה`, () => {
      const pruned = all
        .filter((use) => use.runtime && !use.file.endsWith(".test.ts"))
        .filter((use) => declared.has(use.pkg) && !dependencies.has(use.pkg))
        .map((use) => `${use.file} → ${use.pkg}`);
      expect([...new Set(pruned)].sort()).toEqual([]);
    });
  }

  it("הבדיקה אכן קוראת ייבוא — ולא עוברת על קובץ ריק", () => {
    const seen = new Set(sourceFiles("apps/api").flatMap(usages).map((use) => use.pkg));
    expect(seen.has("@nestjs/common")).toBe(true);
    expect(seen.has("express")).toBe(true);
  });
});
