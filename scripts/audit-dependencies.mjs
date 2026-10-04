#!/usr/bin/env node
/**
 * ‏סריקת פגיעויות בתלויות — נכשלת על ממצא, לא על הרשת.
 *
 * ## מה קרה
 *
 * ‎`pnpm audit --audit-level high` שולח את קובץ הנעילה לשרת של npm
 * ומחכה לתשובה. ב-3 בספטמבר נקודת הקצה `audits/quick` הפסיקה להגיב
 * למשך שעתיים וחצי, וחזרה ליפול למחרת בבוקר — ובכל אחת מהפעמים
 * ‎`verify` נצבע אדום על שבעה PR-ים שאף אחד מהם לא נגע ב-`package.json`
 * ולא ב-`pnpm-lock.yaml`.
 *
 * זה גרוע פעמיים. פעם אחת כי CI אדום עוצר מיזוגים בלי סיבה, ופעם
 * שנייה — והחמורה — כי אדום שחוזר על עצמו בלי קשר לשינוי מלמד את
 * הקוראים להתעלם ממנו. שער שמתעלמים ממנו אינו שער.
 *
 * ## מה השתנה, ומה **לא**
 *
 * ‎**הסף לא זז.** פגיעות ברמה high או critical עדיין מפילה את
 * הבנייה, בדיוק כמו קודם. מה שהשתנה הוא שכשל **רשת** מזוהה ככשל
 * רשת: אזהרה גלויה ב-CI ויציאה 0, במקום בנייה אדומה.
 *
 * ‎**המחיר, במפורש:** בחלון שבו npm למטה הסריקה אינה מתבצעת, ולכן
 * פגיעות חדשה שפורסמה בדיוק אז לא תיתפס במיזוג הזה. זו הסיבה
 * ש-`.github/workflows/audit.yml` מריץ את אותה סריקה כל בוקר במצב
 * חמור (`--require-report`): אם התקלה נמשכת, מישהו יראה כישלון על
 * סבב יומי — במקום שכולם יראו אדום על כל PR ויפסיקו להסתכל.
 *
 * ‎**מה שאינו כשל רשת מפיל.** דוח שנקרא והצליח, פלט שאי אפשר לפרש,
 * או שגיאה שאינה מוכרת — כולם יוצאים 1. הפיתוי היה לכתוב
 * ‎`|| true` על הפקודה; זה היה מכבה את השער לגמרי, כולל על ממצא
 * אמיתי, וזה בדיוק מה שאסור.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** רמות שהשער נכשל עליהן. */
const BLOCKING = new Set(["high", "critical"]);

/**
 * ‏חתימות של כשל רשת אל הרג'יסטרי.
 *
 * ‏רשימה סגורה ולא „כל מה שאין בו JSON”: שגיאה שאיננו מכירים חייבת
 * להפיל, אחרת השער מכבה את עצמו על כל תקלה עתידית שלא חשבנו עליה.
 */
const NETWORK_SIGNS = [
  "ERR_SOCKET_TIMEOUT",
  "ERR_PNPM_REGISTRIES_UNAVAILABLE",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "socket hang up",
  "Socket timeout",
  "network timeout",
  "request to https://registry",
  "FetchError",
];

/**
 * ‏מה קרה בפועל — `report` (התקבל דוח), `network` (לא הגענו לשרת),
 * או `unknown` (כל השאר).
 *
 * ‏פונקציה טהורה ומיוצאת כדי שאפשר יהיה לבדוק אותה בלי רשת: זה
 * הלב של השער, ושער שלא נבדק מדווח „נקי” על מה שאיש לא בדק.
 */
export function classifyAudit(stdout, stderr) {
  const report = parseReport(stdout);
  if (report !== null) return { kind: "report", report };
  const haystack = `${stdout}\n${stderr}`;
  if (NETWORK_SIGNS.some((sign) => haystack.includes(sign))) return { kind: "network" };
  return { kind: "unknown" };
}

/**
 * ‏הדוח מתוך הפלט, או `null`.
 *
 * ‎`pnpm audit --json` מדפיס אובייקט אחד, אבל אזהרות של pnpm יכולות
 * להתערבב לפניו — ולכן הפירוק מתחיל מהסוגר המסולסל הראשון ולא
 * מתחילת המחרוזת.
 */
function parseReport(stdout) {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start));
    /*
      ‏`metadata.vulnerabilities` הוא מה שמאשר שזה דוח ולא JSON אחר
      שבמקרה נמצא בפלט. בלי הבדיקה הזו הודעת שגיאה בפורמט JSON
      הייתה נקראת כדוח ריק — כלומר „אין פגיעויות”.
    */
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof parsed.metadata?.vulnerabilities !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * ‏כמה פגיעויות חוסמות יש בדוח — אחרי הפגיעויות שהוחרגו במפורש.
 *
 * ‎**החרגה היא רק לפגיעות שאין לה תיקון**, ורשומה ב-
 * ‎`pnpm.auditConfig.ignoreGhsas` שב-`package.json` עם הנימוק כאן
 * ‏למטה (`IGNORED_REASONS`). pnpm עצמו מכבד אותה: הוא משמיט אותה
 * ‏מרשימת `advisories` ויוצא 0 — אבל ממשיך לספור אותה ב-
 * ‎`metadata.vulnerabilities`. לכן הספירה כאן מנכה את ההחרגות, **ולא
 * ‏יותר ממספרן**: דוח שהספירה בו עולה על מה שהוחרג נכשל גם אם pnpm
 * ‏שינה את פורמט הרשימה — השער לא יעבור בשקט על פגיעות שאיש לא החריג.
 */
export function blockingCount(report, ignoredGhsas = []) {
  const counts = report.metadata.vulnerabilities;
  let counted = 0;
  for (const [level, count] of Object.entries(counts)) {
    if (BLOCKING.has(level)) counted += Number(count) || 0;
  }
  const listed = Object.values(report.advisories ?? {}).filter((advisory) =>
    BLOCKING.has(String(advisory?.severity)),
  ).length;
  const ignored = Math.min(Math.max(counted - listed, 0), ignoredGhsas.length);
  return counted - ignored;
}

/**
 * ‏למה כל החרגה קיימת. כל מזהה ב-`ignoreGhsas` חייב שורה כאן (הבדיקה
 * ‏אוכפת), וכל שורה נמחקת ביום שיוצא תיקון — ההחרגה מודפסת כאזהרה בכל
 * ‏ריצה של ה-CI כדי שלא תישכח.
 */
export const IGNORED_REASONS = {
  "GHSA-86w9-cpqp-85rv":
    "node-forge ≤1.4.0 (אימות חתימת RSA) — אין גרסה מתוקנת. מגיע רק דרך @expo/cli, כלי הבנייה של אפליקציית המובייל; אינו בשום תמונת שרת.",
  "GHSA-vfj7-8cjw-p6xm":
    "braces ≤3.0.3 (מניעת שירות בתבנית מקוננת) — אין גרסה מתוקנת. מגיע רק דרך @expo/cli ‏(metro-file-map); התבניות הן של הפרויקט, לא של משתמש.",
};

/** ‏ההחרגות מ-`package.json` — מקור אחד, זה ש-pnpm עצמו קורא. */
export function ignoredGhsas(packageJson) {
  const list = packageJson?.pnpm?.auditConfig?.ignoreGhsas;
  return Array.isArray(list) ? list.map(String) : [];
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (err) => resolve({ code: 1, stdout, stderr: `${stderr}\n${String(err)}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function main() {
  /*
    ‎`--require-report` — מצב הסבב היומי: תקלת רשת נחשבת כישלון.
    בסבב שרץ פעם ביום אפשר לדרוש תשובה; בשער שרץ על כל PR אי אפשר.
  */
  const strict = process.argv.includes("--require-report");

  /*
    ‎**ניסיון אחד, ולא לולאה משלנו.**

    ‏`pnpm audit` כבר חוזר שלוש פעמים בעצמו, עם המתנה של 10 שניות
    ואז דקה — כלומר קריאה אחת שנכשלת לוקחת כשלוש דקות וחצי. לולאת
    ניסיונות נוספת מעל זה הייתה מכפילה את הזמן פי שלושה בדיוק
    במקרה שבו ידוע מראש שהתשובה לא תגיע.
  */
  const { stdout, stderr } = await run("pnpm", ["audit", "--audit-level", "high", "--json"]);
  const result = classifyAudit(stdout, stderr);

  if (result.kind === "report") {
    const ignored = ignoredGhsas(JSON.parse(readFileSync("package.json", "utf8")));
    const blocking = blockingCount(result.report, ignored);
    if (blocking > 0) {
      console.error(`✗ ${blocking} פגיעויות ברמה high/critical בתלויות`);
      console.error(JSON.stringify(result.report.metadata.vulnerabilities));
      console.error("להריץ `pnpm audit --audit-level high` מקומית ולעדכן את החבילה.");
      process.exit(1);
    }
    for (const ghsa of ignored) {
      console.log(
        `::warning title=פגיעות מוחרגת ${ghsa}::${IGNORED_REASONS[ghsa] ?? "בלי נימוק"} — להסיר מ-pnpm.auditConfig.ignoreGhsas כשיוצא תיקון.`,
      );
    }
    console.log("✓ אין פגיעויות ברמה high/critical בתלויות");
    return;
  }

  if (result.kind === "unknown") {
    console.error("✗ הסריקה נכשלה בשגיאה שאינה תקלת רשת מוכרת:");
    console.error(stderr.trim() || stdout.trim());
    process.exit(1);
  }

  /*
    ‏לא הגענו לשרת. בסבב היומי זה כישלון; בשער של PR זו אזהרה, כי
    הכשל אינו בקוד שנבדק ואדום כזה רק מלמד להתעלם.
  */
  const message =
    "‏שרת ה-audit של npm לא הגיב — התלויות לא נסרקו בריצה הזו.";
  if (strict) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.log(`::warning title=סריקת תלויות לא רצה::${message}`);
  console.log("⚠ הסבב היומי ב-audit.yml יסרוק שוב, ויכשל אם התקלה נמשכת.");
}

/*
  ‏רץ רק כשהקובץ הוא נקודת הכניסה — כדי שאפשר יהיה לייבא את
  `classifyAudit` בבדיקה בלי להפעיל את הסריקה.
*/
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
