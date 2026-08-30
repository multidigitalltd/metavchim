/**
 * ‎**כרטיס לא נוגע במסגרת שלו.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‏`.mv-card` מגדיר רקע, מסגרת, פינות וצל — ו**לא ריפוד**. זו הכרעה
 * נכונה: יש כרטיסים שהתוכן בהם אמור להגיע מקצה לקצה (רשימה עם
 * ‎`overflow-hidden`). המחיר הוא שכל קורא חייב להוסיף ריפוד בעצמו,
 * ‎**וששת הכרטיסים שבעמוד הנכס לא הוסיפו**: הטקסט, המפה, שדה הקלט
 * וארבע משבצות התמונות נגעו במסגרת. בעל המוצר דיווח על כך עם צילום
 * מהמערכת החיה, אחרי שהגרסה כבר עלתה.
 *
 * ## למה אף שער קיים לא תפס את זה
 *
 * הטיפוגרפיה חוקית, הניגודיות חוקית, הצורות נכונות, וה-TypeScript
 * מרוצה. ‎**חוסר ריפוד אינו שגיאה בשום מובן שנבדק** — הוא נראה,
 * וזהו. בדיוק סוג התקלה שדורשת שער משלה, כי היא שקטה בכל השאר.
 *
 * ## שתי תקלות שהיו בשער עצמו (ביקורת Codex, P2 ×2)
 *
 * ‎**1. „יש ריפוד” אינו „יש ריפוד מכל צד”.** הניסוח הראשון קיבל כל
 * שירות ריפוד בודד, ולכן `mv-card px-4` עבר — בזמן שהתוכן ממשיך
 * לגעת בקצה העליון והתחתון. השער מחשב עכשיו **כיסוי של ארבעת
 * הצדדים**, ומרכיב אותו מהשירותים שנמצאו.
 *
 * ‎**2. שער שאינו קורא אינו שער.** הסריקה זיהתה רק
 * ‎`className="…"` במרכאות כפולות, ולכן `className={…}` — תבנית,
 * תנאי, `clsx` — נדלגה **בשקט**, והשער דיווח הצלחה על קובץ שלא
 * בדק. אותה הסוואה בדיוק שהוא נועד למנוע. הוא קורא עכשיו גם צורות
 * ביטוי, ומה שאינו ניתן להכרעה **נופל** ואינו עובר.
 *
 * ## מה השער אוכף, ומה הוא לא
 *
 * הוא אינו מודד פיקסלים ואינו יודע אם התוצאה יפה. הוא אוכף דבר
 * אחד: כרטיס `mv-card` מרופד מארבעת הצדדים — מהמחלקה
 * ‎`mv-card--pad`, מצירוף שירותי Tailwind שמכסה את כולם, או
 * ‎`overflow-hidden` שמצהיר במפורש „התוכן כאן אמור להגיע לקצה”.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../src", import.meta.url));
const cssPath = fileURLToPath(new URL("../src/app/globals.css", import.meta.url));

/* המחלקה עצמה חייבת להתקיים — שער שמצביע על מחלקה שאינה קיימת מאשר כלום */
const css = readFileSync(cssPath, "utf8");
const cssProblems = [];
if (!/\.mv-card--pad\s*\{[^}]*padding:/u.test(css)) {
  cssProblems.push("‎`.mv-card--pad` אינה מגדירה `padding`");
}
if (!/\.mv-card--pad\s*>\s*\.mv-card-head\s*\{[^}]*margin-bottom:/u.test(css)) {
  cssProblems.push("‎`.mv-card--pad > .mv-card-head` אינה מגדירה `margin-bottom`");
}

/** קובצי המקור של המסכים — `.tsx` בלבד, בלי `node_modules`. */
function* tsxFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* tsxFiles(full);
    else if (name.endsWith(".tsx")) yield full;
  }
}

/**
 * אילו צדדים שירות ריפוד אחד מכסה.
 *
 * ‎**בלי קידומת breakpoint בכוונה.** `md:p-5` אינו מרפד בטלפון, וזה
 * המסך שבו כרטיס צר ביותר וריפוד חשוב ביותר. שירות מותנה אינו
 * נספר ככיסוי.
 */
function sidesOf(token) {
  const match = /^(p|px|py|pt|pb|pl|pr|ps|pe)-(?:\[[^\]]+\]|[\w.]+)$/u.exec(token);
  if (match === null) return [];
  switch (match[1]) {
    case "p":
      return ["top", "right", "bottom", "left"];
    case "px":
    // ‎`ps`/`pe` לוגיים — בעברית הם מתהפכים, אבל שניהם יחד הם הציר האופקי
    case "py":
      return match[1] === "px" ? ["right", "left"] : ["top", "bottom"];
    case "pt":
      return ["top"];
    case "pb":
      return ["bottom"];
    case "pl":
    case "ps":
      return ["left"];
    case "pr":
    case "pe":
      return ["right"];
    default:
      return [];
  }
}

/** ‏`true` רק כשכל ארבעת הצדדים מכוסים — „חלקי” הוא בדיוק התקלה. */
function fullyPadded(tokens) {
  const covered = new Set();
  for (const token of tokens) for (const side of sidesOf(token)) covered.add(side);
  return ["top", "right", "bottom", "left"].every((side) => covered.has(side));
}

/**
 * ערכי ה-`className` שבקובץ — גם `"…"` וגם `{…}`.
 *
 * הסוגריים נסרקים בספירת עומק ולא ברגקס: `{`…`}` מקונן הוא הצורה
 * הרגילה של תבנית (`` `mv-card ${x}` ``), ורגקס לא-חמדני היה נעצר
 * על הסוגר הפנימי הראשון.
 */
function* classNameValues(source) {
  const attr = /className\s*=\s*/gu;
  for (const match of source.matchAll(attr)) {
    let index = match.index + match[0].length;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, index + 1);
      if (end === -1) continue;
      yield { kind: "literal", text: source.slice(index + 1, end), index };
      continue;
    }
    if (quote !== "{") continue;
    let depth = 0;
    let end = index;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    yield { kind: "expression", text: source.slice(index + 1, end), index };
  }
}

/** מחרוזות שבתוך ביטוי — כפולות, יחידות ותבניות. */
function stringLiterals(expression) {
  return [...expression.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/gu)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
}

const offenders = [];
for (const file of tsxFiles(root)) {
  const source = readFileSync(file, "utf8");
  for (const value of classNameValues(source)) {
    /*
     * ‎**אסימון מדויק, ולא `\bmv-card\b`.** מקף הוא גבול-מילה, ולכן
     * הביטוי ההוא תפס גם `mv-card-head` ו-`mv-card-head__title` —
     * כלומר דיווח על כל כותרת כאילו היא כרטיס.
     */
    const chunks =
      value.kind === "literal" ? [value.text] : stringLiterals(value.text);
    const carrying = chunks.filter((chunk) => chunk.split(/\s+/u).includes("mv-card"));
    if (carrying.length === 0) continue;

    const line = source.slice(0, value.index).split("\n").length;
    const where = `${file.slice(root.length - 3)}:${line}`;

    for (const chunk of carrying) {
      const tokens = chunk.split(/\s+/u);
      if (tokens.includes("mv-card--pad")) continue;
      if (tokens.includes("overflow-hidden")) continue;
      /*
       * ‎**הריפוד נדרש באותה מחרוזת שבה `mv-card`.** ריפוד שיושב
       * בענף אחר של תנאי אינו מובטח, וספירתו ככיסוי הופכת את השער
       * למאשר-תמיד — בדיוק מה שהוא בא למנוע.
       */
      if (fullyPadded(tokens)) continue;
      offenders.push(`  ${where}  ←  "${chunk}"`);
    }
  }
}

if (cssProblems.length > 0 || offenders.length > 0) {
  console.error("✗ כרטיס בלי ריפוד מלא — התוכן נוגע במסגרת:\n");
  for (const problem of cssProblems) console.error(`  ${problem}`);
  if (cssProblems.length > 0 && offenders.length > 0) console.error("");
  for (const offender of offenders) console.error(offender);
  console.error("\n  ‎`mv-card` נותן משטח בלבד, ולכן צריך אחד מהשלושה,");
  console.error("  ‎**באותה מחרוזת שבה `mv-card`**:");
  console.error("    • ‎`mv-card--pad`");
  console.error("    • שירותי Tailwind שמכסים את ארבעת הצדדים (‎`p-5`, או `px-5 py-4`)");
  console.error("    • ‎`overflow-hidden` — התוכן אמור להגיע מקצה לקצה בכוונה");
  process.exit(1);
}

console.log("✓ כל הכרטיסים מרופדים מארבעת הצדדים");
