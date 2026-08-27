import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accessorsByTable,
  cascadingFromTenants,
  rlsTables,
  tenantScopedOutsideRls,
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

/**
 * טבלאות מחוץ ל-RLS שנשמרות — **בכוונה, ועם נימוק.**
 *
 * ‎`outbox_events` אינה כאן: היא נמחקת בתוך הטרנזקציה, ומיד אחריה
 * נכתבות אליה משימות ניקוי ה-S3 — כלומר היא כן מטופלת, פשוט לא
 * בבלוק האחרון.
 */
const KEPT_OUTSIDE_RLS: Record<string, string> = {
  // מסמכים כספיים בחובת שמירה חוקית — סכומים ומזהי עסקה בלבד.
  // מתועד גם בראש `account-deletion.service.ts`.
  payments: "רשומות סליקה בחובת שמירה, בלי פרט אישי",
  // מסמכי מס שהופקו על אותן גבייות — חובת שמירה של שבע שנים,
  // ומחיקתם הייתה משאירה ספרים בלי המסמכים שמאחוריהם.
  invoices: "חשבוניות מס בחובת שמירה, בלי פרט אישי",
  // נמחקת בתוך הטרנזקציה ואז נכתבת מחדש למשימות ניקוי אחסון
  outbox_events: "נמחקת בטרנזקציה; אחריה נכתבות משימות ניקוי S3",
};

/**
 * אילו מאפיינים נמחקים בפועל — בשירות **ובעוזרים שהוא קורא להם.**
 *
 * ‎`deleteCoopDeals` מוחקת את חדר העסקה ואת השרשור שלו, ונקראת מכאן
 * וגם משלושה מסלולי מחיקה אחרים. סריקה של הקובץ הזה בלבד לא ראתה
 * אותה, וסימנה `coop_deals` ו-`coop_deal_messages` כלא-נמחקות
 * (ביקורת Codex).
 *
 * הייבוא נגזר מהקובץ עצמו ואינו רשימה כתובה: עוזר מחיקה חדש ייכנס
 * לסריקה בלי שאיש יזכור לעדכן כאן. רמה אחת מספיקה — עוזר שקורא
 * לעוזר יהיה סימן שהמחיקה נעשתה מסובכת מדי מכדי להיקרא.
 */
function purgedAccessors(): Set<string> {
  const service = readFileSync(SERVICE, "utf8");
  const sources = [service];

  for (const match of service.matchAll(/from\s+"(\.[^"]+)"/gu)) {
    const path = join(import.meta.dirname, `${match[1]!}.ts`);
    try {
      sources.push(readFileSync(path, "utf8"));
    } catch {
      // ייבוא של תיקייה או של חבילה — אינו קובץ עוזר
    }
  }

  const found = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\btx\.(\w+)\.deleteMany\(/gu)) found.add(match[1]!);
  }
  return found;
}

/**
 * מה שמטופל בבלוק שמחוץ ל-RLS — `this.prisma.<x>` ולא `tx.<x>`.
 *
 * גם `updateMany` ולא רק `deleteMany`: יש טבלה שהתשובה הנכונה בה
 * היא ניתוק השיוך ולא מחיקה (יומן הוובהוקים). „לא נשאר שיוך” היא
 * הדרישה; מחיקה היא רק אחת משתי הדרכים לקיים אותה.
 */
function purgedOutsideRls(): Set<string> {
  const service = readFileSync(SERVICE, "utf8");
  const found = new Set<string>();
  for (const match of service.matchAll(
    /\bthis\.prisma\.(\w+)\.(?:deleteMany|updateMany)\(/gu,
  )) {
    found.add(match[1]!);
  }
  return found;
}

describe("מחיקת משרד — כיסוי הטבלאות", () => {
  it("כל טבלה תחת RLS נמחקת, או רשומה במפורש כנשמרת בכוונה", () => {
    /*
     * **גם טבלה משותפת לשני משרדים.**
     *
     * סינון לפי קיום שדה `tenantId` היה שקט ומסוכן: הוא הוציא
     * מהבדיקה את `coop_deals`, `coop_deal_messages`, `coop_interests`,
     * `coop_offers` ו-`lead_referral_ratings` — שכולן **כן** נמחקות
     * היום, בנתיבים ייעודיים עם `from/to`, `listing/buyer` או
     * `seller/buyer`. הסרה של אחת מהמחיקות האלה לא הייתה מפילה דבר
     * (ביקורת Codex). הן נבדקות עכשיו כמו כולן; מה שנדרש היה לגרום
     * לסריקה לראות את העוזר, לא לוותר על הטבלאות.
     */
    const accessors = accessorsByTable(PRISMA_DIR);
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
      // טבלה בלי מודל ב-Prisma אינה נגישה דרך `tx.<x>` ממילא
      .filter((table) => accessors.has(table))
      .filter((table) => !purged.has(accessors.get(table)!));

    expect(missing).toEqual([]);
  });

  it("הרשימה של „נשמר בכוונה” אינה מכילה טבלה שכבר אינה תחת RLS", () => {
    const tables = rlsTables(PRISMA_DIR);
    const stale = Object.keys(KEPT_ON_PURPOSE).filter((table) => !tables.has(table));
    expect(stale).toEqual([]);
  });

  /*
   * **גם טבלה שאינה תחת RLS.**
   *
   * הבדיקה שלמעלה גוזרת „מה צריך להימחק” מ-RLS, וזו הייתה נקודת
   * העיוורון: `subscription_offers` יושבת ברמת הפלטפורמה בכוונה,
   * ולכן שרדה מחיקת משרד עם הטוקן הסודי שלה, מזהה המשרד, שורות
   * התוספת וההערה החופשית שנכתבה ללקוח — והמשיכה להופיע ברשימת
   * ההצעות (ביקורת Codex).
   *
   * RLS הוא מנגנון, לא הגדרה. „נתוני דייר” הם כל שורה שיש בה
   * `tenant_id`, ומחיקת משרד חייבת לכסות את כולן — או להסביר למה
   * לא.
   */
  it("כל טבלה עם tenant_id שאינה תחת RLS נמחקת, מנותקת, או רשומה כנשמרת", () => {
    const accessors = accessorsByTable(PRISMA_DIR, { requireTenantId: false });
    const cascading = cascadingFromTenants(PRISMA_DIR);
    const purged = purgedOutsideRls();

    const missing = [...tenantScopedOutsideRls(PRISMA_DIR)]
      .filter((table) => KEPT_OUTSIDE_RLS[table] === undefined)
      .filter((table) => !cascading.has(table))
      .filter((table) => accessors.has(table))
      .filter((table) => !purged.has(accessors.get(table)!));

    expect(missing).toEqual([]);
  });

  it("הרשימה של „נשמר בכוונה מחוץ ל-RLS” אינה מכילה טבלה שכבר אינה כזו", () => {
    const outside = tenantScopedOutsideRls(PRISMA_DIR);
    const stale = Object.keys(KEPT_OUTSIDE_RLS).filter((table) => !outside.has(table));
    expect(stale).toEqual([]);
  });
});
