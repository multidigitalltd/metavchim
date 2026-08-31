/**
 * שרשרת גיבוי המדיה — הסקריפטים והלוגיקה חייבים להסכים על אותו דבר.
 *
 * ## הכשל שהשער הזה מונע
 *
 * ארכיון מדיה משלים מחזיק **רק** את מה שהשתנה מאז הארכיון המלא. שלוש
 * נקודות שונות צריכות לדעת את זה: `run.sh` שכותב את השמות,
 * `restore.sh` שפורס אותם, ו-`backup-file.ts` שהממשק נשען עליו.
 * הן חיות בשלוש שפות ואין ביניהן טיפוסים משותפים.
 *
 * מה קורה כשהן נפרדות? השם ב-`run.sh` משתנה מ-`_diff` למשהו אחר,
 * `mediaTier` מסווג אותו כ„מלא”, ו-`restore.sh` פורס ארכיון חלקי
 * לתוך אחסון שנמחק זה עתה — **אובדן מדיה בשחזור**, בלי שגיאה אחת
 * בדרך. בדיקות יחידה אינן תופסות את זה: הן בודקות את הלוגיקה, לא
 * את שני הסקריפטים שרצים בקונטיינר בלי Node.
 *
 * לכן שלוש טענות: השמות שנכתבים מסווגים נכון, השחזור יודע לפרוס את
 * המלא לפני המשלים, והניקוי אינו מוחק מלא שמישהו נשען עליו.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/*
 * הסיווג נטען מהבנייה של shared ולא משוכפל כאן: שער שבודק העתק של
 * הלוגיקה עובר גם כשהמקור השתנה. הבנייה רצה לפני השער ב-CI; מקומית,
 * בנייה ישנה הייתה בודקת קוד שכבר לא קיים — ולכן נבדק גם גילה.
 */
const distPath = join(root, "packages/shared/dist/logic/backup-file.js");
const srcPath = join(root, "packages/shared/src/logic/backup-file.ts");
if (statSync(distPath).mtimeMs < statSync(srcPath).mtimeMs) {
  console.error("✗ הבנייה של shared ישנה מהמקור — הריצו pnpm build לפני השער");
  process.exit(1);
}
const { backupKind, mediaTier } = await import(distPath);

const run = readFileSync(join(root, "infra/backup/run.sh"), "utf8");
const restore = readFileSync(join(root, "infra/backup/restore.sh"), "utf8");

/** בלי שורות הערה — טענה שמתקיימת בזכות הסבר בעברית אינה טענה. */
const code = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/u.test(line))
    .join("\n");

const runCode = code(run);
const restoreCode = code(restore);
const errors = [];

/* 1. השמות ש-run.sh כותב — מסווגים נכון על ידי הלוגיקה המשותפת. */
const STAMP = "2026-08-31_0300";
if (!runCode.includes("media_${stamp}_${tier}.tar.gz")) {
  errors.push("run.sh אינו בונה את שם הארכיון מהחותמת ומהדרגה");
}
for (const suffix of ["full", "diff"]) {
  if (!new RegExp(`tier="${suffix}"`, "u").test(runCode)) {
    errors.push(`run.sh אינו מייצר ארכיון מדרגה ${suffix}`);
    continue;
  }
  const name = `media_${STAMP}_${suffix}.tar.gz`;
  if (backupKind(name) !== "media") {
    errors.push(`${name} אינו מסווג כ„מדיה” ב-backup-file.ts`);
  }
  if (mediaTier(name) !== suffix) {
    errors.push(`${name} מסווג כ-${mediaTier(name)} במקום ${suffix}`);
  }
}
/* גם השם שנשמר בקובץ הסימון — עליו נשען הפענוח של „מי הבסיס” */
if (!runCode.includes('printf \'%s\\n\' "media_${stamp}_full.tar.gz" > "$mark_tmp"')) {
  errors.push("run.sh אינו רושם את שם הארכיון המלא בקובץ הסימון");
}

/* 2. restore.sh פורס את המלא **לפני** המשלים. */
if (!/\*_diff\.tar\.gz\)/u.test(restoreCode)) {
  errors.push("restore.sh אינו מזהה ארכיון משלים (_diff)");
} else {
  const basePos = restoreCode.indexOf('tar xzf "/backups/${base}"');
  const filePos = restoreCode.indexOf('tar xzf "/backups/${file}"');
  if (basePos < 0) {
    errors.push("restore.sh אינו פורס כלל את הארכיון המלא שהמשלים נשען עליו");
  } else if (filePos >= 0 && basePos > filePos) {
    errors.push("restore.sh פורס את המשלים לפני המלא — הסדר הפוך");
  }
  if (!/if \[ -z "\$base" \]; then/u.test(restoreCode)) {
    errors.push("restore.sh אינו נעצר כשאין ארכיון מלא למשלים — ישחזר חלקית");
  }
}

/* 3. הניקוי אינו מוחק ארכיון מלא שמשלים נשען עליו. */
const prune = runCode.slice(runCode.indexOf("prune_media() {"));
if (!prune.startsWith("prune_media() {")) {
  errors.push("run.sh אינו מגדיר prune_media");
} else {
  if (!/needed=/u.test(prune) || !/\*" \$\{name\} "\*\) continue/u.test(prune)) {
    errors.push("prune_media מוחק לפי גיל בלבד — משלימים יישארו בלי הבסיס שלהם");
  }
  if (!/\[ "\$name" = "\$newest_full" \] && continue/u.test(prune)) {
    errors.push("prune_media עלול למחוק את הארכיון המלא האחרון");
  }
}

if (errors.length > 0) {
  console.error("✗ שרשרת גיבוי המדיה אינה עקבית:\n");
  for (const error of errors) console.error(`  ${error}`);
  console.error("");
  process.exit(1);
}

console.log("✓ שרשרת גיבוי המדיה — השמות, השחזור והניקוי מסכימים");
