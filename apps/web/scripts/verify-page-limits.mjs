#!/usr/bin/env node
/**
 * ‎**בקשה ל-`/properties` לעולם אינה מבקשת יותר ממה שהשער מקבל.**
 *
 * ‏הסכימה של `/properties` היא `.strict()` עם `max(PAGE_LIMIT_MAX)`.
 * ‏בקשה גדולה יותר נדחית ב-400 **ולא מגיעה לשירות בכלל**, והמסך
 * ‏מציג „לא נמצאו” על מאגר מלא — כישלון שנראה בדיוק כמו רשימה
 * ‏ריקה. זה קרה פעמיים: `property-twins` ואחריו בורר „הצעת נכס
 * ‏לקונה”, שנכתב אחרי התיקון והמציא את אותו `200` מחדש.
 *
 * ‎**מדוע רק `/properties`, ולא כל בקשה.**
 *
 * ‏הניסוח הראשון השווה **כל** `limit` בקוד לתקרה של `/properties`,
 * ‏ובכך היה שגוי בשני הכיוונים: `/matches` מתיר 200 כדין, ולכן
 * ‏כתיבה מפורשת של המספר שם הייתה נכשלת; ומנגד הוא דילג על
 * ‏`limit=${LIST_LIMIT}` — כלומר החמיץ בדיוק את הצורה שהוא בא
 * ‏למנוע (ביקורת Codex).
 *
 * ‏לכל נתיב תקרה משלו, ושער טקסטואלי אינו יכול לפתור ניתוב. מה
 * ‏שהוא כן יכול לטעון הוא הטענה הצרה והנכונה: הנתיב **הזה**, שכבר
 * ‏הפיל שני מסכים, מול הקבוע **שלו**.
 *
 * ‎**ומה שאי אפשר להכריע — נכשל, לא מדולג.** ערך שאינו נפתר לכדי
 * ‏מספר הוא „לא ידוע”, ושתיקה עליו הייתה מחזירה את החור המקורי.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const SHARED = join(HERE, "..", "..", "..", "packages", "shared", "src", "schemas", "common.ts");

/** ‏התקרה נקראת מהמקור ולא משוכפלת — אחרת גם השער יתיישן. */
const max = Number(/PAGE_LIMIT_MAX = (\d+)/u.exec(readFileSync(SHARED, "utf8"))?.[1]);
if (!Number.isInteger(max)) {
  console.error("✗ לא נמצא PAGE_LIMIT_MAX בסכימות המשותפות");
  process.exit(1);
}

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (/\.tsx?$/u.test(entry.name)) out.push(path);
  }
  return out;
}

/** ‏מספר, או קבוע מקומי שהוצב ממספר או מהתקרה עצמה. */
function resolve(token, src) {
  if (/^\d+$/u.test(token)) return Number(token);
  const name = /^\$\{(\w+)\}$/u.exec(token)?.[1];
  if (name === undefined) return null;
  if (name === "PAGE_LIMIT_MAX") return max;
  const assigned = new RegExp(String.raw`const ${name}\s*=\s*([^;]+);`, "u").exec(src)?.[1]?.trim();
  if (assigned === undefined) return null;
  if (/^\d+$/u.test(assigned)) return Number(assigned);
  return assigned === "PAGE_LIMIT_MAX" ? max : null;
}

const offenders = [];
for (const path of files(SRC)) {
  const src = readFileSync(path, "utf8");
  /* ‏רק בקשות שהנתיב שלהן הוא `/properties` — ולא תת-נתיב אחר. */
  for (const [, token] of src.matchAll(/["'`]\/properties\?[^"'`]*limit=(\d+|\$\{\w+\})/gu)) {
    const asked = resolve(token, src);
    const where = path.slice(SRC.length + 1).replace(/\\/gu, "/");
    if (asked === null) offenders.push(`${where}: limit=${token} — לא ניתן להכריע, השתמשו בקבוע`);
    else if (asked > max) offenders.push(`${where}: limit=${asked} > ${max}`);
  }
}

if (offenders.length > 0) {
  console.error(`✗ בקשה ל-/properties מעל ${max} תידחה בשער:`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`✓ כל בקשה ל-/properties נשארת בתוך ${max}`);
