/**
 * ‎**פעולה הרסנית נשאלת, ולא נגללת אליה.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * אייקון הפח בכרטיס הנכס לא מחק דבר: הוא בחר לשונית וגלל אל כרטיס
 * בתחתית העמוד, ששם ישבו שני כפתורים עם אישור דו-לחיצה משלהם. מי
 * שלוחץ על פח אשפה ומקבל גלילה אינו יודע אם משהו קרה — ולכן לוחץ
 * שוב. בעל המוצר ביקש שהלחיצה תשאל.
 *
 * ## ומה שקל לאבד בהעברה
 *
 * לא העיצוב אלא **הגילוי**: מחיקה לצמיתות מוחקת גם כרטיס של אדם
 * שהנכס הוא העוגן היחיד שלו — שם, טלפונים והיסטוריית תקשורת.
 * המסך הקודם חסם את האישור עד שהתשובה מהשרת הגיעה. חלון חדש
 * שמאשר לפני הגילוי הוא בדיוק המחיקה שאיש לא ראה מראש.
 *
 * ## מה נאכף כאן
 *
 * ‎**1.** כפתור שמפעיל מחיקה אינו גולל אל מקום אחר בעמוד.
 * ‎**2.** כל חלון שמריץ מחיקה ומציג גילוי מהשרת חוסם את האישור עד
 *        שהגילוי הגיע (`confirmDisabled`).
 * ‎**3.** כישלון הבדיקה אינו נבלע לאפס — יש מצב „לא ידוע” מפורש.
 *
 * הוא אינו בודק מיקום, צבע או ניסוח: אלה ישתנו, והכלל לא.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;

/**
 * ‏קבצים שמריצים מחיקה הרסנית — לפי הנתיב שהם קוראים לו.
 *
 * ‎**ושני הנתיבים, לא אחד.** השער הכיר רק את מחיקת היחיד
 * ‎(`apiDelete(.../permanent)`), ולכן מסך הרשימה — שמוחק **אצווה**
 * ‏שלמה דרך `bulk-delete` — לא נבדק כלל. זו בדיוק הפעולה המסוכנת
 * ‏מבין השתיים.
 */
function deletesPermanently(code) {
  if (/apiDelete\([`'"][^`'"]*\/permanent/u.test(code)) return true;
  /*
   * ‎**„אצווה” אינה „לצמיתות”.** התנאי הראשון שכתבתי היה על
   * ‏המחרוזת `bulk-delete` לבדה, והוא הפיל את מסך „נכסים לגיוס” —
   * ‏שמוחק **יעדי גיוס**, מוריד אותם מהרשימה ושומר היסטוריה. שער
   * ‏שנופל על קוד תקין הוא הדרך הבטוחה ביותר ללמד אנשים לעקוף
   * ‏שערים. מה שקובע הוא הדגל שנשלח לשרת, ולא שם הנתיב.
   */
  for (const match of code.matchAll(/\/bulk-delete[`'"]/gu)) {
    if (/\bpermanent\b/u.test(code.slice(match.index, match.index + 220))) return true;
  }
  return false;
}

/** ‏הגילוי מהשרת — „מה עוד תרד איתו”. גם ליחיד וגם לאצווה. */
const PREVIEW = /\/permanent\/preview|bulk-deletion-preview/u;

/**
 * ‎**הכלל נבדק על הקובץ ועל מה שהוא מייבא ממנו** (ולא על הקובץ לבדו).
 *
 * ‏הבדיקה הייתה מקומית לקובץ, ולכן היא נכשלה ברגע שהשאלה עצמה
 * ‏הוצאה לרכיב משותף — אף שהיא נשאלת בדיוק כמו קודם. זהו שער
 * ‏שנופל על קוד תקין, וזה גרוע משער שאינו קיים: מי שנתקל בו לומד
 * ‏לפרק רכיבים משותפים כדי לרצות אותו.
 *
 * ‏מה שנפתח הוא **המסירה**: הקורא מרנדר את הרכיב שאליו הוא ייבא,
 * ‏ולכן מה שהרכיב אוכף חל גם עליו. רק ייבוא יחסי — חבילה חיצונית
 * ‏אינה „המשך של הקובץ הזה”.
 */
function localImports(path, code) {
  const dir = dirname(join(ROOT, path));
  const out = [];
  for (const match of code.matchAll(/from\s+"(\.[^"]*)"/gu)) {
    const base = resolve(dir, match[1]);
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (existsSync(base + ext)) {
        out.push(base + ext);
        break;
      }
    }
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/u.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(ROOT).map((path) => ({
  path: path.slice(ROOT.length),
  code: readFileSync(path, "utf8"),
}));

const problems = [];

for (const file of files) {
  /*
   * ‎**כפתור מחיקה שגולל.** הצירוף שנאסר הוא תווית שמדברת על מחיקה
   * באותו רכיב שקורא ל-`scrollIntoView` — כלומר „לחצת על מחיקה
   * וקיבלת תזוזה”.
   */
  for (const match of file.code.matchAll(/label="[^"]*מחיק[^"]*"/gu)) {
    const window = file.code.slice(match.index, match.index + 420);
    if (window.includes("scrollIntoView")) {
      problems.push(
        `${file.path}: כפתור „${match[0]}” גולל במקום לשאול — ` +
          "מי שלחץ על פח אשפה אינו יודע אם משהו קרה",
      );
    }
  }

  /*
   * ‎**„בוצע” נאמר רק אחרי שבוצע.** חלון שמריץ שני צעדים ברצף
   * ומדווח על הראשון לפי **המצב שלפני הפעולה** מבטיח שינוי שלא
   * בהכרח קרה: הארכוב נכשל, והמסך אומר שהנכס הוצא מהרשימה בזמן
   * שהוא פעיל ומפורסם (ביקורת Codex, P1).
   *
   * הכלל הנאכף: הודעה שמדווחת על צעד ביניים אינה מותנית בשם ה-prop
   * שמתאר את המצב ההתחלתי — אלא בדגל שנקבע **אחרי** שהקריאה חזרה.
   */
  for (const match of file.code.matchAll(/`\$\{message\}[^`]*הועבר[^`]*`/gu)) {
    const before = file.code.slice(Math.max(0, match.index - 400), match.index);
    if (!/did[A-Z]\w*\s*\|\||did[A-Z]\w*\s*\?/u.test(before)) {
      problems.push(
        `${file.path}: מדווח „הועבר לארכיון” בלי דגל שנקבע אחרי שהקריאה הצליחה — ` +
          "כישלון הארכוב יישמע כהצלחה",
      );
    }
  }

  if (!deletesPermanently(file.code)) continue;

  /*
   * ‏הקובץ ומה שהוא מוסר לו. די בכך שאחד מהם מקיים את הכלל, כי
   * ‏יחד הם המסך שהמשתמש רואה.
   */
  const scope =
    file.code +
    localImports(file.path, file.code)
      .map((full) => readFileSync(full, "utf8"))
      .join("\n");

  /*
   * ‎**חלון שמוחק לצמיתות חייב להמתין לגילוי.** הבדיקה היא על
   * הקיום של שני המנגנונים יחד: תצוגה מקדימה מהשרת, ואישור שחסום
   * בזמן שהיא בדרך.
   */
  if (PREVIEW.test(scope)) {
    /*
     * ‎**הכלל הוא „אי אפשר לאשר לפני שהגילוי הוצג” — לא „יש
     * ‎`confirmDisabled`”.**
     *
     * ‏שתי מימושים מקיימים אותו, ושניהם קיימים במערכת: חלון React
     * ‏שחוסם את האישור בזמן שהבדיקה בדרך, ו-`window.confirm` שהטקסט
     * ‏שלו **נבנה מהתשובה** ולכן אינו יכול להיפתח לפניה. הניסוח
     * ‏הראשון הכיר רק בראשון, והפיל את מסך הקונים — שמציג את הגילוי
     * ‏בתוך השאלה עצמה.
     */
    const confirmAfterDisclosure = (() => {
      const preview = PREVIEW.exec(scope);
      const native = scope.indexOf("window.confirm");
      return preview !== null && native > preview.index;
    })();
    if (!scope.includes("confirmDisabled") && !confirmAfterDisclosure) {
      problems.push(
        `${file.path}: שולף תצוגה מקדימה ואינו חוסם את האישור — ` +
          "אפשר לאשר מחיקה לפני שהמסך גילה מה היא תגרור",
      );
    }
    /*
     * ‎**המצב הזה נבדק במסלול הכישלון, ולא בקובץ.** הניסוח הראשון
     * חיפש את המחרוזת „unknown” בכל הקובץ — והיא מופיעה גם בהצהרת
     * הטיפוס. כלומר מי שהחליף את הכתיבה עצמה באפס עבר את השער,
     * שהוא בדיוק המקרה שהוא נועד לתפוס.
     *
     * ‎**ויציאה היא תשובה נכונה בדיוק כמו „לא ידוע”.** מסך הקונים
     * ‏עוצר את המחיקה כשהבדיקה נכשלה (`setError` ואז `return`),
     * ‏וזה בטוח לפחות כמו להציג „לא ידוע” — הוא פשוט לא מגיע
     * ‏למחיקה.
     *
     * ‎**אבל לא כל `catch` בקובץ.** הרחבתי את הבדיקה לכל היקף
     * ‏הייבוא, ואז מוטציה שהחליפה `setImpact("unknown")` ב-
     * ‎`setImpact(0)` עברה ירוקה: למסך הרשימה יש עשרות `catch`
     * ‏שמסתיימים ב-`return`, וכל אחד מהם „הרגיע” את השער. זהו שער
     * ‏שמודד קרבה במקום את ההכרעה.
     *
     * ‏הטיפול בכישלון שייך למי שמחזיק את מצב האישור — הקובץ שבו
     * ‏יושב `confirmDisabled` או `window.confirm`. שם, ורק שם, הוא
     * ‏נדרש להיות בטוח.
     */
    const inScope = [
      file,
      ...localImports(file.path, file.code).map((full) => ({
        path: full.slice(ROOT.length),
        code: readFileSync(full, "utf8"),
      })),
    ];

    /*
     * ‎**(א) הכתיבה של „לא ידוע”, בתוך `catch`.**
     *
     * ‏סוגריים ולא רק מרכאות: `Impact = number | "loading" |
     * ‎"unknown"` הוא **הצהרת טיפוס**, והיא נשארת במקומה גם כשמי
     * ‏שמחליף את הכתיבה באפס עובר. מה שנבדק הוא הקריאה עצמה.
     */
    const writesUnknown = inScope.some((owner) =>
      [...owner.code.matchAll(/\.catch\(|catch\s*(?:\(|\{)/gu)].some((m) =>
        /\("unknown"\)/u.test(owner.code.slice(m.index, m.index + 200)),
      ),
    );

    /*
     * ‎**(ב) או שהבדיקה שנכשלה עוצרת את המחיקה** — וזה בטוח לפחות
     * ‏באותה מידה, כי אין אחריה מחיקה בכלל.
     *
     * ‎**מעוגן ב-`catch` של התצוגה המקדימה עצמה**, ולא באיזשהו
     * ‎`catch` בקובץ. מסך שלם מלא ב-`catch { … return; }` שאין להם
     * ‏קשר לגילוי, וכל אחד מהם „הרגיע” את הגרסה הקודמת — כלומר שער
     * ‏שמדד קרבה ולא הכרעה, ומוטציה שהחליפה את הכתיבה באפס עברה בו.
     */
    const abortsOnFailure = inScope.some((owner) => {
      const preview = PREVIEW.exec(owner.code);
      if (preview === null) return false;
      const after = owner.code.slice(preview.index, preview.index + 800);
      const guard = /\.catch\(|catch\s*(?:\(|\{)/u.exec(after);
      if (guard === null) return false;
      return /\breturn\b|\bthrow\b/u.test(after.slice(guard.index, guard.index + 200));
    });

    const safeOnFailure = writesUnknown || abortsOnFailure;
    if (!safeOnFailure) {
      problems.push(
        `${file.path}: כישלון הבדיקה אינו נעצר ואינו נרשם כ„לא ידוע” — הוא ` +
          "נקרא כ„לא יימחק אף כרטיס”, וזה בדיוק ההפך",
      );
    }
  } else {
    problems.push(
      `${file.path}: מוחק לצמיתות בלי לשלוף תצוגה מקדימה — ` +
        "כרטיס אדם עלול לרדת בלי שאיש ידע",
    );
  }
}

if (problems.length > 0) {
  console.error("✗ פעולה הרסנית בלי השאלה שלפניה:\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("✓ כל מחיקה לצמיתות נשאלת, ומגלה מה היא תגרור לפני האישור");
