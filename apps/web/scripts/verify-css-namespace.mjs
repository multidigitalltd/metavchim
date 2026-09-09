/**
 * ‏שם מחלקה שכבר תפוס — **הגניבה השקטה ביותר בגיליון סגנונות אחד.**
 *
 * ## ‏התקלה שהשער הזה נולד ממנה
 *
 * ‏עמוד המנטור קיבל כרטיס פתיח, וקראתי לו `.mv-greet`. השם נראה
 * ‏פנוי — ולא היה: כך נקראת ברכת הבוקר בדשבורד. ובאותה מכה
 * ‎`.mv-privacy`, שכבר שייכת לבאנר הפרטיות בעמוד השת״פים.
 *
 * ‏שתי ההגדרות חיות באותו קובץ, והמאוחרת מנצחת. כלומר: **עמוד אחד
 * ‏עוצב, ושניים אחרים נשברו בשקט** — בלי שגיאת קומפילציה, בלי
 * ‏אזהרה, ובלי שדבר בעמוד שנגעתי בו ייראה חשוד. את זה גיליתי רק
 * ‏כשראיתי מסגרת ירוקה סביב שורת פרטיות שלא ביקשתי.
 *
 * ## ‏מה נמדד כאן
 *
 * ‏כלל בסיס הוא כלל ברמה העליונה של הקובץ (לא בתוך `@media`). שתי
 * ‏הגדרות בסיס לאותה מחלקה הן שני בעלים לאותו שם, ולכן כשל.
 *
 * ‎**והרשימה נבדקת לשני הכיוונים.** ‏הכפילויות שהיו כאן לפני השער
 * ‏רשומות למטה כחוב ידוע; מחלקה שתצא מהרשימה בלי להיות כפולה עוד
 * ‏תיפול גם היא, אחרת הרשימה מתנפחת ומפסיקה לומר משהו.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//gu, "");

/**
 * ‏חוב ידוע: מחלקות שכבר היו מוגדרות פעמיים כשהשער נכתב. אין כאן
 * ‏התנגשות בין עמודים — אלה כללים שנוספו על גבי כללים באותו רכיב —
 * ‏אבל הן כפילויות, ולכן הן רשומות ולא מוסתרות.
 */
const KNOWN = new Set([
  "mv-tabs",
  "mv-entity-tabs",
  "mv-tab-count",
  "mv-bar-row",
  "mv-dialog",
  "mv-net-card",
  "mv-net-foot",
  "mv-stat-tile",
  "mv-net-top",
  "mv-net-strip",
  "mv-net-strip-head",
  "mv-net-strip-title",
  "mv-net-strip-count",
  "mv-net-strip-chevron",
  "mv-net-money",
  "mv-net-money-label",
  "mv-net-money-value",
  "mv-net-fact",
  "mv-net-fact-value",
  "mv-net-fact-label",
  "mv-net-say",
  "mv-net-say-label",
  "mv-net-cardfoot",
  "mv-net-nomatch",
  "mv-chiprow",
]);

/** ‏כמה כללי בסיס יש לכל מחלקה — סופר לפי עומק הסוגריים */
const defined = new Map();
let depth = 0;
let prelude = "";
for (const ch of css) {
  if (ch === "{") {
    if (depth === 0) {
      const head = prelude.trim();
      if (!head.startsWith("@")) {
        for (const part of head.split(",")) {
          const name = /^\.([\w-]+)$/u.exec(part.trim());
          if (name !== null)
            defined.set(name[1], (defined.get(name[1]) ?? 0) + 1);
        }
      }
    }
    depth++;
    prelude = "";
  } else if (ch === "}") {
    depth--;
    prelude = "";
  } else {
    prelude += ch;
  }
}

const problems = [];
if (defined.size < 200) {
  problems.push(
    `נמצאו רק ${defined.size} מחלקות — הניתוח נשבר והשער אינו בודק עוד דבר`,
  );
}
const duplicated = [...defined]
  .filter(([, n]) => n > 1)
  .map(([name]) => name);
for (const name of duplicated) {
  if (!KNOWN.has(name)) {
    problems.push(
      `‎.${name} מוגדרת פעמיים ברמה העליונה — השם כבר תפוס, וההגדרה המאוחרת גוברת גם על העמוד השני`,
    );
  }
}
for (const name of KNOWN) {
  if (!duplicated.includes(name)) {
    problems.push(
      `‎.${name} ברשימת החוב הידוע אך אינה כפולה עוד — יש להסיר אותה מהרשימה`,
    );
  }
}

if (problems.length > 0) {
  console.error("✗ התנגשות שמות ב-globals.css:\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}

console.log(
  `✓ ${defined.size} מחלקות — לכל אחת בעלים אחד (${KNOWN.size} כפילויות ידועות מלפני השער)`,
);
