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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;

/** קבצים שמריצים מחיקה הרסנית — לפי הנתיב שהם קוראים לו. */
const PERMANENT_DELETE = /apiDelete\([`'"][^`'"]*\/permanent/u;

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

  if (!PERMANENT_DELETE.test(file.code)) continue;

  /*
   * ‎**חלון שמוחק לצמיתות חייב להמתין לגילוי.** הבדיקה היא על
   * הקיום של שני המנגנונים יחד: תצוגה מקדימה מהשרת, ואישור שחסום
   * בזמן שהיא בדרך.
   */
  if (file.code.includes("/permanent/preview")) {
    if (!file.code.includes("confirmDisabled")) {
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
     */
    const setsUnknownOnFailure = [...file.code.matchAll(/\.catch\(|catch\s*\(/gu)].some(
      (m) => /"unknown"/u.test(file.code.slice(m.index, m.index + 200)),
    );
    if (!setsUnknownOnFailure) {
      problems.push(
        `${file.path}: כישלון הבדיקה אינו נרשם כ„לא ידוע” — הוא נקרא ` +
          "כ„לא יימחק אף כרטיס”, וזה בדיוק ההפך",
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
