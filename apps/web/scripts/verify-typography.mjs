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
 * כל דרגה מוצהרת כ-‎`--type-x: calc(Npx * var(--a11y-font-scale))`,
 * ומכאן ש-‎`N` הוא הגודל ב-100%. עותק של הטבלה בתוך השער היה נפרד
 * מהסולם בשקט בשינוי הראשון, והשער היה מודד רצפה מול מספרים
 * שכבר אינם נכונים — כלומר בדיוק סוג התקלה שהוא קיים כדי לתפוס.
 *
 * סולם ריק הוא כשל: הוא אומר שהפורמט השתנה ושהכלל שנשען עליו
 * אינו בודק עוד דבר.
 */
const SCALE_STEPS = new Map();
{
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  for (const m of css.matchAll(
    /(--type-[a-z0-9-]+): ?calc\(([0-9.]+)px ?\* ?var\(--a11y-font-scale\)\)/gu,
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
    /* text-[13.5px] — ערך שרירותי של Tailwind */
    pattern: /text-\[([0-9.]+)px\]/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
  },
  {
    /* text-xs = 0.75rem = 12px. text-sm = 0.875rem = 14px, והוא הקטן המותר */
    pattern: /\btext-xs\b/gu,
    fails: () => true,
    describe: () => `text-xs (12px) — השתמשו ב-text-sm`,
  },
  {
    /* style={{ fontSize: 13.5 }} */
    pattern: /fontSize: ([0-9.]+)\b/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
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
    pattern: /font-size: ?calc\(([0-9.]+)px ?\* ?var\(--a11y-font-scale\)\)/gu,
    fails: (m) => Number(m[1]) < FLOOR_PX,
    describe: (m) => `${m[0]} — מתחת ל-${FLOOR_PX}px`,
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
    pattern: /fontSize: ["']calc\(([0-9.]+)px ?\* ?var\(--a11y-font-scale\)\)["']/gu,
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
