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

/**
 * ‎`getHours()` וחבריו על `Date` — קוראים את שעון המכשיר.
 *
 * הרשימה נספרה **מהתקן ולא מהמופעים בשטח**, וזה השינוי המהותי:
 * ‎`getMilliseconds` ו-`getYear` אינם קיימים כרגע באף קובץ, ובכל
 * שלוש הגרסאות הקודמות של השער נכתב רק מה שכבר נמצא — ולכן כל
 * גרסה החמיצה את הווריאנט הבא. וריאנטי `getUTC…` אינם ברשימה מעצם
 * היותה מפורשת; הם הדרך הנכונה.
 */
const LOCAL_READ =
  /\.get(?:Hours|Minutes|Seconds|Milliseconds|Date|Day|FullYear|Year|Month)\s*\(\s*\)/u;
/** ההיסט של המכשיר — שימש לבניית „עכשיו מקומי” לשדות טופס. */
const LOCAL_OFFSET = /getTimezoneOffset\s*\(\s*\)/u;
/** ‎`Date.parse("…T…")` — אותו פרסור מקומי בשם אחר. */
const LOCAL_PARSE = /\bDate\.parse\s*\(/u;
/** ‎`setHours`/`setDate` — כותבים בשעון המכשיר, אותו נזק בכיוון השני. */
const LOCAL_WRITE =
  /\.set(?:Hours|Minutes|Seconds|Milliseconds|Date|FullYear|Year|Month)\s*\(/u;
/**
 * ‎`toLocaleString` וחבריו — **שעון המכשיר בשם אחר.**
 *
 * ‎`getHours()` נאסר מהיום הראשון, `Intl.DateTimeFormat` בלי אזור זמן
 * נוסף בסבב הקודם, ואלה נשארו: 17 מופעים על `Date` עברו את השער בזמן
 * שהוא הכריז „כל המועדים נקראים ונכתבים בשעון ישראל” (ביקורת Codex).
 * זו הפעם השלישית שאותה מחלקה חוזרת בשם אחר, ולכן האיסור כאן מוחלט.
 *
 * ‎**האיסור מוחלט ואין רשימת היתרים — בכוונה.** `toLocaleString` קיימת
 * גם על `Number`, ושער טקסטואלי אינו יודע מה טיפוס המקבל. חריג היה
 * דורש לנחש, וניחוש הוא בדיוק החור. לכן ארבעת המופעים על מספרים
 * עברו ל-`formatNumber` שב-`lib/format.ts`, ואין מה להתיר.
 */
const LOCALE_METHOD =
  /\.(?:toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)\s*\(/u;

/**
 * ‎**מה השער הזה עדיין אינו תופס — `Date#toString()`.**
 *
 * ‎`new Date(x).toString()` מחזיר שעת מכשיר, בדיוק כמו כל השאר. הוא
 * אינו נאסר כאן כי `toString` היא מתודה של **כל** אובייקט: בעץ יש
 * שבעה מופעים, כולם על `URLSearchParams` ו-`Buffer`, וכולם נכונים.
 * איסור גורף היה מייצר שבע התרעות שווא, ורשימת היתרים היא בדיוק
 * המנגנון שהחזיר את המחלקה שלוש פעמים.
 *
 * זה נכתב כאן ולא מושתק: **גבול ידוע עדיף על ביטחון שגוי.** אם
 * ‎`Date#toString` יופיע אי-פעם, `formatDate`/`formatDateTime` הם
 * התשובה — ובדיקת הקוד היא שתתפוס אותו, לא השער.
 */

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
/**
 * כל קריאה שמתחילה בתבנית — **כביטוי שלם, לא כשורה.**
 *
 * ‎**זה הכלי המרכזי של השער, וכל בדיקה שאינה משתמשת בו חוזרת לטעות
 * שכבר תוקנה כאן פעמיים.** מעצבי `Intl` נכתבים על פני כמה שורות,
 * וכך גם בנאי `Date`: `new Date(2026, 2, 27,\n  2, 30)` מפוצל אחרי
 * הסוגר, ולולאת שורות אינה רואה בשום שורה גם את `new Date(` וגם את
 * הפסיקים (ביקורת Codex). בניתי סורק כזה למעצבים בסבב הקודם, ואז
 * הוספתי את בדיקת הבנאי כתבנית-שורה — כלומר החזרתי ידנית בדיוק את
 * החולשה שהסורק נבנה כדי לסגור.
 *
 * מחזיר לכל מופע את מספר השורה שבה הוא נפתח ואת גוף הקריאה כולו.
 */
/**
 * הערות אינן קוד — **והן מצטטות את הבאג כדי לתאר אותו.**
 *
 * לולאת השורות דילגה על הערות מהיום הראשון; הסורק שעובד על הקריאה
 * כולה נכתב בלעדי הדילוג, ומיד סימן את ההערה ב-`calendar/[id]/edit`
 * שמצטטת ‎``new Date(`${date}T${time}`)`` כדי להסביר מה תוקן שם.
 * שורה מרוקנת ולא נמחקת, כדי שמספרי השורות יישארו נכונים.
 */
function withoutComments(text) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")
        ? ""
        : line;
    })
    .join("\n");
}

function callsOf(source, pattern) {
  const text = withoutComments(source);
  const calls = [];
  let match;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf("(", match.index);
    if (open === -1) break;
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
    calls.push({
      line: text.slice(0, match.index).split("\n").length,
      call: text.slice(match.index, end + 1),
    });
  }
  return calls;
}

function intlWithoutTimeZone(text) {
  const found = [];
  for (const { line, call } of callsOf(text, /new Intl\.DateTimeFormat\s*\(/gu)) {
    /* ‎`timeStyle`/`dateStyle`/`hour`… — כל מה שמציג רגע */
    const showsMoment = /(?:time|date)Style|hour|minute|weekday|day|month|year/u.test(call);
    if (showsMoment && !call.includes("timeZone") && !call.includes(ALLOW)) found.push(line);
  }
  return found;
}

/** הארגומנטים של `new Date(...)`, בלי `new Date(` ובלי הסוגר הסוגר. */
function argsOf(call) {
  return call.slice(call.indexOf("(") + 1, -1);
}

/**
 * בנאי `Date` שקורא את שעון המכשיר — שתי הצורות, על הקריאה כולה.
 *
 * ‎**רב-ארגומנטי** — `new Date(2026, 2, 27, 2, 30)` מקומי תמיד, ואין
 * לו וריאנט מקביל בכתיב הזה (`Date.UTC(...)` היא הדרך). הפסיק נספר
 * ברמת הסוגריים העליונה בלבד, ולכן `new Date(f(a, b))` אינו נתפס.
 *
 * ‎**שעת קיר בלי `Z`** — `new Date("2026-03-27T02:30")` וגם
 * ‎`new Date(`${d}T23:59:59`)`. הגרסה הקודמת דרשה שיבוץ **משני צדי**
 * ה-`T`, ולכן החמיצה תבנית שהזמן בה קבוע — וכך נשמר תוקף קופון
 * בשעון המכשיר של מנהל הפלטפורמה (ביקורת Codex). מה שקובע אינו
 * היכן השיבוצים אלא **האם יש `Z`**.
 */
function localDateCtor(text) {
  const found = [];
  for (const { line, call } of callsOf(text, /new Date\s*\(/gu)) {
    if (call.includes(ALLOW)) continue;
    const args = argsOf(call);
    let depth = 0;
    let topLevelComma = false;
    for (const ch of args) {
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 0) topLevelComma = true;
    }
    if (topLevelComma) {
      found.push({ line, why: "בנאי Date רב-ארגומנטי — מקומי תמיד" });
      continue;
    }
    /* מחרוזת או תבנית שיש בה שעת קיר, ואין בה `Z` שיקבע אזור זמן */
    if (/["'`][^"'`]*T[^"'`]*["'`]/u.test(args) && !/Z\s*["'`]/u.test(args)) {
      found.push({ line, why: "שעת קיר בלי Z — נקראת בשעון המכשיר" });
    }
  }
  return found;
}

/**
 * לכל `datetime-local` בקובץ — המרה משלו דרך העזר המשותף.
 *
 * הבדיקה מבנית ולא תבניתית, בכוונה: `new Date(dueAt)` על משתנה הוא
 * ביטוי תקין לגמרי ברוב ההקשרים, ואי אפשר לזהות מתוכו לבדו שהערך
 * הגיע משדה טופס. מה שכן ודאי הוא שקובץ שיש בו שדה כזה **מוכרח**
 * להמיר אותו — וזה בדיוק מה שנשמט בשדה החמישי, שעבר את הגרסה
 * הראשונה של השער בלי להיתפס (ביקורת Codex).
 *
 * ‎**למה סופרים ולא שואלים „האם קיים”.** `tasks-board.tsx` מחזיק שני
 * מסלולים נפרדים — יצירה ועריכה — ובדיקת „יש אזכור אחד בקובץ” נתנה
 * לאחד מהם לחזור ל-`new Date(dueAt)` בזמן שהאזכור של השני מחזיק את
 * השער ירוק (ביקורת Codex). זהו בדיוק ההבדל בין „הקובץ יודע על
 * העזר” לבין „כל שדה עובר דרכו”.
 */
const LOCAL_FIELD = /type="datetime-local"/gu;
const RESOLVER = /resolveJerusalemLocalInput\s*\(/gu;

/** כמה פעמים תבנית גלובלית מופיעה בטקסט. */
function countOf(pattern, text) {
  pattern.lastIndex = 0;
  let n = 0;
  while (pattern.exec(text) !== null) n += 1;
  return n;
}

const offenders = [];
let scanned = 0;

for (const file of FILES) {
  scanned += 1;
  const source = readFileSync(file, "utf8");
  const short = file.replace(`${root}/`, "");
  for (const line of intlWithoutTimeZone(source)) {
    offenders.push(`  ${short}:${line}  ←  Intl.DateTimeFormat בלי timeZone`);
  }
  for (const { line, why } of localDateCtor(source)) {
    offenders.push(`  ${short}:${line}  ←  ${why}`);
  }
  const fields = countOf(LOCAL_FIELD, source);
  const resolved = countOf(RESOLVER, source);
  if (fields > resolved) {
    offenders.push(
      `  ${short}  ←  ${fields} שדות datetime-local מול ${resolved} המרות resolveJerusalemLocalInput`,
    );
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
      (LOCAL_PARSE.test(code) && "Date.parse — פרסור בשעון המכשיר") ||
      (LOCAL_WRITE.test(code) && "כתיבה בשעון המכשיר") ||
      (LOCALE_METHOD.test(code) && "עיצוב בשעון המכשיר (toLocale…)");
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
      "    תצוגה   — formatDate / formatDateTime שב-lib/format, או",
      "              formatJerusalemDate / formatJerusalemTime / jerusalemWallParts",
      "    מספרים  — formatNumber שב-lib/format (ולא toLocaleString)",
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
