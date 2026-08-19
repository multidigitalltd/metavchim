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
