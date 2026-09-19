import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { accessorsByTable, tenantScopedOutsideRls } from "./rls-tables.testkit";

/**
 * ‎**שאילתה על טבלה שיש בה `tenant_id` ואין עליה RLS — חייבת לסנן לפי דייר.**
 *
 * ## ‏הא-סימטריה שהבדיקה הזו סוגרת
 *
 * ‏לטבלה **תחת** RLS יש שתי שכבות: המסד מסרב להחזיר שורה של דייר
 * ‏אחר, ו-`rls-access` אוסר לקרוא אותה מה-`prisma` הגלובלי. לטבלה
 * ‏**מחוץ** ל-RLS לא הייתה אף אחת מהשתיים. `tenantScopedOutsideRls`
 * ‏כבר היה קיים — אבל שימש **רק** את בדיקת המחיקה. כלומר נשמר
 * ‏שהטבלאות האלה יימחקו כשמשרד נמחק, ולא נשמר דבר לגבי מי קורא
 * ‏אותן (ביקורת אבטחה).
 *
 * ‏ההבדל מהותי: שם `withTenant` אינו עוזר. `app.tenant_id` מוגדר
 * ‏בטרנזקציה, אבל בלי פוליסה איש אינו קורא אותו — ולכן `tx` ו-
 * ‎`this.prisma` שקולים לגמרי כאן. מה שמגן הוא **רק** ה-`where`.
 *
 * ## ‏למה זו בדיקה ולא RLS
 *
 * ‏הטבלאות האלה מחוץ ל-RLS מסיבות אמיתיות: חלקן נקראות לפני שקיים
 * ‏הקשר דייר (חיפוש לפי טוקן בוובהוק), וחלקן נקראות **במכוון**
 * ‏חוצות-דיירים (סבב חידושים, מסך הפלטפורמה). מה שאי אפשר לאכוף
 * ‏במסד אפשר לאכוף כאן.
 *
 * ‎**הכלל מבני ולא זהירות.** היום הסינון נכון בכל מקום שנבדק ידנית
 * ‏— ב-`billing.service` אפילו יש הערה שמסבירה למה. אבל זהירות אינה
 * ‏משאירה עקבות: קריאה אחת שתישכח לא תיכשל במסד, לא בבדיקה ולא
 * ‏ב-CI, והתוצאה תהיה נתונים של משרד אחר על המסך.
 */

const API_SRC = join(import.meta.dirname, "..");
const WORKERS_SRC = join(API_SRC, "..", "..", "workers", "src");
const PRISMA_DIR = join(API_SRC, "..", "prisma");

/**
 * ‏פעולות שנוגעות בשורות **קיימות**, ולכן מסוכנות בלי סינון דייר.
 *
 * ‎`create` אינו כאן: הוא אינו קורא שורה של אחר. `upsert` כן —
 * ‏ה-`where` שלו בוחר שורה קיימת לעדכון.
 */
const GUARDED_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert",
]);

/**
 * ‎**קבצים שגישתם חוצת-דיירים במכוון** — כל שורה היא החלטה.
 *
 * ‏זה המקום שבו ביקורת צריכה לעצור ולשאול „למה”. הוספה לרשימה
 * ‏אינה פטור טכני אלא הצהרה שהקובץ הזה **אמור** לראות את כל
 * ‏הדיירים.
 */
const CROSS_TENANT_BY_DESIGN: Record<string, string> = {
  "modules/platform/platform.controller.ts": "מסך בעל הפלטפורמה — רואה את כל המשרדים בהגדרה",
  "modules/platform/platform.service.ts": "אותו מסך, שכבת השירות שלו",
  "modules/settings/account-deletion.service.ts": "מחיקת משרד — נקראת עם tenantId מפורש כפרמטר",
  "modules/billing/renewal.service.ts": "סבב חידושים — עובר על כל המנויים שפג תוקפם",
  "modules/billing/whatsapp-seat-renewal.service.ts": "סבב חידושים למקומות וואטסאפ",
  "modules/billing/number-rental-renewal.service.ts": "סבב חידושים למספרים מושכרים",
  "modules/billing/invoice.service.ts": "סורק החשבוניות — מפיק את מה שממתין בכל המשרדים",
  "modules/billing/billing.service.ts": "וובהוק קארדקום מגיע בלי הקשר דייר; הדייר נגזר מהתשלום",
  "modules/billing/subscription-offer.service.ts": "הצעות מנוי נוצרות ונענות מחוץ להקשר משרד",
  "modules/messaging/whatsapp-connection.service.ts": "וובהוק Meta מזוהה לפי phone_number_id, לא לפי דייר",
  "modules/messaging/whatsapp-link.service.ts": "אימות מספר בקישור חד-פעמי — לפני שיש הקשר דייר",
  "modules/inbound-mail/inbound-mail.service.ts": "דואר נכנס — הדייר נגזר מכתובת היעד",
  "modules/support/support-inbox.service.ts": "דלפק התמיכה של הפלטפורמה — חוצה משרדים בהגדרה",
  "modules/webhook-log/webhook-log.service.ts": "יומן וובהוקים — סבב ניקוי על כל המשרדים",
  "core/email.service.ts": "מעקב מסירה לפי מזהה ההודעה אצל הספק",
  /*
   * ‏שלושת אלה נבדקו אחד-אחד: המזהה שהם מקבלים **אינו מגיע
   * ‏מהמשתמש**. הנתיבים שהמשרד קורא להם (`cancel`) מעבירים
   * ‎`TenantContext.current().tenantId` במפורש ומסננים לפיו; מה
   * ‏שנשאר כאן נקרא רק משלושה מקומות שהדייר בהם כבר ידוע.
   */
  "modules/billing/number-rental.service.ts":
    "‏מזהה ההשכרה מגיע משורת תשלום, מסבב החידושים או ממסך הפלטפורמה — לא מהמשתמש",
  "modules/billing/whatsapp-seat.service.ts":
    "‏מזהה המקום מגיע מ-`payment.seatId` אחרי אימות מול קארדקום — לא מהמשתמש",
  "modules/messaging/whatsapp-bot.service.ts":
    "‏מזהה החיבור מגיע מה-dispatcher של וובהוק Meta — לא מהמשתמש",
};

/**
 * ‎**טבלאות שהשאלה כולה אינה חלה עליהן** — ולא „קובץ שמותר לו”.
 *
 * ‏אלה הטבלאות שבהן חיפוש **לפני** שקיים הקשר דייר הוא כל תפקידן.
 * ‏התחברות שואלת „מי בעל המייל הזה” כשעוד אין משרד, ולכן דרישת
 * ‏`tenantId` שם אינה מחמירה אלא בלתי-אפשרית. מתועד כך גם בראש
 * ‎`20260728070000_enable_rls`.
 */
const NOT_TENANT_SCOPED_BY_NATURE: Record<string, string> = {
  users: "תשתית אימות — החיפוש לפי מייל קורה לפני שקיים הקשר דייר",
  sessions: "אותה תשתית: פענוח ה-Session הוא מה שקובע מיהו הדייר",
  outbox_events: "תור חוצה-דיירים; ה-Dispatcher קורא אותו לכל המשרדים",
};

interface Violation {
  file: string;
  line: number;
  accessor: string;
  op: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(dir, name));
}

/**
 * ‏האם הדייר נכנס לשאילתה — **בכל צורה ובכל עומק**.
 *
 * ‏שלוש צורות לגיטימיות, ולכן הבדיקה היא על שם המזהה ולא על מבנה:
 *
 * ‎`where: { tenantId }`‎ — הישירה;
 * ‎`where: { OR: [{ tenantId }, …] }`‎ — מקוננת, שכיחה בסינון כפול;
 * ‎`where: whatsappSeatQuotaWhere(tenantId, now)`‎ — **עוזר**, וזו
 * ‏הצורה שהפילה את הגרסה הראשונה של הבדיקה הזו: הסינון היה שם
 * ‏במלואו, אבל הוא נבנה בפונקציה ולא נכתב כאובייקט. בדיקה שמסמנת
 * ‏את זה אינה מחמירה — היא **שקרית**, ובדיקה שקרית מלמדת לעקוף
 * ‏אותה.
 *
 * ‏המחיר: קריאה שמזכירה `tenantId` בלי להשתמש בו באמת תעבור. זו
 * ‏עסקה מודעת — שער שמייצר רעש נמחק תוך שבוע, ושער שתופס את הצורה
 * ‏האמיתית (`where: { id }` בלבד) שורד.
 */
function mentionsTenant(node: ts.Node, source: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && (n.text === "tenantId" || n.text === "tenant_id")) {
      found = true;
      return;
    }
    if (
      (ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) &&
      ["tenantId", "tenant_id"].includes(n.name.getText(source))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** ‎`$queryRaw` וחבריו — SQL שנכתב ביד ואינו עובר דרך שם מודל. */
function isRawCall(name: string): boolean {
  return name.startsWith("$") && name.includes("Raw");
}

/**
 * ‎**גם SQL גולמי — הפרצה שהגרסה הראשונה של השער פספסה.**
 *
 * ‏הסורק למעלה מחפש שם של מודל (`prisma.subscription`), ולכן
 * ‎``tx.$queryRaw`SELECT id FROM subscriptions WHERE …` `` עוברת
 * ‏אותו בשלום: אין בה שם מודל, יש בה מחרוזת. זו אינה צורה
 * ‏תיאורטית — `funnel-enrollment.service.ts` נועלת כך את שורת
 * ‏המנוי, והיום עם `tenant_id` בתנאי. הסרת התנאי לא הייתה מורגשת
 * ‏(ביקורת Codex).
 *
 * ‎`rls-access.test.ts` כבר עושה בדיוק את זה לטבלאות שתחת RLS.
 */
function rawViolations(
  node: ts.Node,
  source: ts.SourceFile,
  file: string,
  tables: Set<string>,
): Violation[] {
  const text = node.getText(source);
  const hit = [...tables].find((table) => new RegExp(`\\b${table}\\b`, "u").test(text));
  if (hit === undefined) return [];
  // ‏התנאי נכתב ב-SQL, ולכן `tenant_id` ולא `tenantId`
  if (/\btenant_id\b/u.test(text)) return [];
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return [{ file, line: line + 1, accessor: hit, op: "$queryRaw" }];
}

function violationsIn(
  file: string,
  guarded: Map<string, string>,
  tables: Set<string>,
): Violation[] {
  const text = readFileSync(file, "utf8");
  if (!text.includes("prisma") && !text.includes("tx.")) return [];

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2023, true);
  const found: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const target = node.expression.expression;
      if (GUARDED_OPS.has(op) && ts.isPropertyAccessExpression(target)) {
        const accessor = target.name.text;
        if (guarded.has(accessor)) {
          const args = node.arguments[0];
          if (args === undefined || !mentionsTenant(args, source)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            found.push({ file, line: line + 1, accessor, op });
          }
        }
      }
    }
    /* ‏תבנית מתויגת (``$queryRaw`…` ``) וגם קריאה רגילה */
    if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag)) {
      if (isRawCall(node.tag.name.text)) found.push(...rawViolations(node, source, file, tables));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/* ============================================================ */

const OUTSIDE = tenantScopedOutsideRls(PRISMA_DIR);
const BY_TABLE = accessorsByTable(PRISMA_DIR, { requireTenantId: true });
const GUARDED = new Map<string, string>();
/** ‏שמות הטבלאות השמורות — לסריקת ה-SQL הגולמי, שאינה מכירה מודלים. */
const GUARDED_TABLES = new Set<string>();
for (const table of OUTSIDE) {
  if (NOT_TENANT_SCOPED_BY_NATURE[table] !== undefined) continue;
  GUARDED_TABLES.add(table);
  const accessor = BY_TABLE.get(table);
  if (accessor !== undefined) GUARDED.set(accessor, table);
}

function rel(file: string, root: string): string {
  return file.slice(root.length + 1).replace(/\\/gu, "/");
}

function scan(root: string): Violation[] {
  return sourceFiles(root)
    .filter((file) => CROSS_TENANT_BY_DESIGN[rel(file, root)] === undefined)
    .flatMap((file) => violationsIn(file, GUARDED, GUARDED_TABLES));
}

describe("רשימת הטבלאות שמחוץ ל-RLS", () => {
  it("נגזרת מהמיגרציות ואינה ריקה", () => {
    // רשימה ריקה הייתה הופכת את הבדיקה לירוקה-לשווא
    expect(GUARDED.size).toBeGreaterThan(5);
  });

  it("כוללת את הטבלאות הרגישות שידועות כמחוץ ל-RLS", () => {
    for (const table of ["payments", "subscriptions", "support_threads", "whatsapp_seats"]) {
      expect(OUTSIDE.has(table), `${table} אמורה להיות ברשימה`).toBe(true);
    }
  });

  it("אינה כוללת טבלה שכן תחת RLS", () => {
    for (const table of ["properties", "contacts", "buyers", "offers"]) {
      expect(OUTSIDE.has(table), `${table} תחת RLS ואינה שייכת לכאן`).toBe(false);
    }
  });

  /*
   * ‎**טבלה בלי מאפיין תואם — כישלון, לא דילוג.**
   *
   * ‏הגרסה הראשונה עשתה `if (accessor !== undefined)` והמשיכה
   * ‏הלאה. `telephony_webhook_hits` שונה ל-`webhook_hits`, הגזירה
   * ‏החזירה את השם הישן, ההתאמה נכשלה — וכל הקריאות ל-`webhookHit`
   * ‏יצאו מהשמירה **בלי שדבר האדים** (ביקורת Codex). זו בדיוק
   * ‏התקלה שערכת הבדיקות מזהירה מפניה בתיעוד שלה.
   */
  it("כל טבלה שמורה מזוהה למאפיין ב-Prisma", () => {
    const orphans = [...GUARDED_TABLES].filter((table) => !BY_TABLE.has(table));
    expect(
      orphans,
      `טבלאות ללא מאפיין תואם — בדקו שינוי שם במיגרציות: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("שינוי שם מטופל — הטבלה נשמרת בשמה הנוכחי", () => {
    // ‏`telephony_webhook_hits` → `webhook_hits`
    expect(OUTSIDE.has("webhook_hits")).toBe(true);
    expect(OUTSIDE.has("telephony_webhook_hits")).toBe(false);
    expect(GUARDED.has("webhookHit")).toBe(true);
  });

  it("תשתית האימות אינה נשמרת כאן — ובמפורש", () => {
    // ‏`users` נושאת `tenant_id` ואינה תחת RLS, ולכן הייתה נכנסת
    // ‏לשמירה מעצמה. הפטור שלה הוא החלטה מתועדת ולא השמטה.
    expect(GUARDED.has("user")).toBe(false);
    expect(NOT_TENANT_SCOPED_BY_NATURE["users"]).toBeDefined();
  });
});

describe("כל שאילתה על טבלה מחוץ ל-RLS מסננת לפי דייר", () => {
  it("ב-API", () => {
    const found = scan(API_SRC);
    const report = found
      .map((v) => `src/${rel(v.file, API_SRC)}:${v.line} — ${v.accessor}.${v.op}`)
      .join("\n");
    expect(
      found,
      `הטבלה מחוץ ל-RLS, ולכן ה-where הוא ההגנה היחידה. יש להוסיף tenantId,\n` +
        `או — אם הגישה חוצת-דיירים במכוון — לרשום את הקובץ ב-CROSS_TENANT_BY_DESIGN עם נימוק:\n${report}`,
    ).toEqual([]);
  });

  it("ב-Workers", () => {
    const found = scan(WORKERS_SRC);
    const report = found
      .map((v) => `src/${rel(v.file, WORKERS_SRC)}:${v.line} — ${v.accessor}.${v.op}`)
      .join("\n");
    expect(found, `שאילתה בלי סינון דייר ב-Workers:\n${report}`).toEqual([]);
  });
});

describe("הבדיקה עצמה תופסת הפרה", () => {
  /* בדיקה מבנית שלא נבדקה היא בדיקה שאולי אינה בודקת כלום. */
  it("מסמנת שאילתה בלי tenantId", () => {
    const file = join(API_SRC, "__fixture__.ts");
    const fake = `class S { run() { return this.prisma.payment.findMany({ where: { id } }); } }`;
    const source = ts.createSourceFile(file, fake, ts.ScriptTarget.ES2023, true);
    let flagged = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const args = n.arguments[0];
        if (args !== undefined && !mentionsTenant(args, source)) flagged = true;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(source, visit);
    expect(flagged).toBe(true);
    expect(GUARDED.has("payment"), "payment חייבת להיות מהטבלאות השמורות").toBe(true);
  });

  it("אינה מסמנת שאילתה שכן מסננת", () => {
    const fake = `class S { run() { return this.prisma.payment.findFirst({ where: { id, tenantId } }); } }`;
    const source = ts.createSourceFile("ok.ts", fake, ts.ScriptTarget.ES2023, true);
    let flagged = false;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const args = n.arguments[0];
        if (args !== undefined && !mentionsTenant(args, source)) flagged = true;
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(source, visit);
    expect(flagged).toBe(false);
  });

  it("מסמנת SQL גולמי בלי tenant_id, ומקבלת אותו איתו", () => {
    const bad = `class S { run() { return tx.$queryRaw\`SELECT id FROM subscriptions\`; } }`;
    const good = `class S { run() { return tx.$queryRaw\`SELECT id FROM subscriptions WHERE tenant_id = \${t}\`; } }`;
    const scan = (code: string): number => {
      const source = ts.createSourceFile("raw.ts", code, ts.ScriptTarget.ES2023, true);
      let hits = 0;
      const visit = (n: ts.Node): void => {
        if (ts.isTaggedTemplateExpression(n) && ts.isPropertyAccessExpression(n.tag)) {
          if (isRawCall(n.tag.name.text)) {
            hits += rawViolations(n, source, "raw.ts", new Set(["subscriptions"])).length;
          }
        }
        ts.forEachChild(n, visit);
      };
      ts.forEachChild(source, visit);
      return hits;
    };
    expect(scan(bad)).toBe(1);
    expect(scan(good)).toBe(0);
  });

  it("רואה סינון שנבנה בעוזר — הצורה שהפילה את הגרסה הראשונה", () => {
    const fake = `const w = { where: whatsappSeatQuotaWhere(tenantId, now) };`;
    const source = ts.createSourceFile("helper.ts", fake, ts.ScriptTarget.ES2023, true);
    expect(mentionsTenant(source, source)).toBe(true);
  });

  it("רואה סינון מקונן ולא רק where ישיר", () => {
    const fake = `const w = { where: { OR: [{ tenantId }, { id }] } };`;
    const source = ts.createSourceFile("nested.ts", fake, ts.ScriptTarget.ES2023, true);
    expect(mentionsTenant(source, source)).toBe(true);
  });
});
