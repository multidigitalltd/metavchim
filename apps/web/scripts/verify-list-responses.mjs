/**
 * רשימה שהגיעה מהשרת — **או תקלה, ולא „ריק”.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‎`apiGet<{ coupons: Coupon[] }>` הוא הצהרת טיפוס בלבד. הקומפיילר
 * מאמין לה, ובזמן ריצה אין מי שיבדוק — תשובה שחזרה בלי השדה מפילה
 * את המסך ב-`.map` על `undefined`. השמירה הראשונה שהוצבה כאן הייתה
 * ‎`?? []`, וזו השמירה הלא נכונה: היא הופכת תשובה פגומה ל"רשימה
 * ריקה", ובדיוק המסכים האלה מבחינים בין ריק לכשל.
 *
 * מה שזה עשה בפועל: „עדיין אין קופונים” על תשובה פגומה — מנהל
 * פלטפורמה קורא את זה, ויוצר מחדש קוד קופון שכבר קיים (ביקורת
 * Codex). אותו דפוס בדיוק ב"אין מסלולים" במסך ההרשמה, וב"אין
 * חיבורים נוספים" בשומר החיבור היחיד — שם השקר הוא **ביטול שקט של
 * אכיפה**, לא רק כיתוב.
 *
 * ## מה נאכף כאן
 *
 * שדה חסר הוא **כשל טעינה**. `apiList` זורק, הזריקה נופלת ל-`catch`
 * שכבר קיים אצל הקורא — אותו מסלול של תקלת רשת — והמסך מציג „לא
 * הצלחנו לטעון” עם כפתור לנסות שוב.
 *
 * השער סורק את הקוד ומוצא **את המזהים שקיבלו תשובת שרת** (פרמטר של
 * ‎`.then`, או `await api…`), ואוסר עליהם `?? []`. כך גם קורא חדש
 * שייכתב מחר ייתפס, ולא רק מה שתוקן היום.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** הערות מוסרות לפני כל גריפ — טקסט הסבר אינו קוד. */
const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/u.test(name)) files.push(path);
  }
})(SRC);

const problems = [];

/* 1 · העוזר עצמו זורק, ולא מחזיר רשימה ריקה בשקט */
const api = strip(readFileSync(join(SRC, "lib/api.ts"), "utf8"));
const helper = api.slice(api.indexOf("export function apiList"));
if (helper === "") {
  problems.push("lib/api.ts אינו מייצא את apiList — אין למה להפנות את הקוראים");
} else {
  const body = helper.slice(0, helper.indexOf("\n}\n") + 1);
  if (!/throw new ApiError/u.test(body)) {
    problems.push("apiList אינו זורק — שדה חסר חוזר להיות „ריק” במקום „נכשל”");
  }
  if (/return \[\]/u.test(body)) {
    problems.push("apiList מחזיר [] על שדה חסר — זו בדיוק התקלה שהוא נועד למנוע");
  }
}

/*
 * 2 · אף תשובת שרת אינה מנורמלת ל-`[]`.
 *
 * המזהים נגזרים מהקוד ולא נכתבים כאן: פרמטר של `.then` (גם דרך
 * עוטף כמו `ok(...)`) ומשתנה שקיבל `await api…`. שני אלה הם כל
 * הדרכים שבהן תשובת שרת מגיעה לידיים במסכים.
 */
const BINDERS = [
  /\.then\(\s*(?:\w+\()?\s*\(?\s*(\w+)\s*[:,)]/gu,
  /\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*await\s+api(?:Get|Post|Patch|Put|Delete)?\b/gu,
];

for (const path of files) {
  const rel = relative(SRC, path);
  if (rel === "lib/api.ts") continue;
  const src = strip(readFileSync(path, "utf8"));
  const bound = new Set();
  for (const pattern of BINDERS) {
    for (const match of src.matchAll(pattern)) bound.add(match[1]);
  }
  /*
   * שדה שהוצהר **אופציונלי** (`warnings?:`) רשאי ליפול ל-`[]`: שם
   * „חסר” הוא תשובה חוקית ולא תשובה פגומה, ושער שיאסור גם עליו
   * ילמד את הקוראים לעקוף אותו. רק שדה שהוצהר חובה — או שלא הוצהר
   * כלל — הוא הבטחה שהופרה.
   */
  const optional = new Set([...src.matchAll(/^\s*(\w+)\?\s*:/gmu)].map((m) => m[1]));
  for (const name of bound) {
    const normalizes = new RegExp(`\\b${name}\\.(\\w+)\\s*\\??\\.?\\s*\\?\\?\\s*\\[\\]`, "gu");
    for (const match of src.matchAll(normalizes)) {
      if (optional.has(match[1])) continue;
      problems.push(
        `${rel}: \`${name}.${match[1]} ?? []\` הופך תשובה פגומה ל„ריק” — יש להעביר ב-apiList`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("✗ תשובת שרת חסרה מוצגת כרשימה ריקה:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

const users = files.filter((p) => /\bapiList\(/u.test(readFileSync(p, "utf8"))).length;
console.log(`✓ ${users} מסכים מאמתים רשימות מהשרת · שדה חסר נופל למסלול הכשל ולא ל„אין נתונים”`);
