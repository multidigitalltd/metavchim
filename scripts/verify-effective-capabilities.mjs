#!/usr/bin/env node
/**
 * ‎**הרשאה לפעולת סוכן נגזרת מהיכולות בפועל — לא מהתפקיד.**
 *
 * ## הכשל שהשער הזה מקבע
 *
 * ‎`ROLE_CAPABILITIES[role]` היא **נקודת הפתיחה בלבד**. מעליה יושבות
 * שתי שכבות שהמערכת מפעילה בכל בדיקת הרשאה אמיתית:
 * חריגי `userCapability` פר-משתמש (`resolveCapabilities`), וחסימת
 * מודולים של המשרד (`applyBlockedModules`). כך בונה אותן
 * ‎`auth.service`, וכך בונה אותן `buildContext` של הסוכן — זה
 * המסלול שירוץ בפועל ברגע שמישהו לוחץ.
 *
 * קורא שגוזר מהתפקיד בלבד חולק על המסלול הזה בשני הכיוונים, ולשניהם
 * יש קורבן:
 *
 * ‎**חריג `deny` או מודול חסום** ⟵ מוצעת פעולה שהשרת ידחה, כלומר
 * המערכת שולחת את המשתמש אל „אין לך הרשאה” על משהו שהיא הציעה.
 *
 * ‎**חריג `grant`** ⟵ יכולת שניתנה במפורש אינה מגיעה למסך.
 *
 * שני המקרים שקטים לחלוטין: אין שגיאה, אין לוג, ואין בדיקה אדומה.
 * הם נראים רק אצל המשרד שהגדיר חריג — כלומר בייצור.
 *
 * ## הטענה
 *
 * קובץ שקורא ל-`mayUseAction` אינו בונה את קבוצת היכולות
 * מ-`ROLE_CAPABILITIES`. או שהוא מקבל אותה מוכנה
 * (`ctx.capabilities`, `TenantContext.current()`), או שהוא בונה
 * אותה במסלול המלא — `resolveCapabilities` ואז `applyBlockedModules`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/api/src", "apps/workers/src"];

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

const callers = files.filter((f) => /\bmayUseAction\s*\(/u.test(f.code));

if (callers.length === 0) {
  console.error("✗ לא נמצא אף קורא ל-mayUseAction — השער מכוון לקוד שאינו קיים עוד");
  process.exit(1);
}

/*
 * ‎`ROLE_CAPABILITIES[` ולא רק השם: `resolveCapabilities` עצמה
 * מייבאת אותו, וזה בדיוק השימוש הנכון. מה שנאסר הוא **קריאת
 * המפה ישירות** בקובץ שגם מחליט לפי `mayUseAction`.
 */
const offenders = callers.filter((f) => /ROLE_CAPABILITIES\s*\[/u.test(f.code));

if (offenders.length > 0) {
  console.error("✗ הרשאת פעולה שנגזרת מהתפקיד בלבד:");
  for (const f of offenders) console.error(`  ${f.path}`);
  console.error(
    "\n  היכולות בפועל = applyBlockedModules(resolveCapabilities(role, overrides, now), blockedModules)",
  );
  process.exit(1);
}

console.log(`✓ ${callers.length} קוראים ל-mayUseAction, כולם על יכולות בפועל`);
