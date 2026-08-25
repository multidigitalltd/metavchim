/**
 * רצפת הטיפוגרפיה — **14px, ובלי משקל דק.**
 *
 * ## למה שער ולא הנחיה
 *
 * גודל טקסט אינו החלטה שנשמרת בזיכרון של מי שכותב מסך. הוא נכתב
 * מחדש בכל רכיב חדש, ותמיד באותו כיוון: „הכיתוב הזה משני, שיהיה
 * קטן”. המערכת עברה כבר סבב שלם של הגדלת טקסטים, וללא אכיפה
 * הגדלים הקטנים חוזרים תוך כמה מסכים — כי אף אחד לא רואה את
 * המצטבר, רק את המסך שהוא כותב.
 *
 * ## למה 14px דווקא
 *
 * זה הגודל שהוגדר כרצפה למערכת: מתחתיו הטקסט העברי — שאין בו
 * אותיות גדולות שמסמנות תחילת מילה — נהיה גוש צפוף. שני
 * ‎`text-xs`‎ של Tailwind (‎0.75rem‎ = 12px) ו-‎`text-[13px]`‎
 * נופלים מתחת לרצפה, ולכן שניהם נחסמים כאן.
 *
 * ## למה גם משקל
 *
 * המשקל הדק (300 ומטה) מוריד ניגודיות בפועל בלי לשנות אף צבע:
 * הקווים דקים יותר, והבדיקה האוטומטית של WCAG — שמודדת צבעים —
 * ממשיכה לדווח „תקין”. בעברית, שבה חלק מהאותיות נבדלות בקו אחד,
 * זה מורגש הרבה יותר מאשר בלטינית.
 *
 * ## מה **לא** נבדק
 *
 * גדלים יחסיים (`em`, `rem`, `%`) אינם ניתנים להכרעה סטטית — הם
 * תלויים בהקשר שבו הרכיב מוצב. שער שמנחש אותם היה מסמן קוד תקין,
 * וזה הסוף של כל שער. במקום זה `inlineCode` ב-`docs/doc-ui.tsx`
 * הועבר ל-`1em` ידנית, וכל מי שמוסיף גודל יחסי אחראי לו.
 *
 * ## למה סקריפט ולא בדיקת vitest
 *
 * ל-web אין מריץ בדיקות. `verify:assets` ו-`verify:language` כבר
 * רצים כאן באותה צורה בדיוק.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** הרצפה במפורש — הערך היחיד שצריך לשנות אם המערכת תגדיל שוב */
const FLOOR_PX = 14;
/** משקל 400 הוא הרגיל; כל מה שמתחתיו הוא „דק” */
const MIN_WEIGHT = 400;

const root = resolve(import.meta.dirname, "..");
/* שורש המונורפו — כדי שהנתיב בשגיאה יהיה זהה גם לקובץ בחבילה אחרת */
const repo = resolve(root, "../..");

/*
 * גם ‎packages/shared‎: תבניות המייל נכתבות שם ב-HTML גולמי, והטקסט
 * שלהן מגיע למשתמש בדיוק כמו טקסט במסך. שער שעוצר בגבול החבילה
 * היה מאשר מייל ב-12px.
 */
const SCOPED = [
  { label: "apps/web/src", dir: join(root, "src") },
  {
    label: "packages/shared/src/logic",
    dir: resolve(root, "../../packages/shared/src/logic"),
  },
];

/*
 * הסולם עצמו — נקרא מ-`globals.css` ולא נכתב כאן שוב.
 *
 * כל דרגה מוצהרת כ-‎`--type-x: calc(N / 16 * 1rem)`, ומכאן ש-‎`N` הוא
 * הגודל ב-100% בהינתן ברירת המחדל של הדפדפן. עותק של הטבלה בתוך
 * השער היה נפרד מהסולם בשקט בשינוי הראשון, והשער היה מודד רצפה מול
 * מספרים שכבר אינם נכונים — כלומר בדיוק סוג התקלה שהוא קיים כדי לתפוס.
 *
 * ‎**למה `rem` ולא `px * scale`.** ‎`:root` מחיל את סקלת הנגישות דרך
 * ‎`font-size: calc(1em * var(--a11y-font-scale))`, ושם ‎`1em` הוא גודל
 * ברירת המחדל של הדפדפן. לכן ‎`rem` נושא **שני** הגורמים: הגדרת
 * הדפדפן וגם הסקלה שלנו. ‎`calc(Npx * var(--a11y-font-scale))` נושא רק
 * את השני, ומי שמגדיל טקסט בהגדרות הדפדפן במקום בסרגל שלנו נשאר עם
 * מסך שגדל למחצה — מחלקות Tailwind גדלות ושלנו לא (ביקורת Codex).
 * הכפלה בסקלה כאן הייתה מחילה אותה פעמיים.
 *
 * סולם ריק הוא כשל: הוא אומר שהפורמט השתנה ושהכלל שנשען עליו
 * אינו בודק עוד דבר.
 */
const SCALE_STEPS = new Map();
{
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  for (const m of css.matchAll(
    /(--type-[a-z0-9-]+): ?calc\(([0-9.]+) ?\/ ?16 ?\* ?1rem\)/gu,
  )) {
    SCALE_STEPS.set(m[1], Number(m[2]));
  }
  if (SCALE_STEPS.size === 0) {
    console.error(
      "✗ לא נמצאה אף דרגה בסולם ב-globals.css — הכלל של `font-size: var(--type-*)` אינו בודק דבר\n",
    );
    process.exit(1);
  }
}

const RULES = [
  {
    /*
     * ‎`text-[15px]` — ערך פיקסלים שרירותי של Tailwind, **אסור בכל
     * גודל ולא רק מתחת לרצפה.**
     *
     * הכלל בדק כאן רק „קטן מ-14”, וזה הפך אותו לריק בדיוק כשהמערכת
     * עברה ליחידות שורש: 482 מחלקות כאלה נשארו קבועות בעוד שאר
     * הטקסט גדל, וביניהן כותרות של מצב ריק וזהות הנכס בשורת הרשימה
     * — כלומר טקסט בן 15px לצד טקסט בן 31px באותה שורה (ביקורת
     * Codex). גודל תקין שאינו גדל הוא תקלת נגישות בדיוק כמו גודל
     * קטן מדי, והרצפה לבדה אינה רואה אותה.
     *
     * מחלקות הסולם של Tailwind (`text-sm` ומעלה) נמדדות ב-`rem`
     * וממשיכות להיות מותרות — הן גדלות עם השורש מעצמן.
     */
    pattern: /text-\[([0-9.]+)px\]/gu,
    fails: () => true,
    describe: (m) =>
      `${m[0]} — גודל קבוע שאינו גדל עם השורש; להשתמש ב-text-[length:var(--type-…)]`,
  },
  {
    /* text-xs = 0.75rem = 12px. text-sm = 0.875rem = 14px, והוא הקטן המותר */
    pattern: /\btext-xs\b/gu,
    fails: () => true,
    describe: () => `text-xs (12px) — השתמשו ב-text-sm`,
  },
  {
    /*
     * ‎`style={{ fontSize: 15.5 }}` — **אסור בכל גודל.**
     *
     * הכלל בדק „קטן מ-14”, ולכן 107 גדלים מוטבעים חוקיים לחלוטין
     * עברו אותו בשקט. סגנון בשורה גובר על המחלקה, ולכן כל אחד מהם
     * הוא מתג שמכבה את הסקלה **בדיוק במקום שבו נראה שהיא הופעלה**:
     * ‎`NowStamp` קיבל `className` מומר מהקורא, וכתב מעליו
     * ‎`fontSize: 15.5` — כך שהחותמת נשארה קפואה ליד תאריך שגדל
     * (ביקורת Codex).
     *
     * זו אותה מסקנה כמו ב-`text-[Npx]`: גודל תקין שאינו גדל הוא
     * תקלת נגישות, ורצפה אינה יכולה לראות אותה. הצורה המותרת היא
     * טוקן או ערך יחסי לשורש, שניהם כמחרוזת.
     *
     * ‎`(?=[,\s}])` ולא `\b`: `\b` נכשל אחרי נקודה עשרונית, ולכן
     * ‎`fontSize: 15.5` היה נקרא כ-`15` — הכלל היה מודד את המספר
     * הלא נכון.
     */
    pattern: /fontSize: (\d+(?:\.\d+)?)(?=[,\s}])/gu,
    fails: () => true,
    describe: (m) =>
      `${m[0]} — גודל קבוע בסגנון בשורה גובר על המחלקה ומכבה את סקלת הנגישות`,
  },
  {
    /* style={{ fontSize: "13px" }} */
    pattern: /fontSize: ["']([0-9.]+)px["']/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
  },
  {
    /* CSS ו-HTML גולמי, עם רווח ובלעדיו */
    pattern: /font-size: ?([0-9.]+)px/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
  },
  {
    /*
     * ‎`font-size: calc(15px * var(--a11y-font-scale))` — הצורה
     * שגודל מקבל כשהוא אמור להגיב להגדרת הנגישות.
     *
     * ‎**בלי הכלל הזה השער מפסיק לבדוק בדיוק את הקובץ שהכי חשוב
     * לבדוק.** ההמרה של `globals.css` לצורה הזו הורידה את מספר
     * ההתאמות ל-`font-size: Npx` שם לאפס, כלומר כל הרצפה של
     * מערכת העיצוב הייתה נעשית ריקה והשער היה ממשיך לדווח „תקין”.
     * זו בדיוק התקלה שהשער הזה קיים כדי למנוע, רק על עצמו.
     */
    pattern: /font-size: ?calc\(([0-9.]+) ?\/ ?16 ?\* ?1rem\)/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
  },
  {
    /*
     * ‎**הצורה הישנה, `calc(Npx * var(--a11y-font-scale))`, אסורה.**
     *
     * היא נראית נכונה — היא באמת מגיבה לסרגל הנגישות שלנו — ולכן
     * היא מסוכנת: מה שהיא **לא** עושה הוא להגיב להגדרת „גודל גופן
     * ברירת מחדל” של הדפדפן, כי `px` הוא `px`. מחלקות Tailwind
     * ‎(`text-sm` וכו') נמדדות ב-`rem` וכן גדלות איתה, וכך מסך אחד
     * מגיב בשני אופנים שונים לאותה הגדרה (ביקורת Codex).
     *
     * הכלל תופס את **הצירוף עצמו** בכל מקום, ולא צמד `font-size:`/
     * ‎`fontSize:` בלבד. ההבדל אינו סגנוני: הצורה הזו מופיעה גם
     * בהצהרת טוקן (`--type-x: …`) וגם על `width`/`height` של תיבה
     * שאמורה לגדול עם הטקסט. ניסוח שדורש שם תכונה היה מפספס בדיוק
     * את הצהרת הטוקן — כלומר את המקום שממנו כל השאר נגזר.
     */
    pattern: /[0-9.]+px ?\* ?var\(--a11y-font-scale\)/gu,
    fails: () => true,
    describe: (m) =>
      `${m[0]} — הכפלה ב-scale על px מתעלמת מגודל ברירת המחדל של הדפדפן; להשתמש ב-calc(N / 16 * 1rem)`,
  },
  {
    /*
     * ‎`style={{ fontSize: "calc(15px * var(--a11y-font-scale))" }}`
     *
     * שני הכללים שמעל נכתבו בכתיב של CSS בלבד, ובאותו סבב עצמו
     * כתבתי את שתי הצורות האלה ב-TSX. כלומר השער הורחב בדיוק
     * לצד אחד של אותה הצהרה, והגדלים שהוספתי ב-JSX נשארו בלי
     * בדיקה (ביקורת Codex).
     */
    pattern: /fontSize: ["']calc\(([0-9.]+) ?\/ ?16 ?\* ?1rem\)["']/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
  },
  {
    /* ‎`style={{ fontSize: "var(--type-body)" }}` — אותה הכרעה בכתיב JSX */
    pattern: /fontSize: ["']var\((--type-[a-z0-9-]+)\)["']/gu,
    fails: (m) => {
      const px = SCALE_STEPS.get(m[1]);
      return px === undefined || px < FLOOR_PX;
    },
    describe: (m) => {
      const px = SCALE_STEPS.get(m[1]);
      return px === undefined
        ? `${m[0]} — דרגה שאינה מוגדרת בסולם`
        : `${m[0]} = ${px}px — מתחת ל-${FLOOR_PX}px`;
    },
  },
  {
    /*
     * ‎`font-size: var(--type-body)` — הדרגה נפתרת מהסולם עצמו.
     *
     * הערך נלקח מהצהרת הטוקן ב-`:root` (ראו `SCALE_STEPS`), ולכן
     * דרגה שתרד מתחת לרצפה תיתפס בכל מקום שצורך אותה, ולא רק
     * בהגדרה. טוקן שאינו בסולם הוא כשל: הוא נפתר ל„כלום” בדפדפן
     * והטקסט מקבל גודל שנירש במקרה.
     */
    pattern: /font-size: ?var\((--type-[a-z0-9-]+)\)/gu,
    fails: (m) => {
      const px = SCALE_STEPS.get(m[1]);
      return px === undefined || px < FLOOR_PX;
    },
    describe: (m) => {
      const px = SCALE_STEPS.get(m[1]);
      return px === undefined
        ? `${m[0]} — דרגה שאינה מוגדרת בסולם`
        : `${m[0]} = ${px}px — מתחת ל-${FLOOR_PX}px`;
    },
  },
  {
    /*
     * ‎**גודל קבוע בשורה על אלמנט שנושא מחלקה של מערכת העיצוב.**
     *
     * מחלקות ה-`mv-` עברו לסולם, כלומר הן גדלות עם הגדרת הנגישות.
     * ‎`style={{ fontSize: 14 }}` על אותו אלמנט גובר עליהן ומכבה את
     * ההגדלה בדיוק שם — וכל עוד הכיתוב סביבו כן גדל, נוצר רכיב
     * חצי-מוגדל.
     *
     * זה קרה כאן ב-44 מקומות, והתגלה שלוש פעמים בשלושה סבבים כי
     * הסריקות הידניות שלי היו צרות ממה שהצהרתי עליהן. כלל אוטומטי
     * הוא מה שמפסיק את זה: הוא אינו תלוי בכך שאזכור לסרוק.
     *
     * הבדיקה היא על **התג**, לא על השורה: `className` ו-`style`
     * יושבים לעיתים קרובות באותה שורה ולעיתים בשורות נפרדות.
     */
    tagScan: true,
    pattern: /fontSize:\s*"?(\d[\d.]*)(?:px)?"?/gu,
    fails: () => true,
    describe: (m) =>
      `${m[0]} על אלמנט עם מחלקת mv- — גודל קבוע מכבה את סקלת הנגישות`,
  },
  {
    pattern: /\bfont-(light|thin|extralight)\b/gu,
    fails: () => true,
    describe: (m) => `${m[0]} — משקל דק אסור`,
  },
  {
    pattern: /font-?[wW]eight: ?["']?([0-9]{3})["']?/gu,
    fails: (m) => Number(m[1]) < MIN_WEIGHT,
    describe: (m) => `${m[0]} — מתחת למשקל ${MIN_WEIGHT}`,
  },
];

/*
 * ‎`jsxTags` — פירוק תג פתיחה עד סופו האמיתי.
 *
 * ‎`<[a-zA-Z][^>]*?>` נעצר על ה-`>` הראשון, וזה נשבר בדיוק על התגים
 * שכותבים `onClick={() => ...}` לפני `className`: התג נחתך באמצע,
 * הוא כבר לא מכיל `mv-`, והכלל מדלג עליו בשקט — כלומר `fontSize`
 * קבוע עובר את השער (ביקורת Codex). לכן צריך מונה סוגריים ומעקב
 * מחרוזות, ולא ביטוי רגולרי.
 */
function* jsxTags(text) {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "<") continue;
    if (!/[a-zA-Z]/u.test(text[i + 1] ?? "")) continue;
    let depth = 0;
    let quote = "";
    for (let j = i + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (quote !== "") {
        if (ch === "\\") j += 1;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (depth === 0 && ch === ">") {
        yield { text: text.slice(i, j + 1), index: i };
        i = j;
        break;
      } else if (depth === 0 && ch === "<") {
        /* לא תג אחרי הכול — לא לבלוע את המשך הקובץ */
        break;
      }
    }
  }
}

function files(path) {
  const out = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (/\.(tsx?|css)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
let scanned = 0;

for (const scope of SCOPED) {
  const found = files(scope.dir);
  /*
   * נתיב ריק הוא כשל ולא „אין מה לסרוק” — שינוי מבנה תיקיות היה
   * מוציא את הקוד מהאכיפה בשקט והשער היה ממשיך לדווח „תקין”.
   */
  if (found.length === 0) {
    console.error(`✗ נתיב בשער הטיפוגרפיה ריק: ${scope.label}\n`);
    process.exit(1);
  }
  for (const file of found) {
    /*
     * הסקריפט עצמו מכיל את כל התבניות האסורות כדוגמאות. סריקה שלו
     * הייתה מפילה את הבנייה על הכלל שמגן עליה.
     */
    if (file === resolve(import.meta.dirname, "verify-typography.mjs")) continue;
    scanned += 1;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const rule of RULES) {
      /*
       * ‎`tagScan` — הכלל נבדק על **התג** ולא על השורה.
       *
       * ‎`className` ו-`style` יושבים לפעמים באותה שורה ולפעמים
       * בשורות נפרדות, ולכן כלל שמסתכל על שורה בודדת מפספס בדיוק
       * את המקרים שבהם הקוד מפורמט לרוחב. מספר השורה מחושב מהיסט
       * ההתאמה כדי שהשגיאה תישאר ניתנת ללחיצה.
       */
      if (rule.tagScan) {
        for (const tag of jsxTags(text)) {
          if (!tag.text.includes("mv-")) continue;
          for (const match of tag.text.matchAll(rule.pattern)) {
            if (!rule.fails(match)) continue;
            const at = tag.index + (match.index ?? 0);
            const line = text.slice(0, at).split("\n").length;
            offenders.push(
              `  ${relative(repo, file)}:${line}  ←  ${rule.describe(match)}`,
            );
          }
        }
        continue;
      }
      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(rule.pattern)) {
          if (!rule.fails(match)) continue;
          offenders.push(
            `  ${relative(repo, file)}:${index + 1}  ←  ${rule.describe(match)}`,
          );
        }
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(`✗ טקסט מתחת ל-${FLOOR_PX}px או במשקל דק:\n`);
  for (const line of offenders) console.error(line);
  console.error(
    `\n  הרצפה במערכת היא ${FLOOR_PX}px, והמשקל הקל ביותר הוא ${MIN_WEIGHT}.\n`,
  );
  process.exit(1);
}

/*
 * הרצפה נשמרת גם **בזמן ריצה**, ולא רק בקוד.
 *
 * סקלת הנגישות פועלת על גודל הבסיס של השורש, ולכן היא מכפילה גם את
 * מחלקות ה-rem: ‎`text-sm`‎ הוא ‎0.875rem‎, ובסקלה 90% הוא 12.6px.
 * כלומר כפתור „הקטן טקסט” אחד היה מבטל את כל מה שנבדק למעלה, והשער
 * היה ממשיך לדווח „תקין” — כי הוא קורא קוד ולא מודד ריצה (ביקורת
 * Codex, PR #163). הבדיקה הזו היא מה שמחבר בין השניים.
 */
const prefsFile = join(root, "src/lib/a11y-prefs.ts");
const prefsSource = readFileSync(prefsFile, "utf8");
const minScale = /A11Y_MIN_SCALE = (\d+)/u.exec(prefsSource);
if (minScale === null || Number(minScale[1]) < 100) {
  console.error(
    `✗ ${relative(repo, prefsFile)}: סקלת הנגישות יורדת מתחת ל-100%\n\n` +
      `  הסקלה מכפילה את יחידות ה-rem, ולכן סקלה קטנה מ-100% מורידה\n` +
      `  את text-sm מתחת ל-${FLOOR_PX}px ומבטלת את הרצפה בלחיצה אחת.\n`,
  );
  process.exit(1);
}

console.log(
  `✓ ${scanned} קבצים נסרקו — כל הטקסטים ≥ ${FLOOR_PX}px, במשקל תקין, וסקלת הנגישות אינה יורדת מתחת ל-100%`,
);
