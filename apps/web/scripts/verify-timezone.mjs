import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ‎**מועד שנקרא או נכתב בשעון המכשיר — ולא בשעון ישראל.**
 *
 * המחלקה הזו חזרה ארבע פעמים בביקורת, וכל פעם באזור אחר: גבולות
 * היום בדשבורד, רשת היומן, שלושת טפסי הפגישה, ולבסוף ארבעה שדות
 * ‎`datetime-local`. היא בלתי נראית כמעט תמיד — הקריאה והכתיבה
 * סימטריות, ולכן על מכשיר אחד הכול עקבי — ושגויה בכל מכשיר שאינו
 * על שעון ישראל. CI רץ ב-UTC, ושם היא בלתי נראית לגמרי.
 *
 * ‎**למה השער נוסף רק עכשיו.** שער שנולד עם רשימת היתרים מקבע חוב
 * במקום למנוע אותו; הוא נכתב אחרי שכל המקומות תוקנו, ולכן הוא
 * אוסר ולא מתעד. החריג היחיד המותר הוא כזה שבו שעון המכשיר הוא
 * **התשובה הנכונה**, והוא מסומן במקום עצמו ולא ברשימה כאן.
 */

const root = new URL("../src", import.meta.url).pathname;

/** ‎`getHours()` וחבריו על `Date` — קוראים את שעון המכשיר. */
const LOCAL_READ = /\.get(?:Hours|Minutes|Seconds|Date|Day|FullYear|Month)\s*\(\s*\)/u;
/** ההיסט של המכשיר — שימש לבניית „עכשיו מקומי” לשדות טופס. */
const LOCAL_OFFSET = /getTimezoneOffset\s*\(\s*\)/u;
/** ‎`new Date("YYYY-MM-DDTHH:MM")` — נקרא באזור הזמן של המכשיר. */
const WALL_PARSE = /new Date\(\s*`[^`]*\$\{[^`]*\}T\$\{/u;
/** ‎`setHours`/`setDate` — כותבים בשעון המכשיר, אותו נזק בכיוון השני. */
const LOCAL_WRITE = /\.set(?:Hours|Minutes|Date|FullYear|Month)\s*\(/u;

/**
 * הסימון שמתיר שורה: **שעון המכשיר הוא התשובה הנכונה כאן.**
 *
 * לא „עוד לא הספקנו”. הדוגמה היחידה כרגע היא ברכת „בוקר טוב”,
 * שמדברת אל מי שמסתכל על המסך ולא על שעות העבודה בישראל.
 */
const ALLOW = "שעון-המכשיר-במכוון";

const FILES = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/u.test(entry)) FILES.push(full);
  }
}
walk(root);

/**
 * ‎`Intl.DateTimeFormat` בלי `timeZone` — **קורא את שעון המכשיר בדיוק
 * כמו `getHours()`.**
 *
 * זה מה שהגרסה הראשונה של השער החמיצה, ולכן היא הדפיסה „כל המועדים
 * נקראים ונכתבים בשעון ישראל” בזמן ש-11 מעצבים הציגו שעות מכשיר:
 * שיחה שנקלטה כ-14:30 ירושלים הוצגה ברשימה כ-07:30 בניו-יורק
 * (ביקורת Codex). שם של שער אינו השער — בדיוק הלקח שכבר נרשם כאן
 * על בדיקה שנשאה כותרת שלא בדקה.
 *
 * הבדיקה נעשית על הקריאה כולה ולא על השורה, כי הקריאות נכתבות על
 * פני כמה שורות. גם `dateStyle` בלבד נספר: גבול יממה זז עם אזור
 * הזמן, ולכן „24.08” הופך ל„23.08” אחרי חצות ישראלית.
 */
function intlWithoutTimeZone(text) {
  const found = [];
  const pattern = /new Intl\.DateTimeFormat\s*\(/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf("(", match.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const call = text.slice(match.index, end + 1);
    /* ‎`timeStyle`/`dateStyle`/`hour`… — כל מה שמציג רגע */
    const showsMoment = /(?:time|date)Style|hour|minute|weekday|day|month|year/u.test(call);
    if (showsMoment && !call.includes("timeZone") && !call.includes(ALLOW)) {
      found.push(text.slice(0, match.index).split("\n").length);
    }
  }
  return found;
}

/**
 * קובץ שמצייר `datetime-local` **חייב** לעבור דרך העזר המשותף.
 *
 * הבדיקה מבנית ולא תבניתית, בכוונה: `new Date(dueAt)` על משתנה הוא
 * ביטוי תקין לגמרי ברוב ההקשרים, ואי אפשר לזהות מתוכו לבדו שהערך
 * הגיע משדה טופס. מה שכן ודאי הוא שקובץ שיש בו שדה כזה **מוכרח**
 * להמיר אותו — וזה בדיוק מה שנשמט בשדה החמישי, שעבר את הגרסה
 * הראשונה של השער בלי להיתפס (ביקורת Codex).
 */
const LOCAL_FIELD = 'type="datetime-local"';
const RESOLVER = "resolveJerusalemLocalInput";

const offenders = [];
let scanned = 0;

for (const file of FILES) {
  scanned += 1;
  const source = readFileSync(file, "utf8");
  const short = file.replace(`${root}/`, "");
  for (const line of intlWithoutTimeZone(source)) {
    offenders.push(`  ${short}:${line}  ←  Intl.DateTimeFormat בלי timeZone`);
  }
  if (source.includes(LOCAL_FIELD) && !source.includes(RESOLVER)) {
    offenders.push(`  ${short}  ←  שדה datetime-local בלי ${RESOLVER}`);
  }
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    /* הערות אינן קוד — הן מתארות את הבאג, ולעיתים מצטטות אותו */
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    if (line.includes(ALLOW)) return;
    /* `setUTCDate` וחבריו הם בדיוק הדרך הנכונה, ואינם נאסרים */
    const code = line.replace(/\.set(?:UTC|Time)[A-Za-z]*\s*\(/gu, ".setSAFE(");
    const hit =
      (LOCAL_READ.test(code) && "קריאה בשעון המכשיר") ||
      (LOCAL_OFFSET.test(code) && "היסט אזור הזמן של המכשיר") ||
      (WALL_PARSE.test(code) && "פרסור שעת קיר בשעון המכשיר") ||
      (LOCAL_WRITE.test(code) && "כתיבה בשעון המכשיר");
    if (hit) {
      offenders.push(`  ${file.replace(`${root}/`, "")}:${index + 1}  ←  ${hit}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("✗ מועד שנקרא או נכתב בשעון המכשיר במקום בשעון ישראל:\n");
  for (const line of offenders) console.error(line);
  console.error(
    [
      "",
      "  השתמשו בעזרי `israel-time.ts` שב-@metavchim/shared:",
      "    תצוגה   — formatJerusalemDate / formatJerusalemTime / jerusalemWallParts",
      "    מעצב    — new Intl.DateTimeFormat(\"he-IL\", { timeZone: JERUSALEM_TZ, … })",
      "    טופס     — jerusalemLocalInputValue ⟷ resolveJerusalemLocalInput",
      "    גבולות   — jerusalemDayRange / jerusalemDayStart / jerusalemWeekStart",
      "",
      `  אם שעון המכשיר הוא באמת התשובה הנכונה — סמנו את השורה ב-„${ALLOW}”`,
      "  והסבירו למה. סימון בלי סיבה הוא בדיוק מה שהשער נועד לתפוס.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ ${scanned} קבצים נסרקו — כל המועדים נקראים ונכתבים בשעון ישראל`);
