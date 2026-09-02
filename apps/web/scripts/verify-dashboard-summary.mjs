/**
 * ‎**המונים והסוכן הקולי — בתחתית הדשבורד, יחד, ובקנה מידה מצומצם.**
 *
 * ## התקלה שהשער הזה נולד ממנה
 *
 * ‏§24 של חבילת העיצוב מגדירה את סדר הדשבורד ככה, במפורש:
 *
 *     greeting row …
 *     voice-agent panel, full width
 *     four KPI tiles, one row, 1fr each
 *     grid 1fr / 372px …
 *
 * ‏כלומר פאנל הסוכן וארבעת האריחים **מעל** הרשת, ותופסים יחד את
 * כל הקיפול הראשון. בעל המוצר ראה את המסך המלא ואמר את ההפך:
 * „שהקוביות סיכום וגם הסוכן הקולי ירדו לתחתית העמוד, זה פחות
 * חשוב… והכי חשוב שלא יהיה בראש הדשבורד”. מתווך שפותח דשבורד בא
 * לראות מה לעשות עכשיו, ולא ארבעה מספרים ושדה קלט ריק.
 *
 * ## למה זה דורש שער ולא רק הערה
 *
 * ‏ההערה שישבה על `<VoiceConsole />` נימקה את המיקום הישן במילים
 * שלה: „הסוכן הקולי בראש המסך ולא בתחתיתו: הוא נקודת הכניסה
 * לפעולה”. זו טענה סבירה, היא נכתבה בתום לב, והיא **הפוכה
 * להכרעה של בעל המוצר**. מי שיקרא את §24 בפעם הבאה ויראה מסך
 * שאינו תואם לה יחזיר את הסדר — ובצדק גמור מבחינתו.
 *
 * ‏וזו החזרה שאף שער אחר אינו רואה: הטיפוגרפיה חוקית, הניגודיות
 * חוקית, הריפוד תקין ו-TypeScript מרוצה בשני הסדרים. **סדר הוא
 * בדיוק סוג ההכרעה שאינה שגיאה בשום מובן שנבדק** — היא נראית,
 * וזהו.
 *
 * ## מה נאכף
 *
 * ‏1. שני הבלוקים מופיעים **פעם אחת בלבד** בקובץ — עותק בראש לצד
 *    העותק שלמטה הוא בדיוק התקלה, ובדיקת „אחרי” לבדה הייתה
 *    מאשרת אותו.
 * ‏2. שניהם אחרי הרשימה המדורגת (ראש הרשת) ואחרי הכרטיס האחרון
 *    בטור הצדדי — כלומר אחרי הרשת כולה.
 * ‏3. שניהם בתוך **אותו** מכל בעל שני טורים, ולא זה מתחת לזה.
 * ‏4. האריח שם הוא הצורה המצומצמת, וזו באמת קטנה מן המלאה.
 *
 * ‏מה שאינו נאכף כאן: איך זה נראה. השער אינו מודד פיקסלים ואינו
 * יודע אם התוצאה יפה — הוא שומר על ההכרעה, לא על הטעם.
 *
 * ## למה סקריפט ולא בדיקת vitest
 *
 * ‏ל-web אין מריץ בדיקות. שאר שערי המסכים כאן רצים באותה צורה.
 */

import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const PAGE = read("../src/app/page.tsx");
const CSS = read("../src/app/globals.css");

const problems = [];

/**
 * מיקומו של סימן שחייב להופיע **בדיוק פעם אחת**.
 *
 * ‎`-1` הוא כשל, וכך גם הופעה שנייה: „הסוכן נמצא בתחתית” נכון גם
 * כשהוא נמצא גם בראש, ובדיקת סדר לבדה הייתה עוברת על מסך שבו
 * הבלוק מופיע פעמיים.
 */
function only(needle, what) {
  const first = PAGE.indexOf(needle);
  if (first === -1) {
    problems.push(`${what} לא נמצא בדשבורד (חיפשתי \`${needle}\`)`);
    return null;
  }
  if (PAGE.indexOf(needle, first + 1) !== -1) {
    problems.push(`${what} מופיע יותר מפעם אחת — עותק בראש המסך הוא בדיוק התקלה`);
    return null;
  }
  return first;
}

const voice = only("<VoiceConsole />", "פאנל הסוכן הקולי");
const counts = only('id="counts-heading"', "סקשן המונים");
/* ראש הרשת — הרשימה המדורגת היא מה שאמור לפתוח את המסך */
const ranked = only('aria-labelledby="today-tasks-heading"', "רשימת הפעולות המדורגת");
/* סוף הטור הצדדי — „the last card in its column” (§21) */
const lastAside = only('aria-labelledby="mentor-heading"', "הכרטיס הכהה שסוגר את הטור הצדדי");

if (voice !== null && counts !== null && ranked !== null && lastAside !== null) {
  for (const [at, what] of [
    [voice, "פאנל הסוכן הקולי"],
    [counts, "סקשן המונים"],
  ]) {
    if (at < ranked) {
      problems.push(`${what} מופיע לפני רשימת הפעולות — כלומר בראש הדשבורד`);
    } else if (at < lastAside) {
      problems.push(`${what} מופיע בתוך הרשת ולא אחריה`);
    }
  }

  /*
   * ‎**„באותו סקשן” — ולא זה מתחת לזה.**
   *
   * המכל נפתח אחרי הרשת, נושא את חלוקת שני הטורים, ושני הבלוקים
   * הם ילדיו. בדיקת „אין `</div>` ביניהם” היא מה שמפריד בין
   * שניהם בתוך אותו מכל לבין שניהם בשני מכלים עוקבים: הוצאת אחד
   * מהם החוצה **חייבת** לסגור את הראשון.
   */
  const cols = "lg:[grid-template-columns:1fr_372px]";
  const wrapper = PAGE.indexOf(cols, lastAside);
  if (wrapper === -1 || wrapper > voice) {
    problems.push(
      `המכל שמתחת לרשת אינו נושא את חלוקת שני הטורים (\`${cols}\`) — האריחים והסוכן אינם זה לצד זה`,
    );
  } else {
    const between = PAGE.slice(voice, counts);
    if (between === "") {
      problems.push("הסוכן והמונים באותו מקום בדיוק — הפריסה אינה ניתנת להכרעה");
    } else if (between.includes("</div>")) {
      problems.push("המונים יצאו מהמכל של הסוכן — הם אמורים לשבת לצדו באותו סקשן");
    }
  }
}

/**
 * ערכי ה-`className` שבקובץ — גם `"…"` וגם `{…}`.
 *
 * ‎**הסוגריים נספרים בעומק ולא נתפסים ברגקס**, וזה לא ניקיון אלא
 * תיקון: הניסוח הראשון כאן היה
 * ‎`/className\s*=\s*\{`([^`]*)`\}/`, והוא **לא התאים לאף אחד
 * מהאריחים** — המחלקה שלהם היא תבנית שבתוכה תבנית מקוננת
 * (`` `mv-domain-${card.domain}` ``), ולכן הגרשיים האחוריים
 * הפנימיים שברו את ההתאמה. הסריקה עברה על אפס ערכים, והבדיקה
 * „‎`mv-kpi` בלי `mv-kpi--sm`” אישרה כל קוד שהוא. שער שאינו קורא
 * אינו שער, והדרך היחידה שזה התגלה היא הרצת מוטציה שהייתה אמורה
 * להפיל אותו.
 *
 * הצורה הזו לקוחה מ-`verify-card-padding.mjs`, שנתקל באותה תקלה
 * בדיוק ומאותה סיבה.
 */
function* classNameValues(source) {
  for (const match of source.matchAll(/className\s*=\s*/gu)) {
    let index = match.index + match[0].length;
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      const end = source.indexOf(quote, index + 1);
      if (end === -1) continue;
      yield source.slice(index + 1, end);
      continue;
    }
    if (quote !== "{") continue;
    let depth = 0;
    let end = index;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    yield source.slice(index + 1, end);
  }
}

/*
 * ‎**האריח בתחתית הוא הצורה המצומצמת.**
 *
 * „הקוביות מדי ריקות” הייתה החצי השני של אותה בקשה, ואריח בגובה
 * 150 בטור ברוחב 372 הוא בדיוק מה שנאמר עליו.
 *
 * שתי המחלקות נדרשות **באותה מחרוזת**: `mv-kpi--sm` שיושבת בענף
 * אחר של תנאי אינה מובטחת, וספירתה ככיסוי הופכת את הבדיקה
 * למאשרת-תמיד.
 */
let tilesSeen = 0;
for (const value of classNameValues(PAGE)) {
  const chunks = [...value.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/gu)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
  for (const chunk of chunks.length === 0 ? [value] : chunks) {
    const classes = chunk.split(/\s+/u);
    if (!classes.includes("mv-kpi")) continue;
    tilesSeen += 1;
    if (!classes.includes("mv-kpi--sm")) {
      problems.push("אריח `mv-kpi` בדשבורד בלי `mv-kpi--sm` — הצורה המלאה חזרה");
    }
  }
}
/* ‎**אפס אריחים שנסרקו אינו „הכול תקין”** — זו הסריקה שנשברה */
if (tilesSeen === 0) {
  problems.push("לא נמצא ולו אריח `mv-kpi` אחד בדשבורד — הסריקה אינה קוראת את הקובץ");
}

/** ‎`min-height` של כלל ב-CSS, בפיקסלים; `null` כשאין. */
function minHeightOf(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) return null;
  const body = CSS.slice(at, CSS.indexOf("}", at));
  const found = /min-height:\s*(\d+(?:\.\d+)?)(px)?\s*;/u.exec(body);
  return found === null ? null : Number(found[1]);
}

const full = minHeightOf(".mv-kpi");
const small = minHeightOf(".mv-kpi--sm");
if (full === null) {
  problems.push("‎`.mv-kpi` אינה מגדירה `min-height` — אין מול מה להשוות");
} else if (small === null) {
  problems.push("‎`.mv-kpi--sm` אינה מגדירה `min-height` — הצורה המצומצמת אינה מצומצמת");
} else if (small >= full) {
  problems.push(
    `‎\`.mv-kpi--sm\` בגובה ${small} מול ${full} של המלאה — זו אינה הקטנה`,
  );
}

/*
 * השורה שהמספר וההערה חולקים. בלעדיה הם חוזרים לשתי שורות, האריח
 * מתארך, וההערה מפסיקה למלא את הרוחב שהמספר הותיר.
 */
if (!/\.mv-kpi__foot\s*\{[^}]*align-items:\s*baseline/u.test(CSS)) {
  problems.push("‎`.mv-kpi__foot` אינה מיישרת את המספר וההערה לקו בסיס אחד");
}
if (!PAGE.includes("mv-kpi__foot")) {
  problems.push("הדשבורד אינו משתמש ב-`mv-kpi__foot` — המספר וההערה חזרו לשתי שורות");
}

if (problems.length > 0) {
  console.error("✗ סדר הדשבורד: המונים והסוכן אינם במקומם\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\n  ההכרעה של בעל המוצר: שני הבלוקים בתחתית העמוד, זה לצד זה,");
  console.error("  והאריחים בצורתם המצומצמת. §24 מתארת את הסדר ההפוך — והיא");
  console.error("  מתוקנת ב-docs/design-handoff/DESIGN-SYSTEM-4-layout-and-rules.md.");
  process.exit(1);
}

console.log("✓ המונים והסוכן בתחתית הדשבורד, באותו סקשן, והאריח מצומצם");
