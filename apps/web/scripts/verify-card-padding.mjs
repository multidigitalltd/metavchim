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
 * ## מה השער אוכף, ומה הוא לא
 *
 * הוא אינו מודד פיקסלים ואינו יודע אם התוצאה יפה. הוא אוכף דבר
 * אחד: כרטיס `mv-card` מקבל ריפוד — מהמחלקה `mv-card--pad`, מ-`p-*`
 * של Tailwind, או `overflow-hidden` שמצהיר במפורש „התוכן כאן אמור
 * להגיע לקצה”. כרטיס בלי אף אחד מהשלושה הוא כרטיס שנשכח.
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

/*
 * ‎`p-5`, `px-4`, `py-[18px]`, `p-[22px]` — כל צורת ריפוד של Tailwind
 * נחשבת. ‎`overflow-hidden` הוא ההצהרה המפורשת „מקצה לקצה בכוונה”.
 */
const HAS_PADDING = /\b(?:p|px|py|ps|pe|pt|pb)-\[?[\w.]/u;
const EDGE_TO_EDGE = /\boverflow-hidden\b/u;

const offenders = [];
for (const file of tsxFiles(root)) {
  const source = readFileSync(file, "utf8");
  /*
   * ‎**אסימון מדויק, ולא `\bmv-card\b`.** מקף הוא גבול-מילה, ולכן
   * הביטוי ההוא תפס גם `mv-card-head` ו-`mv-card__title` — כלומר
   * דיווח על כל כותרת כאילו היא כרטיס. פיצול לרשימת מחלקות עונה
   * על השאלה שנשאלת באמת: האם `mv-card` הוא אחת מהן.
   */
  for (const match of source.matchAll(/className="([^"]*)"/gu)) {
    const classes = match[1];
    const tokens = classes.split(/\s+/u);
    if (!tokens.includes("mv-card")) continue;
    if (tokens.includes("mv-card--pad")) continue;
    if (HAS_PADDING.test(classes) || EDGE_TO_EDGE.test(classes)) continue;
    const line = source.slice(0, match.index).split("\n").length;
    offenders.push(`  ${file.slice(root.length - 3)}:${line}  ←  class="${classes}"`);
  }
}

if (cssProblems.length > 0 || offenders.length > 0) {
  console.error("✗ כרטיס בלי ריפוד — התוכן נוגע במסגרת:\n");
  for (const problem of cssProblems) console.error(`  ${problem}`);
  if (cssProblems.length > 0 && offenders.length > 0) console.error("");
  for (const offender of offenders) console.error(offender);
  console.error(
    "\n  ‎`mv-card` נותן משטח בלבד. הוסיפו `mv-card--pad`, או `p-*` משלכם,",
  );
  console.error("  או `overflow-hidden` אם התוכן אמור להגיע מקצה לקצה בכוונה.");
  process.exit(1);
}

console.log("✓ כל הכרטיסים מרופדים");
