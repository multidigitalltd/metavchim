import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * **מחיקת משרד מוחקת כל טבלה שיש בה נתוני דייר.**
 *
 * ‎`purgeTenant` היא רשימה ידנית של קריאות `deleteMany`. טבלה חדשה
 * תחת RLS שנשכחת ממנה אינה נכשלת בשום מקום: המחיקה מסתיימת ב-200,
 * המסך אומר „המשרד נמחק”, והשורות נשארות. זו בדיוק ההבטחה שאי אפשר
 * לקיים חלקית — לקוח שביקש להימחק, וסעיף 17 של ה-GDPR שהתשובה לו
 * היא „הכול”.
 *
 * הבדיקה הזו נולדה כשנוספה `call_routings` ובאותו רגע היה אפשר
 * לשכוח אותה. רשימת הטבלאות נגזרת מהמיגרציות ולא נכתבת כאן, מאותו
 * נימוק בדיוק כמו ב-`rls-access.test.ts`: טבלה חדשה נכנסת לשמירה
 * בלי שאיש יזכור לעדכן קובץ בדיקה.
 */

const SERVICE = join(import.meta.dirname, "account-deletion.service.ts");
const PRISMA_DIR = join(import.meta.dirname, "..", "..", "..", "prisma");

/**
 * טבלאות תחת RLS שאינן נמחקות — **בכוונה, ועם נימוק.**
 *
 * כל שורה כאן היא החלטה שצריך להגן עליה, ולא פטור טכני. תוספת
 * לרשימה היא בדיוק המקום שבו ביקורת צריכה לעצור ולשאול „למה”.
 */
const KEPT_ON_PURPOSE: Record<string, string> = {
  // הראיה שהמחיקה קרתה. מחיקתה יחד עם השאר הייתה מוחקת את התיעוד
  // של הפעולה עצמה — ואז אין דרך להראות שהמשרד אכן נמחק כדין.
  // מוגן גם ברמת המסד: REVOKE UPDATE, DELETE מתפקיד האפליקציה.
  audit_log: "התיעוד שהמחיקה בוצעה — נשאר במכוון",
  // שני הספרים Append-Only עם אותו REVOKE. תנועה שנמחקת היא כסף
  // שנעלם מהמאזן, ו-`deleteMany` עליהם היה נופל על permission
  // denied ומפיל את כל המחיקה. אין בהם פרט מזהה — מזהים, סוג
  // תנועה וסכום. פרטי הבנק יושבים ב-`payout_requests`, והיא כן
  // נמחקת.
  credit_ledger: "ספר קרדיטים Append-Only, בלי פרט מזהה",
  payout_ledger: "ספר כספי Append-Only, בלי פרט מזהה",
};

function migrationSql(): string {
  const dir = join(PRISMA_DIR, "migrations");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith("migration.sql"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

/** אילו טבלאות תחת RLS — מהמיגרציות, לא מרשימה ידנית. */
function rlsTables(): Set<string> {
  const sql = migrationSql();
  const enabled = new Set<string>();
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ENABLE ROW LEVEL SECURITY/gu)) {
    enabled.add(match[1]!);
  }
  for (const block of sql.matchAll(/FOREACH\s+\w+\s+IN ARRAY ARRAY\[([^\]]+)\]/gu)) {
    for (const name of block[1]!.matchAll(/'(\w+)'/gu)) enabled.add(name[1]!);
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+(\w+)\s+DISABLE ROW LEVEL SECURITY/gu)) {
    enabled.delete(match[1]!);
  }
  return enabled;
}

/**
 * `model PropertyMedia { … @@map("property_media") }` ⟵ `propertyMedia`.
 *
 * **רק מודלים שיש בהם `tenantId`.** טבלה משותפת לשני משרדים —
 * `coop_deals` עם `listingTenantId`/`buyerTenantId`, או
 * `coop_deal_messages` עם `authorTenantId` — אינה שייכת לדייר אחד,
 * ומחיקתה בשמו הייתה מוחקת את הרשומה של המשרד השני. אין שם
 * `deleteMany({ where: { tenantId } })` שאפשר לכתוב בכלל, ולכן זו
 * הבחנה מבנית ולא פטור.
 */
function purgeableAccessorsByTable(): Map<string, string> {
  const schema = readFileSync(join(PRISMA_DIR, "schema.prisma"), "utf8");
  const byTable = new Map<string, string>();
  for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/gu)) {
    const model = block[1]!;
    const body = block[2]!;
    if (!/^\s*tenantId\s/mu.test(body)) continue;
    const mapped = /@@map\("(\w+)"\)/u.exec(body)?.[1];
    byTable.set(mapped ?? model, model.charAt(0).toLowerCase() + model.slice(1));
  }
  return byTable;
}

/** אילו מאפיינים נמחקים בפועל בשירות המחיקה. */
function purgedAccessors(): Set<string> {
  const source = readFileSync(SERVICE, "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/\btx\.(\w+)\.deleteMany\(/gu)) found.add(match[1]!);
  return found;
}

describe("מחיקת משרד — כיסוי הטבלאות", () => {
  it("כל טבלה תחת RLS נמחקת, או רשומה במפורש כנשמרת בכוונה", () => {
    const accessors = purgeableAccessorsByTable();
    const purged = purgedAccessors();

    const missing = [...rlsTables()]
      .filter((table) => KEPT_ON_PURPOSE[table] === undefined)
      // טבלה בלי מודל, או בלי `tenantId`, אינה נמחקת בדפוס הזה
      .filter((table) => accessors.has(table))
      .filter((table) => !purged.has(accessors.get(table)!));

    expect(missing).toEqual([]);
  });

  it("הרשימה של „נשמר בכוונה” אינה מכילה טבלה שכבר אינה תחת RLS", () => {
    const tables = rlsTables();
    const stale = Object.keys(KEPT_ON_PURPOSE).filter((table) => !tables.has(table));
    expect(stale).toEqual([]);
  });
});
