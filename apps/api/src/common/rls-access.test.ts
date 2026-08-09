import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * טבלה תחת RLS נקראת **רק** דרך טרנזקציה עם הקשר דייר.
 *
 * זו התקלה שחזרה יותר מכל אחרת במערכת הזו, וגם שרדה פעם אחת ביקורת
 * שכוונה אליה במפורש. הצורה שלה תמיד זהה: מישהו כותב
 * `this.prisma.property.findMany(...)` במקום `tx.property.findMany(...)`
 * בתוך `withTenant`. הקוד מתקמפל, הבדיקות עוברות, והשאילתה **מחזירה
 * אפס שורות בשקט** — כי `FORCE ROW LEVEL SECURITY` בלי
 * `app.tenant_id` מסנן הכול.
 *
 * זה הכי גרוע שאפשר: אין חריגה, אין לוג, אין 500. יש מסך ריק שנראה
 * כמו "אין נתונים", ואת זה מגלים כשמשרד מתקשר לשאול לאן נעלמו
 * הנכסים שלו.
 *
 * לכן הכלל הוא **מבני ולא זהירות**: אין קריאה ישירה מ-`prisma`
 * לטבלה שתחת RLS. רשימת הטבלאות נגזרת מהמיגרציות עצמן ולא מרשימה
 * ידנית, כדי שטבלה חדשה תיכנס לשמירה בלי שאיש יזכור לעדכן כאן.
 */

const API_SRC = join(import.meta.dirname, "..");
const PRISMA_DIR = join(API_SRC, "..", "prisma");
const WORKERS_SRC = join(API_SRC, "..", "..", "workers", "src");

/* ============================================================
   1. אילו טבלאות תחת RLS — מהמיגרציות, לא מרשימה ידנית
   ============================================================ */

function migrationSql(): string {
  const dir = join(PRISMA_DIR, "migrations");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith("migration.sql"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

function rlsTables(): Set<string> {
  const sql = migrationSql();
  const enabled = new Set<string>();

  // הצורה המפורשת: ALTER TABLE x ENABLE ROW LEVEL SECURITY
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY/gu)) {
    enabled.add(match[1]!);
  }
  // הצורה בלולאה: FOREACH t IN ARRAY ARRAY[ 'a', 'b', … ]
  for (const block of sql.matchAll(/FOREACH\s+\w+\s+IN ARRAY ARRAY\[([^\]]+)\]/gu)) {
    for (const name of block[1]!.matchAll(/'(\w+)'/gu)) enabled.add(name[1]!);
  }
  // מה שבוטל במפורש אינו תחת RLS (outbox_events)
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+DISABLE ROW LEVEL SECURITY/gu)) {
    enabled.delete(match[1]!);
  }
  return enabled;
}

/* ============================================================
   2. שם הטבלה ⟵ שם המאפיין ב-Prisma Client
   ============================================================ */

/** `model PropertyMedia { … @@map("property_media") }` ⟵ `propertyMedia`. */
function accessorsByTable(): Map<string, string> {
  const schema = readFileSync(join(PRISMA_DIR, "schema.prisma"), "utf8");
  const byTable = new Map<string, string>();
  for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/gu)) {
    const model = block[1]!;
    const mapped = /@@map\("(\w+)"\)/u.exec(block[2]!)?.[1];
    const accessor = model.charAt(0).toLowerCase() + model.slice(1);
    byTable.set(mapped ?? model, accessor);
  }
  return byTable;
}

/* ============================================================
   3. איפה נקראת גישה ישירה
   ============================================================ */

interface Violation {
  file: string;
  line: number;
  accessor: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

/**
 * האם הביטוי הוא "ה-Prisma הגלובלי" — `this.prisma` או `prisma`.
 *
 * `tx.property` אינו נתפס, וזו כל הנקודה: `tx` מגיע מ-`withTenant`
 * ולכן `app.tenant_id` כבר מוגדר עליו.
 */
function isRootPrisma(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === "prisma";
  if (ts.isPropertyAccessExpression(node)) {
    return node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "prisma";
  }
  return false;
}

function violationsIn(file: string, guarded: Set<string>): Violation[] {
  const text = readFileSync(file, "utf8");
  // דילוג מהיר על קבצים שאין בהם prisma בכלל
  if (!text.includes("prisma")) return [];

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const found: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isRootPrisma(node.expression)) {
      const accessor = node.name.text;
      if (guarded.has(accessor)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push({ file, line: line + 1, accessor });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/* ============================================================ */

const TABLES = rlsTables();
const BY_TABLE = accessorsByTable();
const GUARDED = new Set(
  [...TABLES].map((table) => BY_TABLE.get(table)).filter((a): a is string => a !== undefined),
);

describe("רשימת הטבלאות שתחת RLS", () => {
  it("נגזרת מהמיגרציות ואינה ריקה", () => {
    // רשימה ריקה הייתה הופכת את כל הבדיקה לירוקה-לשווא — הכישלון
    // הגרוע ביותר של בדיקה מבנית
    expect(TABLES.size).toBeGreaterThan(20);
  });

  it("כל טבלה מזוהה למודל ב-Prisma", () => {
    const orphans = [...TABLES].filter((table) => !BY_TABLE.has(table));
    expect(orphans, `טבלאות תחת RLS בלי מודל תואם: ${orphans.join(", ")}`).toEqual([]);
  });

  it("הטבלאות שמחוץ ל-RLS בכוונה אינן ברשימה", () => {
    // אלה תשתית אימות ורמת פלטפורמה — ראו את ההסבר בסכימה
    for (const table of ["users", "sessions", "outbox_events", "tenants", "plans", "payments"]) {
      expect(TABLES.has(table), `${table} אינה אמורה להיות תחת RLS`).toBe(false);
    }
  });

  it("הטבלאות העסקיות המרכזיות כן", () => {
    for (const table of ["properties", "contacts", "buyers", "leads", "offers", "tasks"]) {
      expect(TABLES.has(table), `${table} חייבת להיות תחת RLS`).toBe(true);
    }
  });
});

describe("אין גישה ישירה מ-prisma לטבלה שתחת RLS", () => {
  it("ב-API", () => {
    const found = sourceFiles(API_SRC).flatMap((file) => violationsIn(file, GUARDED));
    const report = found
      .map((v) => `${v.file.replace(API_SRC, "src")}:${v.line} — prisma.${v.accessor}`)
      .join("\n");
    expect(
      found,
      `שאילתה על טבלה תחת RLS בלי הקשר דייר מחזירה אפס שורות בשקט.\n` +
        `יש להעביר אותה ל-tx בתוך withTenant / withExplicitTenant / withPublic*:\n${report}`,
    ).toEqual([]);
  });

  it("ב-Workers", () => {
    // אותו כלל בדיוק. ה-Workers רץ בלי בקשה ולכן בלי הקשר דייר
    // אוטומטי — הוא מגדיר אותו במפורש בכל טרנזקציה, וגישה ישירה שם
    // הייתה נשברת בשקט בדיוק כמו ב-API.
    const found = sourceFiles(WORKERS_SRC).flatMap((file) => violationsIn(file, GUARDED));
    const report = found
      .map((v) => `${v.file.replace(WORKERS_SRC, "src")}:${v.line} — prisma.${v.accessor}`)
      .join("\n");
    expect(found, `גישה ישירה לטבלה תחת RLS ב-Workers:\n${report}`).toEqual([]);
  });
});

describe("הבדיקה עצמה תופסת הפרה", () => {
  it("מזהה this.prisma על טבלה שמורה", () => {
    // בדיקה מבנית שלא נבדקה היא בדיקה שאולי אינה בודקת כלום
    const file = join(API_SRC, "__fixture__.ts");
    const fake = `class S { constructor(private readonly prisma: P) {}
      run() { return this.prisma.property.findMany(); } }`;
    const source = ts.createSourceFile(file, fake, ts.ScriptTarget.ES2023, true);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && isRootPrisma(node.expression)) {
        found.push(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    expect(found).toContain("property");
    expect(GUARDED.has("property")).toBe(true);
  });

  it("אינה מזהה tx — זו הצורה התקינה", () => {
    const source = ts.createSourceFile(
      "x.ts",
      `async function f(tx: T) { return tx.property.findMany(); }`,
      ts.ScriptTarget.ES2023,
      true,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && isRootPrisma(node.expression)) {
        found.push(node.name.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    expect(found).toEqual([]);
  });
});
