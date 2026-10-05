/**
 * ה-Playbook והתבנית לא נפרדים מהמערכת שהם מקימים.
 *
 * ## הכשל שהשער הזה מונע
 *
 * משתנה סביבה חדש נוסף ל-`.env.production.example` וגם ל-compose,
 * ונשכח בתבנית של Ansible. שום דבר לא נשבר בבנייה: ה-Playbook רץ
 * בהצלחה, הקובץ נכתב, והשירות עולה — **בלי המשתנה**. מה שקורה אחר
 * כך תלוי בשירות: או קריסה בעלייה, או, גרוע יותר, יכולת שדוממת
 * בשקט כי הבדיקה שלה מצאה משתנה חסר והחליטה שהיא כבויה.
 *
 * ההצמדה כאן היא בשני הכיוונים. מפתח שקיים בדוגמה ואינו בתבנית
 * ייעלם מהשרת; מפתח שקיים בתבנית ואינו בדוגמה הוא הגדרה שאיש
 * שקורא את הדוגמה לא ידע שהיא קיימת.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const example = readFileSync(join(root, ".env.production.example"), "utf8");
const template = readFileSync(
  join(root, "infra/ansible/templates/env.production.j2"),
  "utf8",
);

/** שמות המשתנים בקובץ — רק הצבות אמיתיות, לא שורות הסבר. */
function keys(text) {
  return new Set(
    [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]),
  );
}

/** מפתחות שהוזכרו בשורת הערה — כך מתועדת יכולת רשות בדוגמה. */
function commentedKeys(text) {
  return new Set(
    [...text.matchAll(/^#\s*([A-Z][A-Z0-9_]*)=/gmu)].map((match) => match[1]),
  );
}

/*
 * שתי רמות, כי יש שני סוגי מפתחות.
 *
 * **חובה** — נכתבים תמיד, ומופיעים בדוגמה כהצבה רגילה. אלה חייבים
 * להתאים אחד לאחד.
 *
 * **רשות** — נכתבים רק כשפרופיל דלוק, ולכן יושבים בתבנית בתוך
 * `{% if %}` ובדוגמה כשורת הערה. השוואה בין השניים בלי ההבחנה
 * הייתה מדווחת על כל מפתח של פרופיל כחסר, והשער היה נכבה.
 */
const conditional = /\{%-?\s*if[\s\S]*?\{%-?\s*endif\s*-?%\}/gu;
const templateRequired = template.replace(conditional, "");
const templateOptional = [...template.matchAll(conditional)].join("\n");

const exampleKeys = keys(example);
const templateKeys = keys(templateRequired);

const missing = [...exampleKeys].filter((key) => !templateKeys.has(key));
const extra = [...templateKeys].filter((key) => !exampleKeys.has(key));

/* מפתח רשות שאינו מתועד בדוגמה — קיים בשרת ואיש אינו יודע עליו */
const documented = commentedKeys(example);
const undocumented = [...keys(templateOptional)].filter(
  (key) => !documented.has(key) && !exampleKeys.has(key),
);

if (exampleKeys.size === 0) {
  console.error("✗ לא נמצא אף משתנה ב-.env.production.example — הסריקה שבורה");
  process.exit(1);
}

if (missing.length > 0 || extra.length > 0 || undocumented.length > 0) {
  console.error("✗ תבנית הסביבה של Ansible אינה תואמת ל-.env.production.example:\n");
  for (const key of missing) console.error(`  חסר בתבנית: ${key}`);
  for (const key of extra) console.error(`  קיים בתבנית ואינו בדוגמה: ${key}`);
  for (const key of undocumented) {
    console.error(`  מפתח רשות שאינו מתועד בדוגמה: ${key}`);
  }
  console.error("");
  process.exit(1);
}

console.log(
  `✓ ${exampleKeys.size} משתני חובה ו-${keys(templateOptional).size} של פרופילי רשות — הדוגמה והתבנית תואמות`,
);

/*
 * ================================================================
 * שני סקריפטי ההקצאה של תפקיד האפליקציה — **אותן הרשאות בדיוק.**
 *
 * `infra/postgres/init-app-role.sh` רץ בעליית מסד הייצור,
 * `apps/api/prisma/sql/create_app_role.sql` רץ בפיתוח וב-CI, והוא
 * מצהיר על עצמו בהערה כמקבילה של הראשון. הם נפרדו: לייצור הייתה
 * שורת ברירת מחדל לרצפים ולפיתוח לא, ולכן `tenant_customer_no_seq`
 * — ואיתו כל יצירת משרד — נפל על `permission denied for sequence`
 * על כל מסד פיתוח שכבר הוקצה.
 *
 * הכשל הזה שקט לגמרי עד שנוצר הרצף הראשון אחרי ההקצאה, ולכן הוא
 * בדיוק מה ששער צריך לתפוס. אותה משפחה כמו ההצמדה שמעל: שני
 * קבצים שחייבים לומר את אותו דבר על אותה מערכת.
 *
 * מושווים ה-GRANT וברירות המחדל בלבד. ה-REVOKE של הטבלאות
 * ה-Append-Only חי רק בקובץ ה-SQL, בכוונה ובהסבר: בייצור הוא
 * מגיע מהמיגרציות עצמן.
 * ================================================================
 */
const roleSql = readFileSync(
  join(root, "apps/api/prisma/sql/create_app_role.sql"),
  "utf8",
);
const roleSh = readFileSync(join(root, "infra/postgres/init-app-role.sh"), "utf8");

/**
 * הצהרות ההרשאה בקובץ, מנורמלות.
 *
 * רב-שורתי (`ALTER DEFAULT PRIVILEGES` נכתב בשתי שורות בשני
 * הקבצים), בלי הערות, ורווחים מכווצים — כדי שעימוד שונה לא ייחשב
 * להפרש, ושורה חסרה כן.
 */
function grants(text) {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/^\s*--.*$/gmu, " ")
    .replace(/^\s*#.*$/gmu, " ");
  return new Set(
    [...withoutComments.matchAll(/\b(GRANT|ALTER DEFAULT PRIVILEGES)\b[\s\S]*?;/gu)]
      .map((match) => match[0].replace(/\s+/gu, " ").trim())
      .filter((statement) => statement.includes("metavchim_app")),
  );
}

const sqlGrants = grants(roleSql);
const shGrants = grants(roleSh);

const onlySql = [...sqlGrants].filter((g) => !shGrants.has(g));
const onlySh = [...shGrants].filter((g) => !sqlGrants.has(g));

if (sqlGrants.size === 0 || shGrants.size === 0) {
  console.error("✗ לא נמצאה אף הצהרת GRANT באחד מסקריפטי ההקצאה — הסריקה שבורה");
  process.exit(1);
}

if (onlySql.length > 0 || onlySh.length > 0) {
  console.error("✗ שני סקריפטי ההקצאה של metavchim_app אינם מעניקים את אותן הרשאות:\n");
  for (const g of onlySql) console.error(`  רק ב-create_app_role.sql: ${g}`);
  for (const g of onlySh) console.error(`  רק ב-init-app-role.sh:   ${g}`);
  console.error("");
  process.exit(1);
}

console.log(`✓ ${sqlGrants.size} הרשאות — שני סקריפטי ההקצאה של תפקיד האפליקציה זהים`);
