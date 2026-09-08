/**
 * ‎**כל פעולה ארוכה בסוכן העדכון מדווחת מה עלה בגורלה.**
 *
 * ## הכשל שהשער הזה מונע — וכבר קרה
 *
 * ‎`runUpdate` בלעה כל כישלון ל-`console.error`, ולא היה
 * ‎`/update/status`. המסך אמר „העדכון הופעל” וזה היה המשפט האחרון
 * ‏שהוא אמר אי פעם: עדכון שנכשל נראה בדיוק כמו עדכון שהצליח.
 *
 * ‏ביום שבו זה נבדק בפועל, זה עלה למשתמש שני סבבים ואבחנה שגויה
 * ‏אחת שלי — חיפשתי את הסיבה במקום הלא נכון, כי המקום הנכון לא
 * ‏אמר כלום. `restore` ו-`backup` באותו קובץ **כן** דיווחו, ולכן
 * ‏זו לא הייתה החלטה עיצובית אלא פשוט אחת שנשכחה.
 *
 * ## מה נטען כאן
 *
 * ‏לכל פעולה שמופעלת כ-`void runX()` מתוך מטפל הבקשות:
 *
 * 1. ‎**יש נתיב `GET` שמחזיר את מצבה.** בלעדיו אין למסך את מי
 *    לשאול, וכל מה שנשאר הוא „הבקשה יצאה”.
 * 2. ‎**ה-`catch` שלה כותב למצב הזה**, ולא רק ל-`console`. לוג של
 *    קונטיינר אינו ערוץ דיווח: אף אחד לא פותח אותו בזמן אמת, ומי
 *    שלוחץ על הכפתור אינו יכול לפתוח אותו בכלל.
 *
 * ‎`ok` **אינו** נדרש: `runSelfUpdate` מוסר את ההחלפה לקונטיינר עזר
 * ‏ומת באמצע, ולכן אין לו „הצליח” לדווח — יש לו רק „נכשל לפני
 * ‏המסירה”, וזה מה שנדרש ממנו.
 *
 * ## ‏„ה-`catch`”, ולא „`catch` כלשהו”
 *
 * ‏הניסוח הראשון כאן חיפש `catch` בכל עומק, ולכן נתפס על
 * ‏ה-`catch` הפנימי של ניקוי התמונות ב-`runUpdate` — זה שמסתפק
 * ‏ב-`console.warn` בכוונה, כי כישלון בו אינו מפיל עדכון תקין.
 * ‏כאן זו הייתה אזעקת שווא, אבל אותה טעות בכיוון ההפוך היא
 * ‏שקטה: `catch` פנימי שכן כותב למצב היה מאשר פונקציה
 * ‏שה-`catch` האמיתי שלה שותק. לכן ההתאמה עוגנת בהזחה — שני
 * ‏רווחים, כלומר רמת גוף הפונקציה — ונעצרת ב-`finally` או בסופה.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = readFileSync(join(root, "infra/updater/server.mjs"), "utf8");

const problems = [];

/** הפעולות שמטפל הבקשות מפעיל ברקע. */
const started = [...src.matchAll(/void\s+(run[A-Za-z]+)\(/gu)].map((m) => m[1]);
const operations = [...new Set(started)];

if (operations.length === 0) {
  problems.push("לא נמצאה אף פעולה שמופעלת כ-`void runX()` — השער אינו מודד דבר");
}

/** גוף הפונקציה, מהכותרת עד הסוגר בעמודה הראשונה. */
function bodyOf(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) return null;
  const end = src.indexOf("\n}", start);
  return end === -1 ? null : src.slice(start, end);
}

/** נתיבי ה-GET שהסוכן מגיש, והביטוי שכל אחד מחזיר. */
const statusRoutes = [
  ...src.matchAll(
    /req\.method === "GET" && req\.url === "([^"]+)"\)\s*\{\s*json\(res, 200, ([^)]+)\)/gu,
  ),
].map((m) => ({ url: m[1], returns: m[2].trim() }));

for (const name of operations) {
  const body = bodyOf(name);
  if (body === null) {
    problems.push(`\`${name}\` מופעלת אך לא נמצאה — השער לא יכול לבדוק אותה`);
    continue;
  }

  /* ‏משתנה המצב הוא זה שהפונקציה מסמנת בו `running: true` בתחילתה. */
  const owned = body.match(/^ {2}(\w+) = \{[^}]*?running: true/mu);
  const state = owned?.[1] ?? null;
  if (state === null) {
    problems.push(
      `\`${name}\` אינה מסמנת משתנה מצב בתחילתה — אין למסך מה לשאול עליו`,
    );
    continue;
  }

  /* ‎1 · נתיב GET שמחזיר בדיוק את המצב הזה. */
  if (!statusRoutes.some((route) => route.returns === state)) {
    problems.push(
      `אין נתיב \`GET\` שמחזיר את \`${state}\` — התוצאה של \`${name}\` אינה ניתנת לשאילה, וכל מה שהמסך יודע הוא שהבקשה יצאה`,
    );
  }

  /* ‎2 · ה-`catch` כותב למצב, ולא רק ללוג. */
  const failure = body.match(
    /\n {2}\} catch \([^)]*\) \{([\s\S]*?)\n {2}\}(?: finally \{|$)/u,
  );
  if (failure === null) {
    problems.push(`\`${name}\` בלי \`catch\` — כישלון בה אינו מטופל כלל`);
  } else if (!new RegExp(`${state}\\.\\w+\\s*=`, "u").test(failure[1])) {
    problems.push(
      `ה-\`catch\` של \`${name}\` אינו כותב ל-\`${state}\` — הכישלון נשאר בלוג של הקונטיינר, שאיש אינו פותח`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n✗ פעולה בסוכן העדכון שאינה מדווחת מה עלה בגורלה:\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error(
    "\nהמסך שולח בקשה ואז שואל — אם אין את מי לשאול, „הופעל” הוא גם התשובה\nהאחרונה שהמשתמש יקבל, גם כשהפעולה נכשלה.\n",
  );
  process.exit(1);
}

console.log(
  `✓ ${operations.length} פעולות בסוכן העדכון — לכל אחת נתיב מצב, וכישלון שנכתב אליו`,
);
