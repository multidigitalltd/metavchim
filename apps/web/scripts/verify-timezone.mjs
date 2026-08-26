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

/**
 * ‎**מה נסרק — וזה היה החור הגדול ביותר בשער הזה.**
 *
 * ‎`root` היה `apps/web/src` בלבד, ולכן השער הכריז „כל המועדים
 * נקראים ונכתבים בשעון ישראל” בזמן שהוא מעולם לא הסתכל על
 * ‎`packages/shared` — שרץ **בתוך** הדפדפן — ולא על `apps/api`, שם
 * ‎`toLocaleString` קוראת את אזור הזמן של תהליך השרת. שם של שער
 * אינו השער, בפעם הרביעית (ביקורת Codex).
 *
 * ‎`monoRoot` נגזר מכאן: הקובץ יושב ב-`apps/web/scripts`.
 */
const monoRoot = new URL("../../..", import.meta.url).pathname;

/**
 * ‎**שני סוגי כללים, ולא רשימת פטורים.**
 *
 * ‎`display` — `toLocale…`, `Intl` בלי `timeZone`, היסט המכשיר. אלה
 * שגויים בכל מקום בלי יוצא מן הכלל: בדפדפן זה שעון המכשיר, בשרת
 * זה אזור הזמן של התהליך.
 *
 * ‎`arithmetic` — `getHours`/`setDate` ובנאי `Date`. אלה **נכונים
 * בכוונה** ב-`packages/shared` וב-`apps/api`, ששם קיים דפוס מוכר
 * וסימטרי: `toJerusalemWall(at)` מחזיר `Date` שהשדות המקומיים שלו
 * הם שעת הקיר הירושלמית, מבצעים עליו אריתמטיקה מקומית, ומחזירים
 * דרך `jerusalemWallToUtc`. אכיפת הכללים האלה שם הייתה מסמנת
 * עשרות שורות תקינות — וההרגל למחוק סימונים הוא בדיוק מה שהורג
 * שערים. בשכבת המסך אין את הדפוס הזה, ושם הם נאכפים במלואם.
 */
const ROOTS = [
  { path: "apps/web/src", arithmetic: true },
  { path: "packages/shared/src", arithmetic: true },
  { path: "packages/ui/src", arithmetic: true },
  { path: "apps/api/src", arithmetic: true },
  { path: "apps/workers/src", arithmetic: true },
];

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
 * נוסף בסבב שאחריו, ואלה נשארו: 17 מופעים על `Date` עברו את השער בזמן
 * שהוא הכריז „כל המועדים נקראים ונכתבים בשעון ישראל” (ביקורת Codex).
 *
 * ‎**הכלל: אסור, אלא אם הקריאה נוקבת ב-`timeZone` מפורש.** זו תיקון
 * לניסוח הקודם שלי, שהיה „איסור מוחלט בלי חריגים” — והוא היה שגוי:
 * ‎`at.toLocaleString("en-US", { timeZone: JERUSALEM_TZ })` בעובד הרקע
 * הוא **הדרך הנכונה**, והכלל המוחלט סימן אותו. כלל שמסמן קוד נכון
 * מלמד למחוק סימונים, וזה הורג שערים מהר יותר מכל חור.
 *
 * הכלל החדש אינו רשימת היתרים ואינו מנחש טיפוסים: מספרים לעולם
 * אינם מקבלים `timeZone`, ולכן הם עדיין נתפסים ועוברים דרך
 * ‎`formatIsraeliNumber`. אותה שאלה בדיוק שנשאלת על `Intl`.
 */
const LOCALE_METHOD =
  /\.(?:toLocaleString|toLocaleDateString|toLocaleTimeString|toDateString|toTimeString)\s*\(/gu;

/** קריאת `toLocale…` בלי `timeZone` — על הקריאה כולה, כמו המעצבים. */
/**
 * ‎`Date()` בלי `new` — **מחזיר מחרוזת בשעון המארח.**
 *
 * זו אינה יצירת `Date` אלא קריאה לפונקציה גלובלית שמחזירה את הרגע
 * הנוכחי כטקסט מעוצב באזור הזמן של המכשיר או של תהליך השרת.
 *
 * ‎**גם בהסמכה גלובלית.** `globalThis.Date()` ו-`window.Date()` הן
 * אותה פונקציה בדיוק, והמבט לאחור שכתבתי פסל אותן בגלל הנקודה —
 * כלומר הכלל שנועד לסגור חור פתח אחד חדש (ביקורת Codex). לכן
 * הבדיקה קוראת את הטקסט שלפני הקריאה במקום לנסות לדחוס הכול
 * לביטוי רגולרי אחד: מסירים מסמיך גלובלי אם יש, ואז שואלים אם
 * נשאר `new` (הצורה הנכונה) או תו מזהה/נקודה (מתודה של אובייקט
 * אחר, לא שלנו).
 */
const GLOBAL_QUALIFIER = /\b(?:globalThis|window|self|global)\.\s*$/u;

function callableDateLines(text) {
  const found = [];
  const pattern = /\bDate\s*\(/gu;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(0, match.index).replace(GLOBAL_QUALIFIER, "");
    if (/\bnew\s+$/u.test(before)) continue;
    if (/[.\w$]$/u.test(before)) continue;
    found.push(text.slice(0, match.index).split("\n").length);
  }
  return found;
}

function localeWithoutTimeZone(text) {
  return callsOf(text, LOCALE_METHOD)
    .filter(({ call }) => !namesTimeZone(call) && !call.includes(ALLOW))
    .map(({ line }) => line);
}

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

/**
 * ‎**„ה-`Date` הזה נושא שעת קיר ירושלמית, לא רגע.”**
 *
 * הדפוס: `toJerusalemWall(at)` מחזיר `Date` שהשדות **המקומיים** שלו
 * הם שעת הקיר בישראל, מבצעים עליו אריתמטיקה מקומית, ומחזירים דרך
 * ‎`jerusalemWallToUtc`. שם `getHours()` הוא הדבר הנכון.
 *
 * ‎**למה סימון בשורה ולא פטור לשורש שלם.** קודם כיביתי את כל בדיקות
 * האריתמטיקה על `shared`, `api`, `workers` ו-`ui` — ארבעה שורשים
 * שלמים — בנימוק שהדפוס הזה חי בהם. אבל הוא חי ב-**חמישה קבצים**,
 * ופטור לשורש היה נותן ל-`Date.parse(wallInput)` עתידי בכל נתיב API
 * לעבור בשקט (ביקורת Codex). זה גם סתר את מה שכתוב בראש הקובץ
 * הזה: החריג מסומן במקום עצמו ולא ברשימה.
 *
 * הסימון מתיר **אריתמטיקה בלבד**. כללי התצוגה — `toLocale…`,
 * ‎`Intl` בלי אזור זמן — חלים גם על שורה מסומנת, כי נושא שעת קיר
 * שמעוצב ישירות הוא באג בכל מקרה.
 */
const WALL_CARRIER = "נושא-שעת-קיר";

/** כל קובץ מקור בכל שורש, עם הכללים שחלים עליו. בדיקות אינן קוד מוצר. */
const FILES = [];
for (const { path: rel, arithmetic } of ROOTS) {
  const base = join(monoRoot, rel);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(entry) && !/\.test\.tsx?$/u.test(entry)) {
        FILES.push({ full, short: `${rel}/${full.slice(base.length + 1)}`, arithmetic });
      }
    }
  };
  walk(base);
}

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

/**
 * ‎`timeZone` כ**מפתח אפשרות**, ולא כמחרוזת שמופיעה איפשהו בקריאה.
 *
 * ‎`call.includes("timeZone")` נתן ציון עובר גם ל-`timeZoneName: "short"`,
 * שהיא אפשרות **תצוגה** — היא מוסיפה „GMT+3” לפלט ואינה קובעת דבר.
 * מעצב כזה ממשיך לעצב בשעון המכשיר, ועובר את השער (ביקורת Codex).
 *
 * הבדיקה דורשת `timeZone` שאחריו `:`, `,` או `}` — כלומר מפתח עם
 * ערך, או קיצור `{ timeZone }`. ‎`timeZoneName` נופל מעצם האות `N`
 * שבאה מיד אחרי.
 */
function namesTimeZone(call) {
  return /\btimeZone\s*[:,}]/u.test(call);
}

/**
 * ‎`Intl.DateTimeFormat` — **גם בלי `new`.**
 *
 * הבנאי חוקי לגמרי גם כקריאה רגילה, ומחזיר אותו מעצב:
 * ‎`Intl.DateTimeFormat("he-IL").format(at)`. התבנית דרשה `new`,
 * ולכן הצורה הזו עברה (ביקורת Codex).
 *
 * ‎**הגבול, במפורש:** שער טקסטואלי אינו עוקב אחרי כינויים. `const F =
 * Intl.DateTimeFormat` ואז `F("he-IL")` לא ייתפס, וכך גם ייבוא בשם
 * אחר. אין לכך פתרון בלי לנתח את העץ; זה נרשם כאן ולא מוסתר, כמו
 * הגבול של `Date#toString`. גבול ידוע עדיף על ביטחון שגוי.
 */
const INTL_FORMAT = /(?:new\s+)?Intl\.DateTimeFormat\s*\(/gu;

function intlWithoutTimeZone(text) {
  const found = [];
  for (const { line, call } of callsOf(text, INTL_FORMAT)) {
    /*
     * ‎**כל מעצב, בלי לשאול מה הוא מציג.**
     *
     * כאן ישבה רשימת רכיבים — `timeStyle`, `hour`, `day`… — והיא
     * הייתה ניחוש: `new Intl.DateTimeFormat("he-IL")` בלי אפשרויות
     * כלל אינה מכילה אף אחד מהם, ולכן עברה — בעוד שברירת המחדל
     * של ה-API היא להציג יום/חודש/שנה בשעון המארח. ב-New_York
     * ‎`2026-08-13T01:30Z` יוצא „12.8.2026” במקום „13.8.2026”
     * (ביקורת Codex).
     *
     * זו הפעם החמישית שהיוריסטיקה „איך הבאג נראה” מפסידה לשאלה
     * „מה הכלל”. הכלל הוא אחד: מעצב חייב לנקוב באזור זמן.
     */
    if (!namesTimeZone(call) && !call.includes(ALLOW)) found.push(line);
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
/**
 * בנאי `Date` — **גם בהסמכה גלובלית.**
 *
 * ‎`new globalThis.Date(...)` ו-`new window.Date(...)` הם אותו בנאי
 * בדיוק. בסבב הקודם הרחבתי את **הקריאה** בלי `new` למסמיכים האלה,
 * ושכחתי את התאום שלה — הבנאי **עם** `new` (ביקורת Codex). שני
 * צדדים לאותה שאלה, ותיקנתי רק אחד.
 */
const DATE_CTOR = /new\s+(?:(?:globalThis|window|self|global)\.)?Date\s*\(/gu;

function localDateCtor(text) {
  const found = [];
  for (const { line, call } of callsOf(text, DATE_CTOR)) {
    if (call.includes(ALLOW)) continue;
    const args = argsOf(call);
    let depth = 0;
    let topLevelComma = false;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (ch === "(" || ch === "[" || ch === "{") depth += 1;
      else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
      else if (ch === "," && depth === 0) {
        /*
         * פסיק **נגרר** אינו מפריד בין ארגומנטים.
         * ‎`new Date(\n  Date.now() - ms,\n)` בסגנון prettier הוא
         * ארגומנט אחד, והספירה הראשונה שלי סימנה שישה מופעים תקינים
         * ב-`workers` וב-`shared` כבנאי רב-ארגומנטי. התרעת שווא היא
         * לא רק רעש: היא מלמדת למחוק סימונים.
         */
        if (args.slice(i + 1).trim() !== "") topLevelComma = true;
      }
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
 * ‎**„היום” שנגזר מ-`toISOString` — כלומר היום ב-UTC.**
 *
 * ‎`new Date().toISOString().slice(0, 10)` נראה כמו הדרך הבטוחה
 * לכתוב „היום”, ובניגוד לכל השאר בקובץ הזה הוא **אינו** תלוי בשעון
 * המכשיר — הוא תלוי ב-UTC. וזו בדיוק הסיבה שהוא חמקן: הוא נכון
 * בשעון של איש הפיתוח, נכון ב-CI, ושגוי בכל לילה בין חצות לשלוש
 * לפנות בוקר בישראל (שתיים בחורף), שבהן הוא מציין את **אתמול**.
 *
 * שלוש התקלות שהכלל הזה נולד מהן ישבו על שדות שסופרים בהם ימים:
 * תאריך ההתחלה המוצע של תקופת בלעדיות, מועד תיעוד פעולת שיווק,
 * ומפתח „נסגר להיום”. הראשונים שניים הם מסמך רגולטורי.
 *
 * ‎**למה הכלל נוקב ב-`new Date()` ולא בכל `Date`.** הוא **אינו**
 * יוריסטיקה של „איך הבאג נראה”, שהפסידה כאן חמש פעמים — הוא הפרדה
 * אמיתית: `toISOString` על רגע אמיתי ואז חיתוך לתווית תאריך הוא
 * המרה של רגע ללוח שנה, וזו המרה שחייבת לנקוב באזור זמן. לעומת זאת
 * ארבעת המופעים האחרים בעץ אינם רגעים אלא **עוגנים** שנבנו במפורש
 * כחצות UTC (גבולות תקופה, `entryBy`, יום בלוח) — שם `toISOString`
 * מחזיר בדיוק את התווית שממנה הם נבנו, וזו הדרך הנכונה.
 *
 * ‎**הגבול, במפורש:** `const now = new Date()` ואז
 * ‎`now.toISOString().slice(0, 10)` בשורה אחרת לא ייתפס. שער טקסטואלי
 * אינו עוקב אחרי כינויים — אותו גבול בדיוק שנרשם כאן על
 * ‎`Date#toString` ועל כינויי `Intl`. גבול ידוע עדיף על ביטחון שגוי.
 *
 * ‎**ואין לכלל הזה סימון חריגה.** „התאריך של הרגע הזה ב-UTC” אינו
 * תשובה נכונה לשום שאלה במוצר הזה; מי שצריך את היום הישראלי קורא
 * ל-`jerusalemWallParts(new Date()).date`.
 */
/** „הרגע הזה” — `new Date()` ריק, גם בהסמכה גלובלית וגם דרך `Date.now()`. */
const NOW = String.raw`new\s+(?:(?:globalThis|window|self|global)\.)?Date\s*\(\s*(?:Date\.now\s*\(\s*\)\s*)?\)`;
/**
 * גרש, גרשיים או תו תבנית.
 *
 * תו התבנית נכתב כ-``` ולא כעצמו: ‎`String.raw` מעביר את ששת
 * התווים כמות שהם, ומנוע הביטויים הרגולריים הוא שמפענח אותם — בעוד
 * שהתו עצמו היה סוגר כאן את המחרוזת.
 */
const QUOTE = String.raw`["'\u0060]`;
/** חיתוך לתווית קצרה מחותמת זמן מלאה — תאריך, חודש או שנה */
const TRUNCATE = String.raw`(?:slice|substring|substr)\s*\(\s*0\s*,\s*(\d{1,2})\s*\)`;
const SPLIT_T = String.raw`split\s*\(\s*${QUOTE}T${QUOTE}\s*\)\s*\[\s*0\s*\]`;
const UTC_TODAY = new RegExp(
  String.raw`${NOW}\s*\.\s*toISOString\s*\(\s*\)\s*\.\s*(?:${TRUNCATE}|${SPLIT_T})`,
  "gu",
);

function utcTodayLabel(source) {
  const text = withoutComments(source);
  const found = [];
  let match;
  UTC_TODAY.lastIndex = 0;
  while ((match = UTC_TODAY.exec(text)) !== null) {
    /* ‎`split("T")[0]` אינו לוכד ספרה; חיתוך באורך חותמת מלאה אינו תווית */
    if (match[1] !== undefined && Number(match[1]) >= 19) continue;
    found.push(text.slice(0, match.index).split("\n").length);
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
const LOCAL_FIELD = /type=\{?\s*["']datetime-local["']\s*\}?/gu;
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

for (const { full, short, arithmetic } of FILES) {
  scanned += 1;
  const source = readFileSync(full, "utf8");
  for (const line of intlWithoutTimeZone(source)) {
    offenders.push(`  ${short}:${line}  ←  Intl.DateTimeFormat בלי timeZone`);
  }
  for (const line of localeWithoutTimeZone(source)) {
    offenders.push(`  ${short}:${line}  ←  toLocale… בלי timeZone`);
  }
  for (const line of callableDateLines(withoutComments(source))) {
    offenders.push(`  ${short}:${line}  ←  ()Date בלי new — מחרוזת בשעון המארח`);
  }
  for (const line of utcTodayLabel(source)) {
    offenders.push(`  ${short}:${line}  ←  „היום” מ-toISOString — התאריך ב-UTC ולא בישראל`);
  }
  const sourceLines = source.split("\n");
  const carries = (line) => (sourceLines[line - 1] ?? "").includes(WALL_CARRIER);
  if (arithmetic) {
    for (const { line, why } of localDateCtor(source)) {
      if (carries(line)) continue;
      offenders.push(`  ${short}:${line}  ←  ${why}`);
    }
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
      /* תצוגה — שגויה בכל שכבה, בדפדפן ובשרת כאחד */
      (LOCAL_OFFSET.test(code) && "היסט אזור הזמן של המכשיר") ||
      /* אריתמטיקה — נאכפת בשכבת המסך, שאין בה דפוס „נושא שעת קיר” */
      (arithmetic &&
        !line.includes(WALL_CARRIER) &&
        ((LOCAL_READ.test(code) && "קריאה בשעון המכשיר") ||
          (LOCAL_PARSE.test(code) && "Date.parse — פרסור בשעון המכשיר") ||
          (LOCAL_WRITE.test(code) && "כתיבה בשעון המכשיר")));
    if (hit) {
      offenders.push(`  ${short}:${index + 1}  ←  ${hit}`);
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
      "    „היום”   — jerusalemWallParts(new Date()).date",
      "",
      `  אם שעון המכשיר הוא באמת התשובה הנכונה — סמנו את השורה ב-„${ALLOW}”`,
      "  והסבירו למה. סימון בלי סיבה הוא בדיוק מה שהשער נועד לתפוס.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ ${scanned} קבצים נסרקו — כל המועדים נקראים ונכתבים בשעון ישראל`);
