/**
 * ‎**מה שהמסך מבקש מול מה שהשרת מחזיר — עטיפה מול מערך.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‎`apiGet<{ items: OfferRow[] }>("/offers")` הוא **הצהרה על נתיב**,
 * ואיש אינו משווה אותה לבקר. `GET /offers` מחזיר מערך, לא
 * ‎`{ items }`, ולכן `r.items` היה `undefined` — תמיד. המונה „הצעות
 * ממתינות” בדשבורד הראה אפס מאז ומתמיד, ושום דבר לא נראה שבור:
 * ההגנה הישנה (`?? []`) הפכה את זה לרשימה ריקה סבירה למראה.
 *
 * האימות (`apiList`) חשף את זה כתקלת טעינה תוך שעות מהעלייה —
 * וזה בדיוק מה שהוא נועד לעשות. אבל הוא חושף בזמן ריצה, אצל
 * המשתמש. הבדיקה כאן עושה את זה בבנייה.
 *
 * ## מה נבדק, ומה במפורש לא
 *
 * רק אי-ההתאמה שבאמת קרתה, וזו שאפשר להכריע בה בוודאות: **המסך
 * מבקש אובייקט עטוף והשרת מחזיר מערך, או להפך.** השוואת טיפוסים
 * מלאה דורשת פותר טיפוסים; „עטוף מול מערך” נקרא מהחתימה.
 *
 * נתיב שאי אפשר לפתור באופן חד-משמעי — פרמטר בדרך, שני בקרים עם
 * אותו שם מסלול — **מדולג ונספר**. שער שמנחש נתיב מייצר אזהרות
 * שווא, ואזהרת שווא אחת מלמדת להתעלם מכולן.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const WEB = fileURLToPath(new URL("../src", import.meta.url));
const API = fileURLToPath(new URL("../../api/src/modules", import.meta.url));

const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

/**
 * עטוף או מערך — ‎`null` כשאי אפשר להכריע.
 *
 * ‎**סוף המחרוזת קודם לתחילתה**, וזו לא קפדנות: `{ id: string }[]`
 * הוא מערך של אובייקטים, ובדיקת „מתחיל ב-‎`{`” לבדה סיווגה אותו
 * כעטוף — ארבע אזהרות שווא בריצה הראשונה של השער הזה. אזהרת שווא
 * אחת מלמדת להתעלם מכולן.
 */
const classify = (declared) => {
  const text = declared.trim();
  if (/\]\s*$/u.test(text)) return "array";
  if (text.startsWith("{")) return "object";
  return null;
};

const walk = (dir, match, out = []) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match.test(name)) out.push(path);
  }
  return out;
};

/*
 * 1 · מה השרת מחזיר, לפי נתיב.
 *
 * הנתיב מורכב מתחילית הבקר ומהמסלול של המתודה. מסלול עם פרמטר
 * (`:id`) אינו נכנס למפה — הוא לעולם לא ייקרא כמחרוזת קבועה מהמסך.
 */
const returns = new Map();
const ambiguous = new Set();
for (const file of walk(API, /\.controller\.ts$/u)) {
  const src = strip(readFileSync(file, "utf8"));
  /*
   * ‎`@Controller()` בלי ארגומנט הוא תחילית ריקה ותקינה — וזה בדיוק
   * הבקר שבו ישבה התקלה שהשער הזה נולד ממנה. דרישת מחרוזת דילגה
   * עליו כולו, והשער עבר בשלווה על הבאג שהוא נכתב בשבילו.
   */
  const controller = /@Controller\((?:"([^"]*)")?\)/u.exec(src);
  if (controller === null) continue;
  const prefix = controller[1] ?? "";
  /*
   * ‎**החתימה נקראת מהמתודה שצמודה למסלול, ולא מחלון תווים.**
   *
   * גרסה ראשונה חיפשה `Promise<…>` בטווח של שש מאות תווים אחרי
   * ‎`@Get`, וכך שייכה למסלול אחד את החתימה של מתודה **אחרת** —
   * שתי אזהרות שווא, ובאותה מידה יכולה הייתה להסתיר אי-התאמה
   * אמיתית בכך שתשווה מול החתימה הלא נכונה. הקטע נחתך עכשיו
   * בדקורטור הבא, ולכן הוא שייך למתודה אחת בלבד.
   */
  const decorators = [...src.matchAll(/@(?:Get|Post|Patch|Put|Delete)\(/gu)];
  for (const [index, decorator] of decorators.entries()) {
    const start = decorator.index ?? 0;
    const end = decorators[index + 1]?.index ?? src.length;
    const segment = src.slice(start, end);
    const get = /^@Get\((?:"([^"]*)")?\)/u.exec(segment);
    if (get === null) continue;
    const route = get[1] ?? "";
    if (route.includes(":")) continue;
    const path = `/${[prefix, route].filter((part) => part !== "").join("/")}`;
    /*
     * טיפוס ההחזרה של אותה מתודה: `): Promise<…> {`. חתימה שאינה
     * ‎`Promise` (למשל `ReturnType<…>` או קבוע מיובא) אינה נקראת
     * כאן — היא דורשת פותר טיפוסים, ולנחש אותה גרוע מלדלג עליה.
     */
    const signature = /\)\s*:\s*Promise<([\s\S]*?)>\s*\{/u.exec(segment);
    if (signature === null) continue;
    const declared = signature[1].trim();
    const shape = classify(declared);
    if (shape === null) continue;
    if (returns.has(path) && returns.get(path) !== shape) ambiguous.add(path);
    returns.set(path, shape);
  }
}

/* 2 · מה המסך מבקש — הצורה שהוצהרה, והנתיב שנקרא בפועל */
const problems = [];
let checked = 0;
let skipped = 0;
for (const file of walk(WEB, /\.tsx?$/u)) {
  const src = strip(readFileSync(file, "utf8"));
  for (const call of src.matchAll(/apiGet<([^>]*(?:<[^>]*>[^>]*)?)>\(\s*[`"]([^`"$]+)[`"]/gu)) {
    const declared = call[1].trim();
    // הנתיב בלי מחרוזת שאילתה — היא אינה חלק מהמסלול
    const path = call[2].split("?")[0].replace(/\/$/u, "");
    const want = classify(declared);
    if (want === null) continue;
    if (ambiguous.has(path) || !returns.has(path)) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const got = returns.get(path);
    if (want !== got) {
      problems.push(
        `${relative(WEB, file)}: ‏${path} — המסך מבקש ${
          want === "object" ? "אובייקט עטוף" : "מערך"
        } והשרת מחזיר ${got === "object" ? "אובייקט עטוף" : "מערך"}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("✗ צורת התשובה שהמסך מצהיר עליה אינה מה שהשרת מחזיר:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(
    "\n‎`apiGet<T>` הוא הצהרה ולא ולידציה: שדה שאינו קיים חוזר undefined, והמסך מציג מספר שגוי בלי להיראות שבור.",
  );
  process.exit(1);
}

console.log(
  `✓ ${checked} קריאות הושוו מול חתימת הבקר · ${skipped} נתיבים לא נפתרו חד-משמעית ולכן דולגו`,
);
