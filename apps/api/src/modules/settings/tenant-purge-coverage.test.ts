import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessorsByTable,
  cascadingFromTenants,
  rlsTables,
} from "../../common/rls-tables.testkit";

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

/** אילו מאפיינים נמחקים בפועל בשירות המחיקה. */
function purgedAccessors(): Set<string> {
  const source = readFileSync(SERVICE, "utf8");
  const found = new Set<string>();
  for (const match of source.matchAll(/\btx\.(\w+)\.deleteMany\(/gu)) found.add(match[1]!);
  return found;
}

describe("מחיקת משרד — כיסוי הטבלאות", () => {
  it("כל טבלה תחת RLS נמחקת, או רשומה במפורש כנשמרת בכוונה", () => {
    const accessors = accessorsByTable(PRISMA_DIR, { requireTenantId: true });
    const purged = purgedAccessors();
    /*
     * מה שנופל עם שורת המשרד ב-CASCADE אינו צריך `deleteMany`.
     * דרישה כזו הייתה ממלאת את הרשימה בשורות שאינן עושות דבר, ובתוך
     * רשימה כזו שורה חסרה נבלעת — כלומר בדיוק הפוך מהמטרה.
     */
    const cascading = cascadingFromTenants(PRISMA_DIR);

    const missing = [...rlsTables(PRISMA_DIR)]
      .filter((table) => KEPT_ON_PURPOSE[table] === undefined)
      .filter((table) => !cascading.has(table))
      // טבלה בלי מודל, או בלי `tenantId`, אינה נמחקת בדפוס הזה
      .filter((table) => accessors.has(table))
      .filter((table) => !purged.has(accessors.get(table)!));

    expect(missing).toEqual([]);
  });

  it("הרשימה של „נשמר בכוונה” אינה מכילה טבלה שכבר אינה תחת RLS", () => {
    const tables = rlsTables(PRISMA_DIR);
    const stale = Object.keys(KEPT_ON_PURPOSE).filter((table) => !tables.has(table));
    expect(stale).toEqual([]);
  });
});
