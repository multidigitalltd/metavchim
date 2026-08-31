/**
 * כל קובץ סטטי שהקוד מפנה אליו — קיים בפועל.
 *
 * למה שער ולא בדיקה ידנית: תמונה חסרה אינה מפילה בנייה ואינה מפילה
 * טיפוסים. היא מגיעה למשתמש כתמונה שבורה, ומתגלה רק כשמישהו פותח
 * את המסך — במקרה שלנו, מסך ההדרכות הפנה ל-`/guides/agreements.png`
 * שמעולם לא נוצר, וזה עבר `lint`, `typecheck`, `build` וכל 855
 * הבדיקות.
 *
 * הסריקה היא על מחרוזות בקוד ולא על רשימה ידנית: רשימה שצריך לזכור
 * לעדכן היא בדיוק מה שנשכח כאן.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = join(root, "public");
const srcDir = join(root, "src");

/** כל קבצי המקור, רקורסיבית. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    /*
     * גם `.css`. בלעדיו השער החמיץ בדיוק את המקום שבו יושבים
     * הגופנים: `globals.css` מפנה לארבעה קבצי `woff`, והסרת אחד מהם
     * הותירה את הבדיקה מדווחת "הכול תקין" — בעוד שכל הטיפוגרפיה
     * של המערכת נשברת. שער שמדלג על סוג קובץ שלם גרוע משער שאינו
     * קיים, כי הוא מייצר ביטחון (ביקורת Codex).
     */
    else if (/\.(tsx?|mjs|css)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * הסיומות של נכסים שמוגשים מ-public. מוגבלות בכוונה — לא כל מחרוזת
 * שמתחילה בלוכסן, שאחרת כל נתיב ניווט היה נבדק כקובץ.
 */
/*
 * `mjs` נכנס בגלל ה-Worker של MapLibre.
 *
 * הוא נטען בזמן ריצה מ-`public/maplibre`, ולכן נתיב שגוי בו אינו
 * מפיל בנייה ואינו מפיל טיפוסים — הוא מגיע למשתמש כמפה לבנה עם
 * פקדים, בלי שום שגיאה שאפשר להבין. זה בדיוק סוג הכשל שהשער הזה
 * קיים בשבילו, והוא החמיץ אותו בפעם הראשונה.
 */
const EXT = "png|jpe?g|svg|webp|gif|ico|webmanifest|woff2?|mjs|js";

/** ‎"/guides/x.png"‎ — התחביר של TSX. */
const QUOTED = new RegExp(`["'\`](/[^"'\`\\s?#]+\\.(?:${EXT}))["'\`]`, "gu");

/**
 * ‎url(/fonts/x.woff)‎ — התחביר של CSS, עם מרכאות או בלעדיהן.
 *
 * `data:` מסונן: הקובץ מכיל SVG משובץ, ואין שם קובץ לבדוק.
 */
const CSS_URL = new RegExp(
  `url\\(\\s*["'\`]?(/[^)"'\`\\s]+\\.(?:${EXT}))`,
  "gu",
);

const missing = [];
const seen = new Set();

for (const file of sources(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const match of [...text.matchAll(QUOTED), ...text.matchAll(CSS_URL)]) {
    const asset = match[1];
    if (seen.has(asset)) continue;
    seen.add(asset);
    try {
      statSync(join(publicDir, asset));
    } catch {
      missing.push(`${asset}  ←  ${file.replace(`${root}/`, "")}`);
    }
  }
}

if (missing.length > 0) {
  console.error("✗ קבצים סטטיים שהקוד מפנה אליהם ואינם קיימים ב-public:\n");
  for (const m of missing) console.error(`  ${m}`);
  console.error("");
  process.exit(1);
}

/* ============================================================
   התוויות בעברית על המפה — שני התנאים, ושניהם נבדקים
   ============================================================
   התוסף הדו-כיווני של MapLibre נטען רק כששניהם מתקיימים:

   1. הקובץ מוגש בסיומת `.mjs` — אחרת ה-Worker מנסה `globalThis.eval`
      שה-CSP חוסם.
   2. ל-`script-src` יש `wasm-unsafe-eval` — התוסף הוא WebAssembly,
      וההידור שלו חסום בלעדיו.

   כשאחד מהם חסר MapLibre **משמיטה את התוויות העבריות לגמרי** — לא
   מציגה אותן הפוך אלא לא מציגה כלל, בלי שגיאה שהמשתמש יכול להבין.
   זה כבר קרה: תיקון שנגע רק בתנאי הראשון החליף באג בבאג חמור יותר.

   שער ולא הערה, כי אף אחד משני התנאים אינו מפיל בנייה או טיפוסים.
   ============================================================ */

const rtlRefs = [...seen].filter((asset) => asset.includes("mapbox-gl-rtl-text"));
const rtlProblems = rtlRefs
  .filter((asset) => !asset.endsWith(".mjs"))
  .map((asset) => `סיומת שאינה .mjs: ${asset}`);

const middleware = readFileSync(join(srcDir, "middleware.ts"), "utf8");
if (rtlRefs.length > 0 && !middleware.includes("'wasm-unsafe-eval'")) {
  rtlProblems.push("חסר 'wasm-unsafe-eval' ב-script-src שב-middleware.ts");
}

if (rtlProblems.length > 0) {
  console.error("✗ התוויות בעברית על המפה לא ייטענו:\n");
  for (const problem of rtlProblems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

/* ============================================================
   קישורים פנימיים — כל `href` קבוע מצביע על מסך שקיים
   ============================================================
   אותה משפחת כשל כמו קובץ סטטי חסר, ומאותה סיבה בדיוק אינה נתפסת:
   ‎`<a href="/legal/privacy">`‎ עובר קומפילציה, עובר טיפוסים, ומגיע
   למשתמש כ-404. זה קרה בתיעוד הציבורי — שלושה קישורים לעמודים
   משפטיים שיושבים ב-`/privacy` ולא תחת `/legal`.

   רק מחרוזות **קבועות**: נתיב שנבנה בתבנית (`` `/leads/${id}` ``)
   אינו ניתן לבדיקה סטטית, ואינו נסרק. תיקיות דינמיות (`[id]`)
   כן נפתרות, כדי ש-`/leads/123` לא ידווח כשבור.
   ============================================================ */

const appDir = join(srcDir, "app");
/** ‎href="/a/b"‎ — בלי עוגן, בלי שאילתה, בלי תבנית. */
const INTERNAL_HREF = /href="(\/[^"#?${]*)"/gu;

/*
 * ‎`href` שמצביע על קובץ סטטי — ‎`<link rel="preload" href="/fonts/…">`‎ —
 * אינו קישור ניווט ואין לו מסך. הקיום שלו כבר נבדק בשער הקבצים
 * למעלה (הוא נתפס גם ב-QUOTED), ולכן כאן הוא מדולג ולא מדווח כשבור.
 */
const ASSET_HREF = new RegExp(`\\.(?:${EXT})$`, "u");

/** האם לנתיב יש `page` או `route` בנתב של Next. */
function routeExists(href) {
  let dir = appDir;
  for (const part of href.split("/").filter(Boolean)) {
    const direct = join(dir, part);
    if (isDirectory(direct)) {
      dir = direct;
      continue;
    }
    // קטע דינמי — `/leads/123` נפתר ל-`app/leads/[id]`
    const dynamic = readdirSync(dir, { withFileTypes: true }).find(
      (entry) => entry.isDirectory() && entry.name.startsWith("["),
    );
    if (!dynamic) return false;
    dir = join(dir, dynamic.name);
  }
  return ["page.tsx", "page.ts", "route.tsx", "route.ts"].some((file) =>
    exists(join(dir, file)),
  );
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

const deadLinks = [];
const links = new Set();
for (const file of sources(srcDir)) {
  if (!/\.tsx?$/u.test(file)) continue;
  for (const match of readFileSync(file, "utf8").matchAll(INTERNAL_HREF)) {
    const href = match[1];
    if (ASSET_HREF.test(href)) continue;
    const key = `${href}\u0000${file}`;
    if (links.has(key)) continue;
    links.add(key);
    if (!routeExists(href)) {
      deadLinks.push(`${href}  ←  ${file.replace(`${root}/`, "")}`);
    }
  }
}

if (deadLinks.length > 0) {
  console.error("✗ קישורים פנימיים שאין להם מסך:\n");
  for (const link of deadLinks) console.error(`  ${link}`);
  console.error("");
  process.exit(1);
}

/* ============================================================
   כל סעיף מסגרת נכנס גם לקובץ ה-Markdown
   ============================================================
   `/docs` מציע להעתיק „תיעוד המערכת המלא”. סעיף שקיים ברשימת
   התוכן אך לא נשזר ל-`docsMarkdown()` נעלם מהעותק הזה **בשקט** —
   העמוד נראה שלם, הקובץ קצר יותר, ומי שהדביק אותו למודל מקבל
   תשובה שמתעלמת ממה שחסר. בדיוק זה קרה עם „חיבורים ואוטומציה”
   ו„נתונים ופרטיות” (ביקורת Codex).

   אין כאן טיפוס שיאכוף את זה: `docsMarkdown` בוחרת סעיפים לפי
   מזהה, וכל בחירה חלקית תקפה מבחינת TypeScript.
   ============================================================ */

const content = readFileSync(join(srcDir, "lib/guide-content.ts"), "utf8");
const topicsBlock = /export const DOC_TOPICS[^=]*=\s*\[([\s\S]*?)\n\];/u.exec(content);
if (topicsBlock === null) {
  console.error("✗ לא נמצאה רשימת DOC_TOPICS ב-guide-content.ts");
  process.exit(1);
}
const topicIds = [...topicsBlock[1].matchAll(/^\s{4}id: "([^"]+)"/gmu)].map(
  (match) => match[1],
);
const orphanTopics = topicIds.filter((id) => !content.includes(`topic("${id}")`));

if (topicIds.length === 0 || orphanTopics.length > 0) {
  console.error("✗ סעיפי תיעוד שאינם נכנסים לקובץ ה-Markdown המלא:\n");
  for (const id of orphanTopics) console.error(`  ${id}`);
  if (topicIds.length === 0) console.error("  (לא נמצא אף מזהה — הסריקה עצמה שבורה)");
  console.error("");
  process.exit(1);
}

/* ============================================================
   ההדרכות — מזהה, אזור והפניה בין מדריכים
   ============================================================
   ההדרכות התפצלו לעמוד לכל נושא, ומאז יש להן שלוש דרכים להישבר
   בשקט, שכולן עוברות טיפוסים:

   1. ‎`related: ["inbox"]`‎ — מזהה שאינו קיים. הטיפוס הוא `string[]`,
      ולכן שם שהומצא או מזהה שהוחלף מייצר קישור ל-404 בתחתית עמוד.
   2. ‎`area`‎ שאינו ברשימת האזורים — המדריך פשוט לא יופיע באינדקס,
      כי האינדקס בנוי מהאזורים ולא מהרשימה השטוחה.
   3. שני מדריכים עם אותו מזהה — הנתיב הדינמי יציג את הראשון, והשני
      אינו נגיש בשום כתובת.

   כל אחד מהם נראה תקין בקוד ומתגלה רק כשמישהו לוחץ.
   ============================================================ */

const guidesBlock = /export const GUIDES[^=]*=\s*\[([\s\S]*?)\n\];/u.exec(content);
if (guidesBlock === null) {
  console.error("✗ לא נמצאה רשימת GUIDES ב-guide-content.ts");
  process.exit(1);
}
const guideIds = [...guidesBlock[1].matchAll(/^\s{4}id: "([^"]+)"/gmu)].map((m) => m[1]);
const guideAreas = [...guidesBlock[1].matchAll(/^\s{4}area: "([^"]+)"/gmu)].map((m) => m[1]);
const areaKeys = [
  ...(/export const GUIDE_AREAS[\s\S]*?\n\];/u.exec(content)?.[0] ?? "").matchAll(
    /key: "([^"]+)"/gu,
  ),
].map((m) => m[1]);
const related = [
  ...guidesBlock[1].matchAll(/related: \[([^\]]*)\]/gu),
].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/gu)].map((r) => r[1]));

const guideProblems = [];
if (guideIds.length === 0) guideProblems.push("לא נמצא אף מדריך — הסריקה עצמה שבורה");
if (areaKeys.length === 0) guideProblems.push("לא נמצאו אזורים ב-GUIDE_AREAS");
if (guideAreas.length !== guideIds.length) {
  guideProblems.push(`יש ${guideIds.length} מדריכים אבל ${guideAreas.length} אזורים — למישהו חסר \`area\``);
}
for (const id of new Set(guideIds.filter((id, i) => guideIds.indexOf(id) !== i))) {
  guideProblems.push(`מזהה כפול: ${id}`);
}
for (const area of new Set(guideAreas.filter((a) => !areaKeys.includes(a)))) {
  guideProblems.push(`אזור שאינו ברשימה: ${area}`);
}
for (const id of new Set(related.filter((r) => !guideIds.includes(r)))) {
  guideProblems.push(`related מפנה למדריך שאינו קיים: ${id}`);
}

/*
 * ‎**מה שנמצא בקובץ ה-Markdown נמצא גם בעמוד.**
 *
 * `guideMarkdown` פולטת גם `sections` וגם `faq`. עמוד התיעוד
 * הציבורי מציג את מה שה-JSX שלו מציג — ואם הוא מדלג עליהם, „העתקת
 * התיעוד” מוסרת תוכן שהעמוד לא הראה. זה בדיוק הפער שכבר נתפס כאן
 * פעם עם סעיפי המסגרת, ולכן הוא נבדק ולא נזכר בהערה.
 */
const docsPage = readFileSync(join(appDir, "docs/page.tsx"), "utf8");
for (const field of ["sections", "faq"]) {
  if (!docsPage.includes(`guide.${field}`)) {
    guideProblems.push(`עמוד /docs אינו מציג \`${field}\` — הוא נמצא בקובץ ה-Markdown ולא בעמוד`);
  }
}

if (guideProblems.length > 0) {
  console.error("✗ ההדרכות:\n");
  for (const problem of guideProblems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(
  `✓ ${seen.size} קבצים סטטיים, ${links.size} קישורים פנימיים, ${topicIds.length} סעיפי תיעוד ` +
    `ו-${guideIds.length} מדריכים נבדקו — הכול תקין`,
);
