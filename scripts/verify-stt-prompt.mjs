#!/usr/bin/env node
/**
 * ‎**כל מי ששולח אודיו ל-`/transcribe` חייב לצרף רמז אוצר מילים.**
 *
 * ## הכשל שהשער הזה מקבע
 *
 * לשירות התמלול יש שדה `prompt` שעובר ל-`initial_prompt` של המודל,
 * והוא הדבר היחיד שמטה אותו לטובת „ממ״ד” על פני „ממד” ו„בלעדיות”
 * על פני „בעלות”. ההכתבה בדפדפן שלחה אותו מהיום הראשון; **תמלול
 * שיחות הטלפון לא שלח אותו כלל** — כלומר דווקא הצרכן שהאודיו שלו
 * הכי גרוע (טלפוני, צר-פס, שני דוברים) היה היחיד בלי הקשר.
 *
 * זה לא נשבר בשום בדיקה ולא הופיע בשום לוג: התמלול חזר, הוא פשוט
 * היה פחות מדויק. שער טקסטואלי הוא הדרך היחידה לתפוס „נשלח בלי
 * שדה” — התנהגות אמיתית דורשת שירות תמלול חי.
 *
 * ## הטענה
 *
 * בכל קובץ שמרכיב `FormData` ופונה ל-`/transcribe` — יש גם
 * ‎`append("prompt", …)`. לא נבדק *מה* הרמז: זה תוכן, והוא נבדק
 * בבדיקות של `stt-hint`. נבדק שהוא נשלח.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/api/src", "apps/workers/src"];

/** בלי הערות — שער שמסתפק בהערה שמזכירה prompt אינו שער. */
const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith(".ts") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((root) =>
  tsFiles(root).map((path) => ({ path, code: strip(readFileSync(path, "utf8")) })),
);

const senders = files.filter((f) => /\/transcribe`/u.test(f.code) && /new FormData\(\)/u.test(f.code));

if (senders.length === 0) {
  console.error("✗ לא נמצא אף שולח ל-/transcribe — השער מכוון לקוד שאינו קיים עוד");
  process.exit(1);
}

const missing = senders.filter((f) => !/\.append\(\s*"prompt"\s*,/u.test(f.code));

if (missing.length > 0) {
  console.error("✗ שולחים ל-/transcribe בלי רמז אוצר מילים:");
  for (const f of missing) console.error(`  ${f.path}`);
  console.error("\n  הוסיפו form.append(\"prompt\", …) — ראו packages/shared/src/logic/stt-hint.ts");
  process.exit(1);
}

console.log(`✓ ${senders.length} שולחים ל-/transcribe, כולם עם רמז אוצר מילים`);
