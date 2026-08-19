/**
 * שפת ההפניות — **נאכפת, לא מומלצת.**
 *
 * ## למה שער ולא הנחיה
 *
 * `REFERRAL_TERMS` הובטח בתיעוד של `lead-referral.ts` מהיום הראשון
 * ומעולם לא נבנה. הכלל היה כתוב, לא היה לו מקום להיאכף בו, וכל מסך
 * ניסח מחדש — עד שהשפה נסחפה חזרה למסחר בלקוחות. הבטחה בלי אכיפה
 * היא בדיוק מה שקרה כאן פעם אחת.
 *
 * ## למה זה משנה מעבר לניסוח
 *
 * משרד תיווך שמוכר לקוחות ומשרד תיווך שמפנה לקוח לעמית הם שני
 * דברים שונים — מקצועית ורגולטורית. התמורה כאן משולמת על **ההפניה**
 * ולא על התוצאה: אין עמלה בסגירה, ואין החזר אם לא נסגר. טקסט
 * שמתאר סחר בלקוחות מתאר מנגנון אחר מזה שהמערכת מפעילה בפועל.
 *
 * ## מה **לא** אסור
 *
 * "תשלום", "קרדיטים", "תמורה" ו"עמלה" מותרים במפורש. כסף באמת עובר
 * בין המשרדים, והסתרה של זה גרועה יותר מניסוח מדויק שלו. הרשימה
 * מכוונת לצירופים שמתארים את **הלקוח כסחורה**.
 *
 * ## למה סקריפט ולא בדיקת vitest
 *
 * ל-web אין מריץ בדיקות, והוספת אחד בשביל שער טקסט אחד היא תלות
 * חדשה בכל CI. `verify:assets` כבר רץ כאן באותה צורה בדיוק.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * הרשימה משוכפלת כאן מ-`FORBIDDEN_REFERRAL_WORDS` שב-shared במכוון:
 * הסקריפט רץ ב-Node גולמי לפני כל בנייה, וייבוא מהחבילה היה מחייב
 * שהיא תיבנה קודם — כלומר שער שנשבר בדיוק כשהוא נחוץ. שתי הרשימות
 * מסונכרנות בבדיקה שלמטה.
 */
/*
 * ‎"מחיר ליד"‎ נעדר בכוונה: בעברית ‎"ליד"‎ הוא גם מילת יחס, ו"תווית
 * מחיר ליד הכפתור" הוא משפט תקין. שער שמסמן טקסט כשר מלמד להתעלם
 * ממנו — וזה הסוף של כל שער.
 */
const FORBIDDEN = [
  "מכירת ליד",
  "מכירת לידים",
  "קניית ליד",
  "קניית לידים",
  "רכישת ליד",
  "רכישת לידים",
  "מחיר הליד",
  "עלות הליד",
  "לקנות ליד",
  "מוכר הליד",
  "קונה הליד",
  "סחר בלידים",
  "מסחר בלידים",
];

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");

/*
 * לא כל המערכת: "מחיר ליד לפי מקור" במסך הפלטפורמה מתאר מנגנון אחר
 * לגמרי — הפלטפורמה קונה לידים מספק חיצוני, וזה באמת מה שקורה שם.
 * חלת הכלל על הכול הייתה מכריחה לנסח לא נכון דווקא במקום שבו
 * הניסוח הנוכחי מדויק.
 */
const SCOPED = ["app/collaboration", "app/leads"];

function files(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/u.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders = [];
let scanned = 0;
for (const dir of SCOPED) {
  for (const file of files(join(src, dir))) {
    scanned += 1;
    /*
     * הערות קוד נסרקות גם הן. הן אינן מגיעות למשתמש, אבל הן מה
     * שנקרא לפני שנכתב טקסט חדש — וניסוח מסחרי בהערה מייצר ניסוח
     * מסחרי במסך.
     */
    const text = readFileSync(file, "utf8");
    for (const word of FORBIDDEN) {
      if (text.includes(word)) {
        offenders.push(`  ${file.replace(`${root}/`, "")}  ←  „${word}”`);
      }
    }
  }
}

if (offenders.length > 0) {
  console.error("✗ ניסוח של מסחר בלקוחות במסכי ההפניות:\n");
  for (const line of offenders) console.error(line);
  console.error(
    "\n  התמורה משולמת על ההפניה ולא על הלקוח. ראו REFERRAL_TERMS ב-lead-referral.ts.\n",
  );
  process.exit(1);
}

console.log(`✓ ${scanned} קבצים נסרקו — שפת ההפניות תקינה`);
