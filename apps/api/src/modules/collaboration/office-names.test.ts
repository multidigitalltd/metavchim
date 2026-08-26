import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KANKO_TENANT_ID } from "./kanko-webhook.controller";
import { isSyntheticTenant } from "./office-names";

/**
 * ‎**„הדייר הזה אינו משרד” — נבדק מול המיגרציות, לא מול הזיכרון.**
 *
 * ‎`officeBadges` שולפת שם משרד לכל מודעה בפיד. ההערה שלה טענה
 * שמזהי דיירים סינתטיים „אינם בטבלה וחוזרים חסרים”, וזו הייתה טענה
 * שגויה: מיגרציית `20260728104732_collaboration` מכניסה שורה בשם
 * „Kanko Network” כעוגן ל-`shared_demands`.
 *
 * התוצאה — הפיד הציג **עוגן במסד** כאילו הוא המשרד שפרסם את הביקוש,
 * ומי שהחליט אם להוציא קרדיט על הצעה קרא שם של משרד שאינו קיים
 * (ביקורת Codex).
 *
 * ‎**מה הבדיקה הזו מחזיקה.** לא את הסינון עצמו — אותו אפשר לקרוא —
 * אלא את **ההנחה שמתחתיו**: שהמזהה הסינתטי הוא בדיוק זה שהמיגרציה
 * מכניסה. מזהה מערכתי נוסף שיוכנס במיגרציה עתידית ולא יסונן יפיל
 * אותה, במקום להופיע בשקט כמשרד תיווך.
 *
 * ‎**מה היא אינה עושה:** אינה מריצה שאילתה. אין הרנס בדיקות
 * ל-`officeBadges` (Prisma, RLS), ולכן זו בדיקה מבנית — באותו דפוס
 * של `network-disclosure` ו-`suggestion-identity`.
 */

const MIGRATIONS = join(import.meta.dirname, "..", "..", "..", "prisma", "migrations");

/** כל שורות ה-INSERT לטבלת `tenants` בכל המיגרציות. */
function seededTenantIds(): string[] {
  const ids: string[] = [];
  for (const entry of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, entry.name, "migration.sql"), "utf8");
    } catch {
      continue;
    }
    if (!/INSERT\s+INTO\s+tenants\b/iu.test(sql)) continue;
    /*
     * המזהים הם ULID בני 26 תווים בתוך `VALUES (...)`. חיפוש התבנית
     * ולא ניתוח SQL: מה שנדרש כאן הוא „אילו מזהי דיירים נזרעים”, ולא
     * הבנה מלאה של המשפט.
     */
    for (const match of sql.matchAll(/'([0-9A-Z]{26})'/gu)) ids.push(match[1]!);
  }
  return [...new Set(ids)];
}

describe("דיירים סינתטיים", () => {
  it("שליפת המזהים מהמיגרציות עובדת, אחרת הבדיקה בודקת רשימה ריקה", () => {
    /*
     * שער על הבדיקה עצמה. בלעדיו שינוי בפורמט המיגרציה היה מרוקן
     * את השולף, וההשוואה למטה הייתה `[] ⊆ []` — בדיקה שעוברת תמיד.
     */
    expect(seededTenantIds().length).toBeGreaterThan(0);
  });

  /*
   * ‎**זו ההנחה שנשברה.** ההערה טענה שהמזהה אינו בטבלה; המיגרציה
   * אומרת אחרת. אם אי-פעם יוסר משם — הסינון מיותר, והבדיקה תיפול
   * ותאמר זאת.
   */
  it("המזהה של Kanko באמת נזרע במיגרציה — ולכן הסינון נחוץ", () => {
    expect(seededTenantIds()).toContain(KANKO_TENANT_ID);
  });

  it("והוא מסונן", () => {
    expect(isSyntheticTenant(KANKO_TENANT_ID)).toBe(true);
  });

  /*
   * ‎**כל דייר שנזרע במיגרציה הוא עוגן ולא משרד.** משרד אמיתי נוצר
   * בהרשמה, לא ב-SQL. מזהה מערכתי חדש שיוכנס ולא יסונן יופיע בפיד
   * כשם של משרד תיווך — וזה בדיוק מה שקרה כאן פעם אחת.
   */
  it("אין דייר שנזרע במיגרציה ואינו מסונן", () => {
    expect(seededTenantIds().filter((id) => !isSyntheticTenant(id))).toEqual([]);
  });

  it("מזהה של משרד רגיל אינו מסונן", () => {
    expect(isSyntheticTenant("01JQZX9K8M4N7P2R5T8V1W3Y6Z")).toBe(false);
  });
});
