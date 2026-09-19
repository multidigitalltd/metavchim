#!/usr/bin/env node
/**
 * ‏מגבלות התווים של Play לרישום — נבדקות על `store/listing.md` כדי שטקסט
 * ‏שנערך בעברית לא ייחתך בשקט בהדבקה: שם עד 30, תיאור קצר עד 80, תיאור
 * ‏מלא עד 4,000. הבלוקים הם ה-``` שאחרי כל כותרת.
 *
 *   node scripts/check-listing.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, "..", "store", "listing.md"), "utf8");

const LIMITS = [
  ["שם האפליקציה", 30],
  ["תיאור קצר", 80],
  ["תיאור מלא", 4000],
];

let failed = false;
for (const [heading, limit] of LIMITS) {
  const at = text.indexOf(`## ${heading}`);
  const open = text.indexOf("```\n", at);
  const close = text.indexOf("\n```", open + 4);
  if (at < 0 || open < 0 || close < 0) {
    console.error(`✗ ${heading}: הבלוק לא נמצא`);
    failed = true;
    continue;
  }
  const value = text.slice(open + 4, close);
  const length = [...value].length;
  const ok = length <= limit;
  console.log(`${ok ? "✓" : "✗"} ${heading}: ${length}/${limit}`);
  if (!ok) failed = true;
}
process.exit(failed ? 1 : 0);
