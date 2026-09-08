#!/usr/bin/env node
/**
 * ‎**מסך אינו מבקש יותר ממה שהשער מקבל.**
 *
 * ‏סכימות הרשימה בשרת הן `.strict()` עם `max(PAGE_LIMIT_MAX)`.
 * ‏בקשה עם `limit` גדול יותר נדחית ב-400 **ולא מגיעה לשירות בכלל**,
 * ‏והמסך מציג „לא נמצאו” על מאגר מלא — כישלון שנראה בדיוק כמו
 * ‏רשימה ריקה.
 *
 * ‎**זה קרה פעמיים.** `property-twins` נפל על `limit=200` ותוקן,
 * ‏עם הערה שאומרת ש-`PAGE_LIMIT_MAX` הוא מקור האמת „כדי שהשניים
 * ‏לא יוכלו להיפרד שוב”. חלון „הצעת נכס לקונה” נכתב אחריו והמציא
 * ‏את אותו `200` מחדש. הערה אינה אכיפה; זה כן.
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

const offenders = [];
for (const path of files(SRC)) {
  const src = readFileSync(path, "utf8");
  for (const match of src.matchAll(/limit=(\d+)/gu)) {
    const asked = Number(match[1]);
    if (asked > max) offenders.push(`${path.slice(SRC.length + 1)}: limit=${asked}`);
  }
}

if (offenders.length > 0) {
  console.error(`✗ מסך מבקש יותר מ-${max}, והבקשה תידחה בשער:`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`✓ אף מסך אינו מבקש יותר מ-${max}`);
