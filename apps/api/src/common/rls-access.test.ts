import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { accessorsByTable, rlsTables } from "./rls-tables.testkit";

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
   1-2. אילו טבלאות תחת RLS, ומה שם המאפיין שלהן ב-Prisma
   ============================================================

   שתי הגזירות עברו ל-`rls-tables.testkit`, כי `tenant-purge-coverage`
   שואלת בדיוק את אותה שאלה. כשלכל בדיקה היה עותק משלה, הביטוי כאן
   לא קיבל **שם מצוטט** — ושלוש טבלאות נעדרו משתיהן גם יחד בלי
   שאיש ראה זאת (ביקורת Codex). */

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

/**
 * SQL גולמי שנכתב על ה-Prisma הגלובלי — `$queryRaw` וחבריו.
 *
 * **הפרצה שהבדיקה הזו פספסה פעם אחת.** הסריקה למעלה מחפשת שם של
 * מודל אחרי `this.prisma`, ולכן `this.prisma.$queryRaw\`SELECT … FROM
 * calls\`` עוברת אותה בשלום — אין בה `prisma.call`, יש בה מחרוזת.
 * התוצאה זהה לחלוטין לצורה שכן נתפסת: אפס שורות בשקט, לנצח.
 *
 * שאילתה גולמית על טבלה שאינה תחת RLS (`tenants`) לגיטימית ואינה
 * מסומנת — `jsonb_set` על עמודת ההגדרות הוא בדיוק המקום שבו היא
 * נחוצה.
 */
function rawTablesIn(callText: string, tables: Set<string>): string[] {
  return [...tables].filter((table) => new RegExp(`\\b${table}\\b`, "u").test(callText));
}

function isRawCall(name: string): boolean {
  return name.startsWith("$") && name.includes("Raw");
}

function violationsIn(file: string, guarded: Set<string>, tables: Set<string>): Violation[] {
  const text = readFileSync(file, "utf8");
  // דילוג מהיר על קבצים שאין בהם prisma בכלל
  if (!text.includes("prisma")) return [];

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const found: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isRootPrisma(node.expression)) {
      const accessor = node.name.text;
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      if (guarded.has(accessor)) {
        found.push({ file, line: line + 1, accessor });
      } else if (isRawCall(accessor) && node.parent) {
        for (const table of rawTablesIn(node.parent.getText(source), tables)) {
          found.push({ file, line: line + 1, accessor: `${accessor} → ${table}` });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/* ============================================================ */

const TABLES = rlsTables(PRISMA_DIR);
const BY_TABLE = accessorsByTable(PRISMA_DIR);
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
    const found = sourceFiles(API_SRC).flatMap((file) => violationsIn(file, GUARDED, TABLES));
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
    const found = sourceFiles(WORKERS_SRC).flatMap((file) => violationsIn(file, GUARDED, TABLES));
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

  /*
   * הצורה שהבדיקה הזו לא תפסה עד עכשיו, ושבגללה נוספה `rawTablesIn`.
   * בלי הבדיקה הזו ההרחבה עצמה יכולה להישבר בלי שאיש ישים לב.
   */
  it("מזהה SQL גולמי על טבלה שתחת RLS", () => {
    const fake = `class S { run() { return this.prisma.$queryRaw\`SELECT id FROM calls\`; } }`;
    const source = ts.createSourceFile("raw.ts", fake, ts.ScriptTarget.ES2023, true);
    const hits: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node) &&
        isRootPrisma(node.expression) &&
        isRawCall(node.name.text) &&
        node.parent
      ) {
        hits.push(...rawTablesIn(node.parent.getText(source), TABLES));
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(source, visit);
    expect(hits).toContain("calls");
  });

  it("אינה מזהה SQL גולמי על טבלה שמחוץ ל-RLS", () => {
    // `tenants` היא היעד הלגיטימי של כל השאילתות הגולמיות היום
    expect(rawTablesIn("UPDATE tenants SET settings = …", TABLES)).toEqual([]);
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
