import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * **אילו טבלאות תחת RLS — מקום אחד, נגזר מהמיגרציות.**
 *
 * שתי בדיקות מבניות נשענות על התשובה הזו: `rls-access` (אסור לקרוא
 * טבלה כזו מ-`prisma` הגלובלי) ו-`tenant-purge-coverage` (חייבים
 * למחוק אותה במחיקת משרד). כל עוד לכל אחת היה עותק משלה של אותן
 * שלוש רגקסים, טעות באחת השאירה את השנייה עיוורת בדיוק לאותן
 * טבלאות — וזה בדיוק מה שקרה: הביטוי לא קיבל **שם מצוטט**, ולכן
 * ‎`automation_rules`‏, `automation_runs` ו-`virtual_numbers` נעדרו
 * משתי הבדיקות גם יחד. שתיהן היו ירוקות על טבלאות שלא נבדקו כלל
 * (ביקורת Codex).
 *
 * הגזירה מהמיגרציות ולא מרשימה ידנית: טבלה חדשה נכנסת לשמירה בלי
 * שאיש יזכור לעדכן קובץ בדיקה.
 */

/** שם טבלה ב-SQL — עם מרכאות כפולות או בלעדיהן. */
const TABLE = String.raw`"?(\w+)"?`;

/**
 * כל ה-SQL של המיגרציות, **בסדר כרונולוגי**.
 *
 * ‎`readdirSync` אינו מבטיח סדר: הוא מחזיר את מה שמערכת הקבצים
 * מחזירה. כל עוד הקריאה הייתה „מי בו-זמנית”, זה לא הפריע — אבל
 * ‎`cascadingFromTenants` שואלת „מי הוצהר אחרון”, ושם סדר אקראי
 * אומר שהצהרה ישנה יכולה לדרוס חדשה. אילוץ שהוחלף מ-CASCADE
 * ל-RESTRICT היה נקרא הפוך, והבדיקה הייתה מדלגת על טבלה שדורשת
 * מחיקה מפורשת — כלומר דליפה שקטה, בדיוק מה שהיא נועדה למנוע
 * (ביקורת Codex).
 *
 * שמות התיקיות נושאים חותמת זמן (`20260825010000_call_routing`),
 * ולכן מיון לקסיקוגרפי **הוא** מיון כרונולוגי.
 */
function migrationSql(prismaDir: string): string {
  const dir = join(prismaDir, "migrations");
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith("migration.sql"))
    .sort((a, b) => a.localeCompare(b, "en"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

/**
 * הטבלאות שעליהן הופעל RLS, פחות אלה שבוטלו במפורש.
 *
 * `prismaDir` הוא התיקייה שמכילה את `migrations` ואת `schema.prisma`.
 */
export function rlsTables(prismaDir: string): Set<string> {
  const sql = migrationSql(prismaDir);
  const enabled = new Set<string>();

  // הצורה המפורשת: ALTER TABLE x ENABLE ROW LEVEL SECURITY
  for (const match of sql.matchAll(
    new RegExp(String.raw`ALTER TABLE\s+${TABLE}\s+ENABLE ROW LEVEL SECURITY`, "gu"),
  )) {
    enabled.add(match[1]!);
  }
  // הצורה בלולאה: FOREACH t IN ARRAY ARRAY[ 'a', 'b', … ]
  for (const block of sql.matchAll(/FOREACH\s+\w+\s+IN ARRAY ARRAY\[([^\]]+)\]/gu)) {
    for (const name of block[1]!.matchAll(/'(\w+)'/gu)) enabled.add(name[1]!);
  }
  // מה שבוטל במפורש אינו תחת RLS (outbox_events)
  for (const match of sql.matchAll(
    new RegExp(String.raw`ALTER TABLE\s+${TABLE}\s+DISABLE ROW LEVEL SECURITY`, "gu"),
  )) {
    enabled.delete(match[1]!);
  }
  return enabled;
}

/**
 * הטבלאות שנופלות מאליהן עם שורת המשרד — `ON DELETE CASCADE`.
 *
 * מחיקת משרד מסתיימת ב-`tenant.delete`, ולכן טבלה שה-FK שלה אל
 * `tenants` הוא CASCADE **נמחקת גם בלי `deleteMany` מפורש**. בדיקת
 * הכיסוי שלא ידעה זאת הייתה דורשת שורות מיותרות בשם „שלמות” — וזה
 * ההפך מהמטרה: רשימה שמלאה בשורות שאינן עושות דבר היא רשימה שאיש
 * לא קורא, ושבה שורה חסרה נבלעת.
 *
 * שתי הצורות שקיימות במיגרציות: הצהרה בתוך `CREATE TABLE`, והוספה
 * מאוחרת ב-`ALTER TABLE … ADD CONSTRAINT`. הקריאה היא „מי שהוצהר
 * אחרון קובע”, כי אילוץ יכול להיות מוחלף — הסדר נגזר משמות
 * המיגרציות, שנושאות חותמת זמן.
 *
 * ‏`ON DELETE RESTRICT` (‏`users`, `properties`) אינו נספר: הן
 * חייבות להימחק במפורש, וכך הן אכן נמחקות.
 */
export function cascadingFromTenants(prismaDir: string): Set<string> {
  const sql = migrationSql(prismaDir);
  /** טבלה ⟵ האם ההצהרה **האחרונה** עליה היא CASCADE. */
  const verdict = new Map<string, boolean>();

  /*
   * מעבר אחד על שתי הצורות יחד, כדי ש-`matchAll` יחזיר אותן בסדר
   * המסמך. שני מעברים נפרדים היו מאבדים את הסדר ביניהן, וההכרעה
   * „מי שהוצהר אחרון קובע” הייתה תלויה במקרה.
   */
  const declaration = new RegExp(
    [
      // ALTER TABLE "x" … FOREIGN KEY ("tenant_id") REFERENCES "tenants" … ;
      String.raw`ALTER TABLE\s+${TABLE}[\s\S]{0,300}?FOREIGN KEY\s*\(\s*"?tenant_id"?\s*\)\s*REFERENCES\s+"?tenants"?[^;]*;`,
      // CREATE TABLE "x" ( … );
      String.raw`CREATE TABLE\s+(?:IF NOT EXISTS\s+)?${TABLE}\s*\(([\s\S]*?)\n\);`,
    ].join("|"),
    "gu",
  );

  for (const match of sql.matchAll(declaration)) {
    const altered = match[1];
    if (altered !== undefined) {
      verdict.set(altered, /ON DELETE CASCADE/u.test(match[0]));
      continue;
    }
    const created = match[2];
    const body = match[3];
    if (created === undefined || body === undefined) continue;
    const column = body
      .split("\n")
      .find((line) => /"?tenant_id"?/u.test(line) && /REFERENCES\s+"?tenants"?/u.test(line));
    if (column !== undefined) verdict.set(created, /ON DELETE CASCADE/u.test(column));
  }

  return new Set([...verdict].filter(([, cascades]) => cascades).map(([table]) => table));
}

/**
 * שם הטבלה ⟵ שם המאפיין ב-Prisma Client.
 *
 * `model PropertyMedia { … @@map("property_media") }` ⟵ `propertyMedia`.
 *
 * `requireTenantId` מסנן למודלים שיש בהם שדה `tenantId`. טבלה
 * משותפת לשני משרדים — `coop_deals` עם `listingTenantId`, או
 * `coop_deal_messages` עם `authorTenantId` — אינה שייכת לדייר אחד,
 * ואין עליה `deleteMany({ where: { tenantId } })` שאפשר לכתוב בכלל.
 */
export function accessorsByTable(
  prismaDir: string,
  options: { requireTenantId?: boolean } = {},
): Map<string, string> {
  const schema = readFileSync(join(prismaDir, "schema.prisma"), "utf8");
  const byTable = new Map<string, string>();
  for (const block of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/gu)) {
    const model = block[1]!;
    const body = block[2]!;
    if (options.requireTenantId === true && !/^\s*tenantId\s/mu.test(body)) continue;
    const mapped = /@@map\("(\w+)"\)/u.exec(body)?.[1];
    byTable.set(mapped ?? model, model.charAt(0).toLowerCase() + model.slice(1));
  }
  return byTable;
}
