#!/usr/bin/env node
/**
 * ‎**טופס ההרשמה והשרת בודקים באותה סכימה — לא בשתי העתקות שלה.**
 *
 * ‏הבאג שנסגר: „לקוחות מתלוננים שלא ניתן לפתוח חשבון חינמי, זה
 * ‏כותב קלט לא תקין”. הטופס הוא `noValidate` (בכוונה, כדי שהודעות
 * ‏השגיאה יהיו בעברית), ולכן `required`, `minLength` ו-`type="email"`
 * ‏שעל השדות לא עצרו דבר; הסכימה האמיתית ישבה בבקר לבדה, והמסך
 * ‏הציג את מה שחזר ממנה — „קלט לא תקין”, בלי לומר איזה שדה.
 *
 * ‏בתוך אותו מסך כבר היה הפתרון: שלב הקוד משתמש ב-`normalizeSignupCode`
 * ‏המשותף, ולכן הכפתור נדלק בדיוק כשהשרת יקבל. שלב הפרטים לא.
 *
 * ‎**מה השער טוען, ומה הוא לא.** הוא אינו יודע לקרוא ולידציה; הוא
 * ‏טוען את הטענה הצרה שנשברה: שני הקבצים האלה — המסך והבקר —
 * ‏מזכירים את הסכימה המשותפת, ואף אחד מהם אינו מחזיק תבנית טלפון
 * ‏פרטית משלו. תבנית פרטית היא בדיוק מה שפסל `(054) 1234567`
 * ‏ו-`054.123.4567` בזמן שכל שאר המערכת קיבלה אותם.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

const SCHEMA = "SignupInputSchema";
/** ‏תבנית שמנסה לתאר מספר טלפון בעצמה, במקום לקרוא לנרמול המשותף. */
const PRIVATE_PHONE = /\/\^?\[?[^/\n]*\\d[^/\n]*\{\d+,\d+\}/u;

const sites = [
  { label: "מסך ההרשמה", path: join(ROOT, "apps", "web", "src", "app", "signup", "page.tsx") },
  {
    label: "בקר ההרשמה",
    path: join(ROOT, "apps", "api", "src", "modules", "signup", "signup.controller.ts"),
  },
];

const offenders = [];
for (const site of sites) {
  const src = readFileSync(site.path, "utf8");
  if (!src.includes(SCHEMA)) offenders.push(`${site.label}: אינו משתמש ב-${SCHEMA} המשותף`);
  const own = src.split("\n").find((line) => PRIVATE_PHONE.test(line) && line.includes("phone"));
  if (own !== undefined) offenders.push(`${site.label}: תבנית טלפון פרטית — ${own.trim()}`);
}

/** ‏והסכימה עצמה קיימת ומיוצאת, אחרת הטענה שלמעלה ריקה מתוכן. */
const shared = readFileSync(join(ROOT, "packages", "shared", "src", "schemas", "signup.ts"), "utf8");
if (!shared.includes(`export const ${SCHEMA}`)) {
  offenders.push(`הסכימה המשותפת אינה מייצאת ${SCHEMA}`);
}

if (offenders.length > 0) {
  console.error("✗ ההרשמה חייבת סכימה אחת למסך ולשרת:");
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`✓ המסך והשרת בודקים הרשמה ב-${SCHEMA} המשותף`);
